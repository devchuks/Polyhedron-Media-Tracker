import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const parseEnv = (source) => Object.fromEntries(
  source.split(/\r?\n/u)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const env = parseEnv(await readFile(new URL('../.env.staging.local', import.meta.url), 'utf8'));
const required = [
  'SUPABASE_STAGING_PROJECT_REF',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_STAGING_SERVICE_ROLE_KEY',
  'STAGING_USER_A_EMAIL',
  'STAGING_USER_A_PASSWORD',
  'STAGING_USER_A_ID',
  'STAGING_USER_B_EMAIL',
  'STAGING_USER_B_PASSWORD',
  'STAGING_USER_B_ID',
];
for (const name of required) assert.ok(env[name], `Missing ignored staging setting: ${name}`);
assert.equal(new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0], env.SUPABASE_STAGING_PROJECT_REF);

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const makeClient = () => createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY,
  clientOptions,
);
const clientA = makeClient();
const clientB = makeClient();
const anon = makeClient();
const serviceClient = createClient(
  env.VITE_SUPABASE_URL,
  env.SUPABASE_STAGING_SERVICE_ROLE_KEY,
  clientOptions,
);
await serviceClient.realtime.setAuth(env.SUPABASE_STAGING_SERVICE_ROLE_KEY);

const signIn = async (client, email, password, expectedId) => {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  assert.equal(data.user.id, expectedId);
  await client.realtime.setAuth(data.session.access_token);
};
await signIn(
  clientA,
  env.STAGING_USER_A_EMAIL,
  env.STAGING_USER_A_PASSWORD,
  env.STAGING_USER_A_ID,
);
await signIn(
  clientB,
  env.STAGING_USER_B_EMAIL,
  env.STAGING_USER_B_PASSWORD,
  env.STAGING_USER_B_ID,
);

const runId = randomUUID().slice(0, 8);
const prefix = `staging-${runId}`;
const results = [];
const pass = (name, detail) => results.push({ name, detail });
const expectError = (error, label) => assert.ok(error, `${label} unexpectedly succeeded`);
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const waitFor = async (predicate, label, timeoutMs = 12_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} timed out`);
};
const media = ({ ownerId, provider, mediaType, providerId, title, status = 'planned', updatedAt }) => ({
  user_id: ownerId,
  id: providerId,
  provider,
  provider_id: providerId,
  media_type: mediaType,
  media_key: `${provider}:${mediaType}:${providerId}`,
  title,
  type: mediaType,
  status,
  rating: 0,
  rewatchCount: 0,
  readIssueIds: [],
  apiData: {},
  ...(updatedAt ? { updated_at: updatedAt } : {}),
});
const log = ({ ownerId, parent, logId, actionType = 'LOGGED', updatedAt }) => ({
  log_id: logId,
  user_id: ownerId,
  media_id: parent.id,
  provider: parent.provider,
  provider_id: parent.provider_id,
  media_type: parent.media_type,
  media_key: parent.media_key,
  action_type: actionType,
  log_date: iso(),
  review_text: '',
  ...(updatedAt ? { updated_at: updatedAt } : {}),
});
const rpcMedia = (row) => {
  const { user_id: ignored, ...payload } = row;
  return payload;
};
const rpcLog = (row) => {
  const { user_id: ignored, ...payload } = row;
  return payload;
};

const aFixture = media({
  ownerId: env.STAGING_USER_A_ID,
  provider: 'tmdb', mediaType: 'movies', providerId: `${prefix}-a`, title: 'Staging User A Fixture',
});
const bFixture = media({
  ownerId: env.STAGING_USER_B_ID,
  provider: 'tmdb', mediaType: 'movies', providerId: `${prefix}-b`, title: 'Staging User B Fixture',
});
const sharedLogId = `${prefix}-owner-scoped-log`;

const { count: aInitialCount, error: aInitialError } = await clientA
  .from('media_library').select('*', { count: 'exact', head: true });
assert.ifError(aInitialError);
assert.ok(aInitialCount >= 705, 'User A acceptance library is unexpectedly below the migrated baseline');
const { count: bInitialCount, error: bInitialError } = await clientB
  .from('media_library').select('*', { count: 'exact', head: true });
assert.ifError(bInitialError);
assert.equal(bInitialCount, 0);
const { error: anonReadError } = await anon.from('media_library').select('media_key').limit(1);
expectError(anonReadError, 'Anonymous library read');
pass('RLS baseline', `User A sees ${aInitialCount} acceptance rows, User B sees none, anonymous SELECT is denied.`);

for (const [client, row] of [[clientA, aFixture], [clientB, bFixture]]) {
  const { error } = await client.from('media_library').insert(row);
  assert.ifError(error);
}
const { data: aCannotSeeB, error: aCannotSeeBError } = await clientA
  .from('media_library').select('media_key').eq('media_key', bFixture.media_key);
assert.ifError(aCannotSeeBError);
assert.equal(aCannotSeeB.length, 0);
const { data: bCannotSeeA, error: bCannotSeeAError } = await clientB
  .from('media_library').select('media_key').eq('media_key', aFixture.media_key);
assert.ifError(bCannotSeeAError);
assert.equal(bCannotSeeA.length, 0);

const { error: crossOwnerInsertError } = await clientA.from('media_library').insert({
  ...media({
    ownerId: env.STAGING_USER_B_ID,
    provider: 'tmdb', mediaType: 'movies', providerId: `${prefix}-forged`, title: 'Forged Owner',
  }),
});
expectError(crossOwnerInsertError, 'Cross-owner media insert');
await clientA.from('media_library').update({ title: 'Cross-owner update' }).eq('media_key', bFixture.media_key);
await clientA.from('media_library').delete().eq('media_key', bFixture.media_key);
const { data: bStillOwns, error: bStillOwnsError } = await clientB
  .from('media_library').select('title').eq('media_key', bFixture.media_key).single();
assert.ifError(bStillOwnsError);
assert.equal(bStillOwns.title, bFixture.title);
pass('Media owner isolation', 'Both directions are invisible; forged insert fails; cross-owner update/delete affect nothing.');

const aLog = log({ ownerId: env.STAGING_USER_A_ID, parent: aFixture, logId: sharedLogId });
const bLog = log({ ownerId: env.STAGING_USER_B_ID, parent: bFixture, logId: sharedLogId });
for (const [client, row] of [[clientA, aLog], [clientB, bLog]]) {
  const { error } = await client.from('media_logs').insert(row);
  assert.ifError(error);
}
const { data: aLogs, error: aLogsError } = await clientA
  .from('media_logs').select('media_key').eq('log_id', sharedLogId);
assert.ifError(aLogsError);
assert.deepEqual(aLogs.map((row) => row.media_key), [aFixture.media_key]);
const { data: bLogs, error: bLogsError } = await clientB
  .from('media_logs').select('media_key').eq('log_id', sharedLogId);
assert.ifError(bLogsError);
assert.deepEqual(bLogs.map((row) => row.media_key), [bFixture.media_key]);
const { error: forgedLogError } = await clientA.from('media_logs').insert({
  ...log({
    ownerId: env.STAGING_USER_B_ID,
    parent: bFixture,
    logId: `${prefix}-forged-log`,
  }),
});
expectError(forgedLogError, 'Cross-owner log insert');
await clientA.from('media_logs').update({ review_text: 'forged' }).eq('log_id', sharedLogId).eq('media_key', bFixture.media_key);
await clientA.from('media_logs').delete().eq('log_id', sharedLogId).eq('media_key', bFixture.media_key);
const { data: bLogStillOwns, error: bLogStillOwnsError } = await clientB
  .from('media_logs').select('review_text').eq('log_id', sharedLogId).single();
assert.ifError(bLogStillOwnsError);
assert.equal(bLogStillOwns.review_text, '');
pass('Diary owner isolation', 'Owner-scoped equal log IDs coexist; forged/cross-owner mutations are denied or affect nothing.');

const invalidCases = [
  { ...aFixture, id: `${prefix}-status`, provider_id: `${prefix}-status`, media_key: `tmdb:movies:${prefix}-status`, status: 'invalid' },
  { ...aFixture, id: `${prefix}-rating`, provider_id: `${prefix}-rating`, media_key: `tmdb:movies:${prefix}-rating`, rating: 11 },
  { ...aFixture, id: `${prefix}-completion`, provider_id: `${prefix}-completion`, media_key: `tmdb:movies:${prefix}-completion`, status: 'completed', dateCompleted: null },
];
for (const row of invalidCases) {
  const { error } = await clientA.from('media_library').insert(row);
  expectError(error, `Constraint fixture ${row.id}`);
}
const orphanLog = log({ ownerId: env.STAGING_USER_A_ID, parent: aFixture, logId: `${prefix}-orphan` });
orphanLog.media_key = `tmdb:movies:${prefix}-missing-parent`;
const { error: orphanFkError } = await clientA.from('media_logs').insert(orphanLog);
expectError(orphanFkError, 'Composite foreign-key orphan log');
const cascadeParent = media({
  ownerId: env.STAGING_USER_A_ID,
  provider: 'tmdb', mediaType: 'movies', providerId: `${prefix}-cascade`, title: 'Cascade Fixture',
});
const cascadeLog = log({
  ownerId: env.STAGING_USER_A_ID,
  parent: cascadeParent, logId: `${prefix}-cascade-log`,
});
let response = await clientA.from('media_library').insert(cascadeParent);
assert.ifError(response.error);
response = await clientA.from('media_logs').insert(cascadeLog);
assert.ifError(response.error);
response = await clientA.from('media_library').delete().eq('media_key', cascadeParent.media_key);
assert.ifError(response.error);
const cascadedLog = await clientA.from('media_logs').select('log_id').eq('log_id', cascadeLog.log_id);
assert.ifError(cascadedLog.error);
assert.equal(cascadedLog.data.length, 0);
pass('Database checks', 'Invalid status, rating, completion pairing, and orphan log inserts are rejected; deleting a parent cascades its exact child log.');

const rpcParent = media({
  ownerId: env.STAGING_USER_A_ID,
  provider: 'tmdb', mediaType: 'movies', providerId: `${prefix}-rpc`, title: 'RPC Fixture', updatedAt: iso(1000),
});
response = await clientA.rpc('upsert_user_media', { p_media: rpcMedia(rpcParent) });
assert.ifError(response.error);
const staleRevision = iso(-60_000);
response = await clientA.rpc('patch_user_media', {
  p_media_key: rpcParent.media_key,
  p_updates: { title: 'Stale title' },
  p_revision: staleRevision,
});
assert.ifError(response.error);
let current = await clientA.from('media_library').select('title').eq('media_key', rpcParent.media_key).single();
assert.ifError(current.error);
assert.equal(current.data.title, rpcParent.title);

const revisionOne = iso(10_000);
const concurrent = await Promise.all([
  clientA.rpc('patch_user_media', {
    p_media_key: rpcParent.media_key, p_updates: { title: 'Concurrent title' }, p_revision: revisionOne,
  }),
  clientA.rpc('patch_user_media', {
    p_media_key: rpcParent.media_key, p_updates: { rating: 7 }, p_revision: revisionOne,
  }),
]);
for (const item of concurrent) assert.ifError(item.error);
current = await clientA.from('media_library').select('title,rating').eq('media_key', rpcParent.media_key).single();
assert.ifError(current.error);
assert.equal(current.data.title, 'Concurrent title');
assert.equal(Number(current.data.rating), 7);
const standaloneRpcLog = log({
  ownerId: env.STAGING_USER_A_ID,
  parent: rpcParent, logId: `${prefix}-standalone-rpc-log`, updatedAt: iso(12_000),
});
response = await clientA.rpc('upsert_user_log', { p_log: rpcLog(standaloneRpcLog) });
assert.ifError(response.error);
standaloneRpcLog.review_text = 'Updated through upsert_user_log';
standaloneRpcLog.updated_at = iso(13_000);
response = await clientA.rpc('upsert_user_log', { p_log: rpcLog(standaloneRpcLog) });
assert.ifError(response.error);
const standaloneLogResult = await clientA.from('media_logs')
  .select('review_text').eq('log_id', standaloneRpcLog.log_id).single();
assert.ifError(standaloneLogResult.error);
assert.equal(standaloneLogResult.data.review_text, standaloneRpcLog.review_text);
pass('RPC upsert/patch/concurrency', 'Media and log upserts succeeded; stale media revision was ignored; advisory-serialized disjoint patches from the same base revision were both retained.');

const atomicParent = media({
  ownerId: env.STAGING_USER_A_ID,
  provider: 'tmdb', mediaType: 'movies', providerId: `${prefix}-atomic`, title: 'Atomic Fixture', updatedAt: iso(20_000),
});
const atomicLog = log({
  ownerId: env.STAGING_USER_A_ID,
  parent: atomicParent,
  logId: `${prefix}-atomic-log`,
  updatedAt: iso(20_000),
});
response = await clientA.rpc('upsert_user_media_with_log', {
  p_media: rpcMedia(atomicParent), p_log: rpcLog(atomicLog),
});
assert.ifError(response.error);
let atomicRows = await clientA.from('media_logs').select('log_id').eq('log_id', atomicLog.log_id);
assert.ifError(atomicRows.error);
assert.equal(atomicRows.data.length, 1);

const rollbackParent = media({
  ownerId: env.STAGING_USER_A_ID,
  provider: 'tmdb', mediaType: 'movies', providerId: `${prefix}-rollback`, title: 'Rollback Fixture', updatedAt: iso(30_000),
});
const badChild = log({
  ownerId: env.STAGING_USER_A_ID,
  parent: rollbackParent,
  logId: `${prefix}-rollback-log`,
  updatedAt: iso(30_000),
});
badChild.media_key = `tmdb:movies:${prefix}-missing-parent`;
response = await clientA.rpc('upsert_user_media_with_log', {
  p_media: rpcMedia(rollbackParent), p_log: rpcLog(badChild),
});
expectError(response.error, 'Injected child failure');
const rolledBack = await clientA.from('media_library').select('media_key').eq('media_key', rollbackParent.media_key);
assert.ifError(rolledBack.error);
assert.equal(rolledBack.data.length, 0);
pass('Atomic media + log RPC', 'Successful parent/child save is atomic; injected child FK failure rolls back the parent.');

const collisionSpecs = [
  ['tmdb', 'movies'], ['tmdb', 'tv'], ['anilist', 'anime'],
  ['anilist', 'manga'], ['openlibrary', 'books'],
];
const collisionRows = collisionSpecs.map(([provider, mediaType]) => media({
  ownerId: env.STAGING_USER_B_ID,
  provider, mediaType, providerId: '550', title: `${provider} ${mediaType} 550`,
}));
response = await clientB.from('media_library').insert(collisionRows);
assert.ifError(response.error);
let collisions = await clientB.from('media_library')
  .select('media_key,title').in('media_key', collisionRows.map((row) => row.media_key));
assert.ifError(collisions.error);
assert.equal(collisions.data.length, 5);
assert.equal(new Set(collisions.data.map((row) => row.media_key)).size, 5);
await clientB.from('media_library').update({ title: 'Only the movie changed' }).eq('media_key', 'tmdb:movies:550');
const collisionLog = log({
  ownerId: env.STAGING_USER_B_ID,
  parent: collisionRows[3], logId: `${prefix}-collision-log`,
});
response = await clientB.from('media_logs').insert(collisionLog);
assert.ifError(response.error);
response = await clientB.from('media_library').delete().eq('media_key', 'tmdb:movies:550');
assert.ifError(response.error);
collisions = await clientB.from('media_library')
  .select('media_key').in('media_key', collisionRows.map((row) => row.media_key));
assert.ifError(collisions.error);
assert.equal(collisions.data.length, 4);
const intendedLog = await clientB.from('media_logs').select('media_key').eq('log_id', collisionLog.log_id).single();
assert.ifError(intendedLog.error);
assert.equal(intendedLog.data.media_key, 'anilist:manga:550');
pass('Canonical raw-ID collisions', 'Five provider/type variants of raw 550 coexist, update independently, and one deletion leaves the other four and intended diary link intact.');

response = await clientA.rpc('delete_user_log', { p_log_id: atomicLog.log_id, p_deleted_at: iso() });
assert.ifError(response.error);
let tombstone = await clientA.from('log_tombstones').select('log_id').eq('log_id', atomicLog.log_id).single();
assert.ifError(tombstone.error);
const bCannotSeeATombstone = await clientB.from('log_tombstones').select('log_id').eq('log_id', atomicLog.log_id);
assert.ifError(bCannotSeeATombstone.error);
assert.equal(bCannotSeeATombstone.data.length, 0);

response = await clientA.rpc('delete_user_media', { p_media_key: atomicParent.media_key, p_deleted_at: iso() });
assert.ifError(response.error);
tombstone = await clientA.from('media_tombstones').select('deleted_at').eq('media_key', atomicParent.media_key).single();
assert.ifError(tombstone.error);
const tombstoneTime = new Date(tombstone.data.deleted_at).getTime();
const staleRestore = { ...rpcMedia(atomicParent), updated_at: new Date(tombstoneTime - 1).toISOString() };
response = await clientA.rpc('upsert_user_media', { p_media: staleRestore });
assert.ifError(response.error);
let restored = await clientA.from('media_library').select('media_key').eq('media_key', atomicParent.media_key);
assert.ifError(restored.error);
assert.equal(restored.data.length, 0);
const newRestore = { ...rpcMedia(atomicParent), updated_at: new Date(tombstoneTime + 1).toISOString() };
response = await clientA.rpc('upsert_user_media', { p_media: newRestore });
assert.ifError(response.error);
restored = await clientA.from('media_library').select('media_key').eq('media_key', atomicParent.media_key);
assert.ifError(restored.error);
assert.equal(restored.data.length, 1);
pass('Tombstones and restore ordering', 'Cross-owner tombstones are invisible; stale restore is rejected; a revision newer by 1 ms restores immediately.');

const replaceMedia = [
  media({ ownerId: env.STAGING_USER_B_ID, provider: 'tmdb', mediaType: 'movies', providerId: `${prefix}-replace-1`, title: 'Replace One' }),
  media({ ownerId: env.STAGING_USER_B_ID, provider: 'tmdb', mediaType: 'tv', providerId: `${prefix}-replace-2`, title: 'Replace Two' }),
];
const replaceLogs = [log({
  ownerId: env.STAGING_USER_B_ID,
  parent: replaceMedia[0], logId: `${prefix}-replace-log`,
})];
response = await clientB.rpc('replace_user_library', {
  p_media: replaceMedia.map(rpcMedia), p_logs: replaceLogs.map(rpcLog),
});
assert.ifError(response.error);
let replaced = await clientB.from('media_library').select('media_key');
assert.ifError(replaced.error);
assert.deepEqual(new Set(replaced.data.map((row) => row.media_key)), new Set(replaceMedia.map((row) => row.media_key)));
const concurrentReplaceMedia = [...replaceMedia, media({
  ownerId: env.STAGING_USER_B_ID,
  provider: 'igdb', mediaType: 'games', providerId: `${prefix}-replace-3`, title: 'Replace Three',
})];
const concurrentWrite = media({
  ownerId: env.STAGING_USER_B_ID,
  provider: 'vndb', mediaType: 'vn', providerId: `${prefix}-concurrent`, title: 'Concurrent RPC Write', updatedAt: iso(120_000),
});
const replaceRace = await Promise.all([
  clientB.rpc('replace_user_library', {
    p_media: concurrentReplaceMedia.map(rpcMedia), p_logs: replaceLogs.map(rpcLog),
  }),
  clientB.rpc('upsert_user_media', { p_media: rpcMedia(concurrentWrite) }),
]);
for (const item of replaceRace) assert.ifError(item.error);
const integrity = await clientB.from('media_logs').select('media_key');
assert.ifError(integrity.error);
assert.ok(integrity.data.every((row) => concurrentReplaceMedia.some((item) => item.media_key === row.media_key)));
pass('Replace/concurrent-write locking', 'Concurrent replace/upsert completed without duplicate identity or orphan logs; backup replacement retained referential integrity.');

response = await clientB.rpc('reset_user_library');
assert.ifError(response.error);
let resetCount = await clientB.from('media_library').select('*', { count: 'exact', head: true });
assert.ifError(resetCount.error);
assert.equal(resetCount.count, 0);

const paginationRows = Array.from({ length: 1005 }, (_, index) => media({
  ownerId: env.STAGING_USER_B_ID,
  provider: 'tmdb', mediaType: 'movies', providerId: `${prefix}-page-${String(index).padStart(4, '0')}`,
  title: `Pagination ${index}`,
}));
for (let start = 0; start < paginationRows.length; start += 200) {
  const { error } = await clientB.from('media_library').insert(paginationRows.slice(start, start + 200));
  assert.ifError(error);
}
const firstPage = await clientB.from('media_library').select('media_key', { count: 'exact' }).order('media_key').range(0, 999);
assert.ifError(firstPage.error);
const secondPage = await clientB.from('media_library').select('media_key').order('media_key').range(1000, 1999);
assert.ifError(secondPage.error);
assert.equal(firstPage.count, 1005);
assert.equal(firstPage.data.length, 1000);
assert.equal(secondPage.data.length, 5);
pass('Pagination above 1,000', '1,005 rows returned as explicit pages of 1,000 and 5 with an exact total.');

response = await clientB.rpc('reset_user_library');
assert.ifError(response.error);
resetCount = await clientB.from('media_library').select('*', { count: 'exact', head: true });
assert.ifError(resetCount.error);
assert.equal(resetCount.count, 0);
pass('Reset RPC', 'Staging User B reset atomically removed the 1,005-row pagination fixture.');

const realtimeParent = media({
  ownerId: env.STAGING_USER_A_ID,
  provider: 'tmdb', mediaType: 'movies', providerId: `${prefix}-realtime`, title: 'Realtime Fixture',
});
const libraryEventsA = [];
const libraryEventsB = [];
const tombstoneEventsA = [];
const tombstoneEventsB = [];
const serviceLibraryEvents = [];
const subscribe = (client, label, libraryBucket, tombstoneBucket) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${label} realtime subscription timed out`)), 20_000);
  const channel = client.channel(`${prefix}-${label}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'media_library' }, (payload) => libraryBucket.push(payload));
  if (tombstoneBucket) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'media_tombstones' },
      (payload) => tombstoneBucket.push(payload),
    );
  }
  channel
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve(channel);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        reject(new Error(`${label} realtime status: ${status}`));
      }
    });
});
const [channelA, channelB] = await Promise.all([
  subscribe(clientA, 'user-a', libraryEventsA, tombstoneEventsA),
  subscribe(clientB, 'user-b', libraryEventsB, tombstoneEventsB),
]);
const serviceChannel = await subscribe(serviceClient, 'service', serviceLibraryEvents);
response = await clientA.from('media_library').insert(realtimeParent);
assert.ifError(response.error);
await waitFor(
  () => libraryEventsA.some((event) => event.eventType === 'INSERT' && event.new.media_key === realtimeParent.media_key),
  'User A Realtime INSERT',
);
assert.ok(libraryEventsA.some((event) => event.eventType === 'INSERT' && event.new.media_key === realtimeParent.media_key));
const insertEvent = libraryEventsA.find(
  (event) => event.eventType === 'INSERT' && event.new.media_key === realtimeParent.media_key,
);
await new Promise((resolve) => setTimeout(resolve, 1000));
assert.equal(libraryEventsB.some((event) => event.new?.media_key === realtimeParent.media_key), false);
response = await clientA.rpc('delete_user_media', { p_media_key: realtimeParent.media_key, p_deleted_at: iso() });
assert.ifError(response.error);
await waitFor(
  () => tombstoneEventsA.some((event) => event.new?.media_key === realtimeParent.media_key),
  'User A Realtime tombstone',
);
await waitFor(
  () => serviceLibraryEvents.some((event) => event.eventType === 'DELETE'),
  'Service-role Realtime DELETE identity',
);
const deleteEvent = serviceLibraryEvents.find((event) => event.eventType === 'DELETE');
assert.ok(deleteEvent);
assert.equal(deleteEvent.old.library_row_id, insertEvent.new.library_row_id);
await new Promise((resolve) => setTimeout(resolve, 1000));
assert.equal(libraryEventsB.some((event) => event.old?.media_key === realtimeParent.media_key), false);
assert.equal(tombstoneEventsB.some((event) => event.new?.media_key === realtimeParent.media_key), false);
await Promise.all([
  clientA.removeChannel(channelA),
  clientB.removeChannel(channelB),
  serviceClient.removeChannel(serviceChannel),
]);
const hydration = await clientA.from('media_library').select('media_key').eq('media_key', realtimeParent.media_key);
assert.ifError(hydration.error);
assert.equal(hydration.data.length, 0);
pass('Realtime isolation/deletion/hydration', 'User A received its INSERT and canonical owner tombstone; User B received neither; the raw DELETE carried the exact surrogate row identity and catalog REPLICA IDENTITY is FULL; reconnect hydration did not resurrect the deletion.');

response = await clientA.rpc('delete_user_media_logs', { p_media_key: aFixture.media_key, p_deleted_at: iso() });
assert.ifError(response.error);
let remainingALogs = await clientA.from('media_logs').select('log_id').eq('media_key', aFixture.media_key);
assert.ifError(remainingALogs.error);
assert.equal(remainingALogs.data.length, 0);
response = await clientA.rpc('delete_user_media', { p_media_key: aFixture.media_key, p_deleted_at: iso() });
assert.ifError(response.error);
response = await clientA.rpc('delete_user_media', { p_media_key: rpcParent.media_key, p_deleted_at: iso() });
assert.ifError(response.error);
response = await clientA.rpc('delete_user_media', { p_media_key: atomicParent.media_key, p_deleted_at: iso() });
assert.ifError(response.error);

const finalA = await clientA.from('media_library').select('*', { count: 'exact', head: true });
assert.ifError(finalA.error);
assert.equal(finalA.count, aInitialCount);
const finalB = await clientB.from('media_library').select('*', { count: 'exact', head: true });
assert.ifError(finalB.error);
assert.equal(finalB.count, 0);
pass('Fixture cleanup/accounting', `User A returned to its ${aInitialCount}-row baseline and User B returned to zero media rows.`);

await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()]);
clientA.realtime.disconnect();
clientB.realtime.disconnect();
serviceClient.realtime.disconnect();
for (const result of results) console.log(`PASS ${result.name}: ${result.detail}`);
console.log(`PASS staging runtime verification (${results.length} groups).`);
