import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const EXPECTED_STAGING_REF = 'tyhbowelwkkprxharzmt';
const parseEnv = source => Object.fromEntries(source.split(/\r?\n/u).filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => {
  const separator = line.indexOf('=');
  return [line.slice(0, separator), line.slice(separator + 1)];
}));
const env = parseEnv(await readFile(new URL('../.env.staging.local', import.meta.url), 'utf8'));
for (const name of ['SUPABASE_STAGING_PROJECT_REF', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_STAGING_SERVICE_ROLE_KEY', 'STAGING_USER_A_EMAIL', 'STAGING_USER_A_PASSWORD', 'STAGING_USER_A_ID', 'STAGING_USER_B_EMAIL', 'STAGING_USER_B_PASSWORD', 'STAGING_USER_B_ID']) {
  assert.ok(env[name], `Missing ignored staging setting: ${name}`);
}
assert.equal(env.SUPABASE_STAGING_PROJECT_REF, EXPECTED_STAGING_REF);
assert.equal(new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0], EXPECTED_STAGING_REF);

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const makeClient = key => createClient(env.VITE_SUPABASE_URL, key, options);
const clientA = makeClient(env.VITE_SUPABASE_ANON_KEY);
const clientB = makeClient(env.VITE_SUPABASE_ANON_KEY);
const serviceClient = makeClient(env.SUPABASE_STAGING_SERVICE_ROLE_KEY);
await serviceClient.realtime.setAuth(env.SUPABASE_STAGING_SERVICE_ROLE_KEY);

const signIn = async (client, email, password, expectedId) => {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  assert.equal(data.user.id, expectedId);
  await client.realtime.setAuth(data.session.access_token);
};
await signIn(clientA, env.STAGING_USER_A_EMAIL, env.STAGING_USER_A_PASSWORD, env.STAGING_USER_A_ID);
await signIn(clientB, env.STAGING_USER_B_EMAIL, env.STAGING_USER_B_PASSWORD, env.STAGING_USER_B_ID);

// A killed prior verification process may not reach its finally block. Remove
// only this script's unmistakably prefixed disposable rows before accounting.
const staleFixtures = await clientB.from('media_library').select('media_key').like('provider_id', 'staging-realtime-%');
assert.ifError(staleFixtures.error);
for (const fixture of staleFixtures.data) {
  const cleanup = await clientB.rpc('delete_user_media', { p_media_key: fixture.media_key, p_deleted_at: new Date().toISOString() });
  assert.ifError(cleanup.error);
}

const initial = async client => {
  const [media, logs] = await Promise.all([
    client.from('media_library').select('*', { count: 'exact', head: true }),
    client.from('media_logs').select('*', { count: 'exact', head: true }),
  ]);
  assert.ifError(media.error);
  assert.ifError(logs.error);
  return { media: media.count, logs: logs.count };
};
const initialA = await initial(clientA);
const initialB = await initial(clientB);
assert.deepEqual(initialA, { media: 707, logs: 660 });
assert.deepEqual(initialB, { media: 0, logs: 0 });

const prefix = `staging-realtime-${randomUUID().slice(0, 8)}`;
const mediaKey = `tmdb:movies:${prefix}`;
const row = {
  user_id: env.STAGING_USER_B_ID,
  id: prefix,
  provider: 'tmdb',
  provider_id: prefix,
  media_type: 'movies',
  media_key: mediaKey,
  title: 'Disposable Realtime Prerequisite',
  type: 'movies',
  status: 'planned',
  rating: 0,
  rewatchCount: 0,
  readIssueIds: [],
  apiData: {},
};
const eventsA = [];
const eventsB = [];
const tombstonesA = [];
const tombstonesB = [];
const channels = [];

const subscribe = (client, label, mediaEvents, tombstoneEvents) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${label} subscription timed out`)), 30_000);
  const channel = client.channel(`${prefix}-${label}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'media_library' }, payload => mediaEvents.push(payload));
  if (tombstoneEvents) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'media_tombstones' }, payload => tombstoneEvents.push(payload));
  channel.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      clearTimeout(timer);
      channels.push([client, channel]);
      resolve(channel);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      clearTimeout(timer);
      reject(new Error(`${label} status ${status}`));
    }
  });
});
const waitFor = async (predicate, label, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`${label} timed out`);
};

try {
  await Promise.all([
    subscribe(clientA, 'user-a', eventsA, tombstonesA),
    subscribe(clientB, 'user-b', eventsB, tombstonesB),
  ]);

  let response = await clientB.from('media_library').insert(row);
  assert.ifError(response.error);
  await waitFor(() => eventsB.some(event => event.eventType === 'INSERT' && event.new?.media_key === mediaKey), 'User B INSERT event');

  response = await clientB.from('media_library').update({ title: 'Disposable Realtime Prerequisite Updated', updated_at: new Date().toISOString() }).eq('media_key', mediaKey);
  assert.ifError(response.error);
  await waitFor(() => eventsB.some(event => event.eventType === 'UPDATE' && event.new?.media_key === mediaKey && event.new?.title.endsWith('Updated')), 'User B UPDATE event');

  response = await clientB.rpc('delete_user_media', { p_media_key: mediaKey, p_deleted_at: new Date().toISOString() });
  assert.ifError(response.error);
  await waitFor(() => tombstonesB.some(event => event.new?.media_key === mediaKey), 'User B tombstone event');
  await new Promise(resolve => setTimeout(resolve, 1_000));
  assert.equal(eventsA.some(event => event.new?.media_key === mediaKey || event.old?.media_key === mediaKey), false);
  assert.equal(tombstonesA.some(event => event.new?.media_key === mediaKey), false);

  const bChannelEntry = channels.find(([, channel]) => channel.topic.endsWith(`${prefix}-user-b`));
  if (bChannelEntry) {
    await bChannelEntry[0].removeChannel(bChannelEntry[1]);
    channels.splice(channels.indexOf(bChannelEntry), 1);
  }
  await subscribe(clientB, 'user-b-reconnect', [], []);
  const [hydratedMedia, hydratedTombstone] = await Promise.all([
    clientB.from('media_library').select('media_key').eq('media_key', mediaKey),
    clientB.from('media_tombstones').select('media_key').eq('media_key', mediaKey),
  ]);
  assert.ifError(hydratedMedia.error);
  assert.ifError(hydratedTombstone.error);
  assert.equal(hydratedMedia.data.length, 0);
  assert.equal(hydratedTombstone.data.length, 1);

  console.log('PASS staging Realtime INSERT, UPDATE, DELETE/tombstone, owner isolation, reconnect, and no resurrection.');
} finally {
  try { await clientB.rpc('delete_user_media', { p_media_key: mediaKey, p_deleted_at: new Date().toISOString() }); } catch {}
  try { await clientB.rpc('reset_user_library'); } catch {}
  await Promise.all(channels.map(async ([client, channel]) => {
    try { await client.removeChannel(channel); } catch {}
  }));
  await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()]);
  clientA.realtime.disconnect();
  clientB.realtime.disconnect();
  serviceClient.realtime.disconnect();
}

const finalA = await initial(makeClient(env.SUPABASE_STAGING_SERVICE_ROLE_KEY));
const finalBMedia = await serviceClient.from('media_library').select('*', { count: 'exact', head: true }).eq('user_id', env.STAGING_USER_B_ID);
const finalBLogs = await serviceClient.from('media_logs').select('*', { count: 'exact', head: true }).eq('user_id', env.STAGING_USER_B_ID);
assert.ifError(finalBMedia.error);
assert.ifError(finalBLogs.error);
assert.equal(finalBMedia.count, 0);
assert.equal(finalBLogs.count, 0);
assert.ok(finalA.media >= 707 && finalA.logs >= 660);
console.log(`PASS final accounting: User A ${initialA.media}/${initialA.logs}; User B ${finalBMedia.count}/${finalBLogs.count}.`);
