import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const parseEnv = source => Object.fromEntries(
  source.split(/\r?\n/u)
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const env = parseEnv(await readFile(new URL('../.env.staging.local', import.meta.url), 'utf8'));
for (const name of [
  'SUPABASE_STAGING_PROJECT_REF', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
  'STAGING_USER_A_EMAIL', 'STAGING_USER_A_PASSWORD', 'STAGING_USER_A_ID',
  'STAGING_USER_B_EMAIL', 'STAGING_USER_B_PASSWORD', 'STAGING_USER_B_ID',
]) assert.ok(env[name], `Missing ignored staging setting: ${name}`);

const productionRef = (await readFile(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8')).trim();
assert.equal(new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0], env.SUPABASE_STAGING_PROJECT_REF);
assert.notEqual(env.SUPABASE_STAGING_PROJECT_REF, productionRef);

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const makeClient = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, options);
const clientA = makeClient();
const clientB = makeClient();
const signIn = async (client, email, password, expectedId) => {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  assert.equal(data.user.id, expectedId);
  return data.user;
};
await signIn(clientA, env.STAGING_USER_A_EMAIL, env.STAGING_USER_A_PASSWORD, env.STAGING_USER_A_ID);
await signIn(clientB, env.STAGING_USER_B_EMAIL, env.STAGING_USER_B_PASSWORD, env.STAGING_USER_B_ID);

const countRows = async (client, table) => {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
  assert.ifError(error);
  return count;
};
const initial = {
  aMedia: await countRows(clientA, 'media_library'),
  aLogs: await countRows(clientA, 'media_logs'),
  bMedia: await countRows(clientB, 'media_library'),
  bLogs: await countRows(clientB, 'media_logs'),
};

const prefix = `codex-remediation-${randomUUID().slice(0, 8)}`;
const mediaKeys = new Set();
const logIds = new Set();
const now = Date.now();
const iso = offset => new Date(now + offset).toISOString();
const media = ({ provider = 'tmdb', type = 'movies', id, title, status = 'planned', progress = null, updatedAt = iso(0) }) => {
  const mediaKey = `${provider}:${type}:${id}`;
  mediaKeys.add(mediaKey);
  return {
    id, provider, provider_id: id, media_type: type, media_key: mediaKey,
    title, type, status, progress, rating: 0, rewatchCount: 0, readIssueIds: [],
    image: 'https://example.invalid/staging-fixture.jpg', apiData: {}, updated_at: updatedAt,
  };
};
const log = ({ parent, id, action, date, season = null, review = '' }) => {
  logIds.add(id);
  return {
    log_id: id, media_id: parent.id, provider: parent.provider, provider_id: parent.provider_id,
    media_type: parent.media_type, media_key: parent.media_key, action_type: action,
    log_date: date, review_text: review, image: parent.image, season_label: season,
    season_year: season ? '2026' : null, updated_at: iso(100),
  };
};
const upsertMedia = async row => {
  const { error } = await clientB.rpc('upsert_user_media', { p_media: row });
  assert.ifError(error);
};
const upsertLog = async row => {
  const { error } = await clientB.rpc('upsert_user_log', { p_log: row });
  assert.ifError(error);
};

try {
  const d1Parent = media({ id: `${prefix}-d1`, title: 'D1 same-day fixture' });
  await upsertMedia(d1Parent);
  const watched = log({ parent: d1Parent, id: `${prefix}-watched`, action: 'WATCHED', date: '2026-08-23T09:00:00.000Z' });
  const rewatched = log({ parent: d1Parent, id: `${prefix}-rewatched`, action: 'RE-WATCHED', date: '2026-08-23T19:00:00.000Z' });
  await upsertLog(watched);
  await upsertLog(rewatched);
  let result = await clientB.from('media_logs').select('log_id,action_type,review_text').eq('media_key', d1Parent.media_key).order('log_id');
  assert.ifError(result.error);
  assert.equal(result.data.length, 2);
  watched.review_text = 'edited selected entry';
  watched.updated_at = iso(200);
  await upsertLog(watched);
  result = await clientB.from('media_logs').select('log_id,action_type,review_text').eq('media_key', d1Parent.media_key).order('log_id');
  assert.ifError(result.error);
  assert.equal(result.data.length, 2);
  assert.equal(result.data.find(row => row.log_id === watched.log_id).review_text, 'edited selected entry');
  assert.equal(result.data.find(row => row.log_id === rewatched.log_id).review_text, '');

  const tvParent = media({ type: 'tv', id: `${prefix}-tv`, title: 'TV season identity fixture', status: 'in progress', progress: 'S03 E01' });
  await upsertMedia(tvParent);
  const seasons = [1, 2, 3].map(number => log({
    parent: tvParent,
    id: `${prefix}-season-${number}`,
    action: 'WATCHED',
    date: `2026-08-23T${String(8 + number).padStart(2, '0')}:00:00.000Z`,
    season: `Season ${number}`,
  }));
  await upsertLog(seasons[0]);
  await upsertLog(seasons[1]);
  const beforeSeasonThree = await clientB.from('media_logs').select('log_id,log_date,season_label').eq('media_key', tvParent.media_key).order('log_id');
  assert.ifError(beforeSeasonThree.error);
  await upsertLog(seasons[2]);
  const afterSeasonThree = await clientB.from('media_logs').select('log_id,log_date,season_label').eq('media_key', tvParent.media_key).order('log_id');
  assert.ifError(afterSeasonThree.error);
  assert.equal(afterSeasonThree.data.length, 3);
  assert.deepEqual(afterSeasonThree.data.filter(row => row.log_id !== seasons[2].log_id), beforeSeasonThree.data);

  const planned = media({ type: 'tv', id: `${prefix}-planned`, title: 'Planned TV fixture', status: 'planned', progress: null });
  await upsertMedia(planned);
  let plannedResult = await clientB.from('media_library').select('status,progress').eq('media_key', planned.media_key).single();
  assert.ifError(plannedResult.error);
  assert.deepEqual(plannedResult.data, { status: 'planned', progress: null });
  const { error: patchError } = await clientB.rpc('patch_user_media', {
    p_media_key: planned.media_key,
    p_updates: { status: 'in progress', progress: 'S01 E01' },
    p_revision: iso(300),
  });
  assert.ifError(patchError);
  plannedResult = await clientB.from('media_library').select('status,progress').eq('media_key', planned.media_key).single();
  assert.ifError(plannedResult.error);
  assert.deepEqual(plannedResult.data, { status: 'in progress', progress: 'S01 E01' });

  const collisionParents = [
    ['tmdb', 'movies'], ['tmdb', 'tv'], ['anilist', 'anime'], ['anilist', 'manga'], ['openlibrary', 'books'],
  ].map(([provider, type]) => media({ provider, type, id: '550', title: `${prefix} ${provider} ${type}` }));
  for (const row of collisionParents) await upsertMedia(row);
  const collisionKeys = collisionParents.map(row => row.media_key);
  const collisionResult = await clientB.from('media_library').select('media_key').in('media_key', collisionKeys);
  assert.ifError(collisionResult.error);
  assert.equal(collisionResult.data.length, 5);

  const resurrection = media({ id: `${prefix}-resurrection`, title: 'No-resurrection fixture', updatedAt: iso(400) });
  await upsertMedia(resurrection);
  const { error: deleteError } = await clientB.rpc('delete_user_media', { p_media_key: resurrection.media_key, p_deleted_at: iso(500) });
  assert.ifError(deleteError);
  const tombstone = await clientB.from('media_tombstones').select('deleted_at').eq('media_key', resurrection.media_key).single();
  assert.ifError(tombstone.error);
  const tombstoneTime = Date.parse(tombstone.data.deleted_at);
  await upsertMedia({ ...resurrection, updated_at: new Date(tombstoneTime - 1).toISOString() });
  let resurrected = await clientB.from('media_library').select('media_key').eq('media_key', resurrection.media_key);
  assert.ifError(resurrected.error);
  assert.equal(resurrected.data.length, 0);
  await upsertMedia({ ...resurrection, updated_at: new Date(tombstoneTime + 1).toISOString() });
  resurrected = await clientB.from('media_library').select('media_key').eq('media_key', resurrection.media_key);
  assert.ifError(resurrected.error);
  assert.equal(resurrected.data.length, 1);

  const uniqueFixtureKeys = [...mediaKeys].filter(key => key.includes(prefix));
  const aCannotSeeB = await clientA.from('media_library').select('media_key').in('media_key', uniqueFixtureKeys);
  assert.ifError(aCannotSeeB.error);
  assert.equal(aCannotSeeB.data.length, 0);

  console.log('PASS D1 distinct same-day create/edit and TV season sibling preservation through staging RPCs.');
  console.log('PASS K4 planned progress remains null and Episode 1 persists as S01 E01.');
  console.log('PASS owner isolation, canonical raw-ID collisions, and tombstone no-resurrection behavior.');
} finally {
  if (logIds.size) {
    const { error } = await clientB.from('media_logs').delete().in('log_id', [...logIds]);
    assert.ifError(error);
  }
  if (mediaKeys.size) {
    const { error } = await clientB.from('media_library').delete().in('media_key', [...mediaKeys]);
    assert.ifError(error);
    const mediaTombstoneDelete = await clientB.from('media_tombstones').delete().in('media_key', [...mediaKeys]);
    assert.ifError(mediaTombstoneDelete.error);
  }
  if (logIds.size) {
    const logTombstoneDelete = await clientB.from('log_tombstones').delete().in('log_id', [...logIds]);
    assert.ifError(logTombstoneDelete.error);
  }
  const final = {
    aMedia: await countRows(clientA, 'media_library'),
    aLogs: await countRows(clientA, 'media_logs'),
    bMedia: await countRows(clientB, 'media_library'),
    bLogs: await countRows(clientB, 'media_logs'),
  };
  assert.deepEqual(final, initial);
  console.log(`ACCOUNTING UserA=${final.aMedia}/${final.aLogs} UserB=${final.bMedia}/${final.bLogs}`);
  await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()]);
}
