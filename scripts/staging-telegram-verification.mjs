import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const parseEnv = source => Object.fromEntries(
  source.split(/\r?\n/u)
    .filter(line => line && !line.trim().startsWith('#') && line.includes('='))
    .map(line => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, '')];
    }),
);

const staging = parseEnv(await readFile(new URL('../.env.staging.local', import.meta.url), 'utf8'));
const edge = parseEnv(await readFile(new URL('../.env.staging.functions.local', import.meta.url), 'utf8'));
for (const name of [
  'SUPABASE_STAGING_PROJECT_REF', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_STAGING_SERVICE_ROLE_KEY', 'STAGING_USER_B_ID',
]) assert.ok(staging[name], `Missing ignored staging setting: ${name}`);
assert.ok(edge.TELEGRAM_WEBHOOK_SECRET, 'Missing ignored staging Telegram webhook secret');
assert.equal(new URL(staging.VITE_SUPABASE_URL).hostname.split('.')[0], staging.SUPABASE_STAGING_PROJECT_REF);

const service = createClient(staging.VITE_SUPABASE_URL, staging.SUPABASE_STAGING_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const userId = staging.STAGING_USER_B_ID;
const baseUpdateId = Date.now();
const usedUpdateIds = [];
const endpoint = `${staging.VITE_SUPABASE_URL}/functions/v1/telegram-logger`;

const countRows = async table => {
  const { count, error } = await service.from(table).select('*', { count: 'exact', head: true }).eq('user_id', userId);
  assert.ifError(error);
  return count;
};

const userRows = async table => {
  const { data, error } = await service.from(table).select('*').eq('user_id', userId);
  assert.ifError(error);
  return data;
};

const invoke = async ({ updateId, text, chatId = 424242, secret = edge.TELEGRAM_WEBHOOK_SECRET }) => {
  if (secret === edge.TELEGRAM_WEBHOOK_SECRET) usedUpdateIds.push(String(updateId));
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: staging.VITE_SUPABASE_ANON_KEY,
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': secret,
    },
    body: JSON.stringify({
      update_id: updateId,
      message: { message_id: updateId, date: 1_788_000_000 + (updateId - baseUpdateId), chat: { id: chatId }, text },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  return { status: response.status, text: await response.text() };
};

const invokeParsed = async payload => {
  const first = await invoke(payload);
  if (first.status !== 502 || !/Gemini API request failed/iu.test(first.text)) return first;
  await new Promise(resolve => setTimeout(resolve, 1_500));
  return invoke(payload);
};

const cleanup = async () => {
  const { error: logError } = await service.from('media_logs').delete().eq('user_id', userId);
  assert.ifError(logError);
  const { error: mediaError } = await service.from('media_library').delete().eq('user_id', userId);
  assert.ifError(mediaError);
  if (usedUpdateIds.length) {
    const itemPrefixes = usedUpdateIds.flatMap(id => Array.from({ length: 10 }, (_, index) => `${id}:${index}`));
    const { error: eventsError } = await service.from('webhook_events').delete().eq('source', 'telegram').eq('user_id', userId).in('event_id', itemPrefixes);
    assert.ifError(eventsError);
    const { error: batchesError } = await service.from('webhook_batches').delete().eq('source', 'telegram').eq('user_id', userId).in('event_id', usedUpdateIds);
    assert.ifError(batchesError);
  }
};

assert.equal(await countRows('media_library'), 0, 'User B must begin without media');
assert.equal(await countRows('media_logs'), 0, 'User B must begin without logs');

try {
  const wrongSecret = await invoke({ updateId: baseUpdateId, text: 'watched Fight Club (1999) movie', secret: 'wrong-secret' });
  assert.equal(wrongSecret.status, 401);

  const unauthorized = await invoke({ updateId: baseUpdateId + 1, text: 'watched Fight Club (1999) movie', chatId: 999999 });
  assert.equal(unauthorized.status, 200);
  assert.equal(await countRows('media_library'), 0);

  const watchedId = baseUpdateId + 2;
  const watched = await invokeParsed({ updateId: watchedId, text: 'I watched the 1999 movie Fight Club' });
  assert.equal(watched.status, 200, watched.text);
  let media = await userRows('media_library');
  let logs = await userRows('media_logs');
  assert.equal(media.length, 1);
  assert.equal(logs.length, 1);
  const fightClub = media[0];
  assert.equal(fightClub.media_key, 'tmdb:movies:550');
  assert.equal(fightClub.status, 'completed');
  assert.ok(fightClub.dateStarted && fightClub.dateCompleted);
  assert.equal(fightClub.dateStarted, fightClub.dateCompleted);
  assert.ok(fightClub.image && fightClub.apiData?.raw && Object.keys(fightClub.apiData.raw).length > 0);
  assert.equal(logs[0].action_type, 'WATCHED');
  assert.equal(Date.parse(logs[0].log_date), fightClub.dateCompleted);

  const retry = await invoke({ updateId: watchedId, text: 'this changed text must not replace the stable plan' });
  assert.equal(retry.status, 200, retry.text);
  assert.equal(await countRows('media_library'), 1);
  assert.equal(await countRows('media_logs'), 1);

  const rating = await invokeParsed({ updateId: baseUpdateId + 3, text: 'Rate the 1999 movie Fight Club 8/10' });
  assert.equal(rating.status, 200, rating.text);
  media = await userRows('media_library');
  assert.equal(media[0].status, 'completed');
  assert.equal(Number(media[0].rating), 8);
  assert.equal(await countRows('media_logs'), 1, 'rating-only must not add a diary row');

  const progress = await invokeParsed({ updateId: baseUpdateId + 4, text: 'Foundation (2021) TV season 2 episode 4' });
  assert.equal(progress.status, 200, progress.text);
  media = await userRows('media_library');
  const foundation = media.find(row => row.media_key === 'tmdb:tv:93740');
  assert.ok(foundation);
  assert.equal(foundation.status, 'in progress');
  assert.equal(foundation.progress, 'S02 E04');
  assert.ok(foundation.dateStarted);
  assert.equal(media.length, 2);
  assert.equal(await countRows('media_logs'), 1, 'episode progress must not create diary history');

  const season = await invokeParsed({ updateId: baseUpdateId + 5, text: 'I finished season 2 of the 2021 TV show Foundation' });
  assert.equal(season.status, 200, season.text);
  logs = await userRows('media_logs');
  const foundationLogs = logs.filter(row => row.media_key === 'tmdb:tv:93740');
  assert.equal(foundationLogs.length, 1);
  assert.equal(foundationLogs[0].season_label, 'Season 2');
  assert.ok(foundationLogs[0].season_year);
  assert.equal(foundationLogs.some(row => row.season_label === 'Season 1'), false);

  const rewatch = await invokeParsed({ updateId: baseUpdateId + 6, text: 'I rewatched the 1999 movie Fight Club' });
  assert.equal(rewatch.status, 200, rewatch.text);
  media = await userRows('media_library');
  logs = await userRows('media_logs');
  const finalFightClub = media.find(row => row.media_key === 'tmdb:movies:550');
  const fightClubLogs = logs.filter(row => row.media_key === 'tmdb:movies:550');
  assert.equal(finalFightClub.rewatchCount, 1);
  assert.deepEqual(fightClubLogs.map(row => row.action_type).sort(), ['RE-WATCHED', 'WATCHED']);
  assert.equal(new Set(fightClubLogs.map(row => row.log_id)).size, 2);

  const ambiguousCount = media.length;
  const ambiguous = await invokeParsed({ updateId: baseUpdateId + 7, text: 'I watched the movie The Thing' });
  assert.equal(ambiguous.status, 200, ambiguous.text);
  assert.equal(await countRows('media_library'), ambiguousCount, 'ambiguous title must not write media');

  console.log('PASS live staging Telegram semantics, canonical identity, atomic media/log persistence, and idempotent retry.');
} finally {
  await cleanup();
  assert.equal(await countRows('media_library'), 0, 'User B media cleanup failed');
  assert.equal(await countRows('media_logs'), 0, 'User B log cleanup failed');
  service.realtime.disconnect();
}
