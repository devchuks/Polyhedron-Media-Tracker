import assert from 'node:assert/strict';
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
const signInAndVerify = async (client, email, password, expectedId) => {
  const started = performance.now();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  assert.equal(data.user.id, expectedId);
  assert.ok(data.session?.access_token);
  const session = await client.auth.getSession();
  const user = await client.auth.getUser();
  assert.ifError(session.error);
  assert.ifError(user.error);
  assert.equal(session.data.session.user.id, expectedId);
  assert.equal(user.data.user.id, expectedId);
  return { accessToken: data.session.access_token, durationMs: performance.now() - started };
};
const countRows = async (client, table) => {
  const result = await client.from(table).select('*', { count: 'exact', head: true });
  assert.ifError(result.error);
  return result.count;
};

const clientA = makeClient();
const authA = await signInAndVerify(
  clientA, env.STAGING_USER_A_EMAIL, env.STAGING_USER_A_PASSWORD, env.STAGING_USER_A_ID,
);
const aCounts = {
  media: await countRows(clientA, 'media_library'),
  logs: await countRows(clientA, 'media_logs'),
  mediaTombstones: await countRows(clientA, 'media_tombstones'),
  logTombstones: await countRows(clientA, 'log_tombstones'),
};
const imageShapeResult = await clientA.from('media_library').select('type,status,progress,image,apiData');
assert.ifError(imageShapeResult.error);
const imageShapes = imageShapeResult.data.reduce((summary, row) => {
  const topLevel = typeof row.image === 'string' && row.image.length > 0;
  const nested = typeof row.apiData?.image === 'string' && row.apiData.image.length > 0;
  const raw = row.apiData?.raw || {};
  const providerDerived = Boolean(raw.poster_path || raw.cover_i || raw.cover?.image_id
    || raw.coverImage?.large || raw.coverImage?.extraLarge);
  summary.total += 1;
  if (topLevel) summary.topLevel += 1;
  if (nested) summary.nested += 1;
  if (providerDerived) summary.providerDerived += 1;
  if (topLevel && !nested && !providerDerived) summary.onlyTopLevel += 1;
  return summary;
}, { total: 0, topLevel: 0, nested: 0, providerDerived: 0, onlyTopLevel: 0 });
const plannedEpisodeZero = imageShapeResult.data.filter((row) => row.type === 'tv'
  && row.status === 'planned' && /^S\d+\s*E0+$/iu.test(String(row.progress || '').trim())).length;
const tvLogResult = await clientA.from('media_logs')
  .select('media_key,log_date,action_type,season_label,season_year')
  .eq('media_type', 'tv');
assert.ifError(tvLogResult.error);
const tvTimestampGroups = new Map();
const tvDayGroups = new Map();
for (const row of tvLogResult.data) {
  const timestampKey = `${row.media_key}\u0000${row.log_date}`;
  const dayKey = `${row.media_key}\u0000${String(row.log_date).slice(0, 10)}`;
  for (const [map, key] of [[tvTimestampGroups, timestampKey], [tvDayGroups, dayKey]]) {
    const group = map.get(key) || new Set();
    if (row.season_label) group.add(row.season_label);
    map.set(key, group);
  }
}
const multiSeasonExactTimestampGroups = [...tvTimestampGroups.values()].filter((group) => group.size > 1).length;
const multiSeasonSameDayGroups = [...tvDayGroups.values()].filter((group) => group.size > 1).length;

const timedRest = async ({ select, limit, offset = 0, token = authA.accessToken }) => {
  const query = new URLSearchParams({
    select,
    user_id: `eq.${env.STAGING_USER_A_ID}`,
    order: 'library_row_id.asc',
    offset: String(offset),
    limit: String(limit),
  });
  const started = performance.now();
  try {
    const response = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/media_library?${query}`, {
      headers: {
        apikey: env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Prefer: 'count=exact',
      },
      signal: AbortSignal.timeout(45_000),
    });
    const body = await response.text();
    let rowCount = null;
    let errorCode = null;
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) rowCount = parsed.length;
      else errorCode = parsed?.code || null;
    } catch { /* status and byte size remain sufficient */ }
    return {
      status: response.status,
      durationMs: Math.round(performance.now() - started),
      bytes: Buffer.byteLength(body),
      rowCount,
      errorCode,
    };
  } catch (error) {
    return {
      status: 0,
      durationMs: Math.round(performance.now() - started),
      bytes: 0,
      rowCount: null,
      errorCode: error.cause?.code || error.name,
      errorMessage: String(error.cause?.message || error.message || '').slice(0, 160),
    };
  }
};

const full1000 = await timedRest({ select: '*', limit: 1000 });
const withoutApiData = await timedRest({
  select: 'library_row_id,user_id,id,provider,provider_id,media_type,media_key,title,type,subtype,progress,status,rating,addedAt,dateStarted,dateCompleted,rewatchCount,readIssueIds,image,updated_at',
  limit: 1000,
});
const identityOnly = await timedRest({ select: 'library_row_id,user_id,media_key,updated_at', limit: 1000 });
const pageResults = [];
for (let offset = 0; offset < aCounts.media; offset += 100) {
  pageResults.push(await timedRest({ select: '*', limit: 100, offset }));
}
const chunked250Results = [];
for (let offset = 0; offset < aCounts.media; offset += 250) {
  chunked250Results.push(await timedRest({ select: '*', limit: 250, offset }));
}
const revisionFingerprint = await timedRest({
  select: 'library_row_id,updated_at',
  limit: 1000,
});

const badPasswordClient = makeClient();
const badStarted = performance.now();
const badPassword = await badPasswordClient.auth.signInWithPassword({
  email: env.STAGING_USER_A_EMAIL,
  password: `${env.STAGING_USER_A_PASSWORD}-incorrect`,
});
assert.ok(badPassword.error);
const badPasswordDurationMs = Math.round(performance.now() - badStarted);

const switchClient = makeClient();
await signInAndVerify(
  switchClient, env.STAGING_USER_A_EMAIL, env.STAGING_USER_A_PASSWORD, env.STAGING_USER_A_ID,
);
const switchAFirst = await countRows(switchClient, 'media_library');
assert.ifError((await switchClient.auth.signOut()).error);
await signInAndVerify(
  switchClient, env.STAGING_USER_B_EMAIL, env.STAGING_USER_B_PASSWORD, env.STAGING_USER_B_ID,
);
const switchB = await countRows(switchClient, 'media_library');
assert.ifError((await switchClient.auth.signOut()).error);
await signInAndVerify(
  switchClient, env.STAGING_USER_A_EMAIL, env.STAGING_USER_A_PASSWORD, env.STAGING_USER_A_ID,
);
const switchASecond = await countRows(switchClient, 'media_library');
assert.equal(switchAFirst, switchASecond);

const clientB = makeClient();
const authB = await signInAndVerify(
  clientB, env.STAGING_USER_B_EMAIL, env.STAGING_USER_B_PASSWORD, env.STAGING_USER_B_ID,
);
const bCounts = {
  media: await countRows(clientB, 'media_library'),
  logs: await countRows(clientB, 'media_logs'),
};

const successfulPages = pageResults.filter((row) => row.status >= 200 && row.status < 300);
const pagedRows = successfulPages.reduce((sum, row) => sum + (row.rowCount || 0), 0);
const pagedBytes = successfulPages.reduce((sum, row) => sum + row.bytes, 0);
const pagedDurationMs = pageResults.reduce((sum, row) => sum + row.durationMs, 0);
const pagedMaxDurationMs = Math.max(...pageResults.map((row) => row.durationMs));
const successfulChunks250 = chunked250Results.filter(row => row.status >= 200 && row.status < 300);
const chunked250Rows = successfulChunks250.reduce((sum, row) => sum + (row.rowCount || 0), 0);
const chunked250Bytes = successfulChunks250.reduce((sum, row) => sum + row.bytes, 0);
const chunked250DurationMs = chunked250Results.reduce((sum, row) => sum + row.durationMs, 0);
const chunked250MaxDurationMs = Math.max(...chunked250Results.map(row => row.durationMs));

console.log(`AUTH_A=PASS duration_ms=${Math.round(authA.durationMs)} media=${aCounts.media} logs=${aCounts.logs}`);
console.log(`AUTH_B=PASS duration_ms=${Math.round(authB.durationMs)} media=${bCounts.media} logs=${bCounts.logs}`);
console.log(`AUTH_SWITCH=PASS A=${switchAFirst} B=${switchB} A_AGAIN=${switchASecond}`);
console.log(`BAD_PASSWORD=PASS bounded_ms=${badPasswordDurationMs}`);
console.log(`SNAPSHOT_FULL_1000 status=${full1000.status} code=${full1000.errorCode || 'none'} duration_ms=${full1000.durationMs} bytes=${full1000.bytes} rows=${full1000.rowCount ?? 'none'}`);
console.log(`SNAPSHOT_NO_APIDATA status=${withoutApiData.status} code=${withoutApiData.errorCode || 'none'} duration_ms=${withoutApiData.durationMs} bytes=${withoutApiData.bytes} rows=${withoutApiData.rowCount ?? 'none'}`);
console.log(`SNAPSHOT_IDENTITY status=${identityOnly.status} code=${identityOnly.errorCode || 'none'} duration_ms=${identityOnly.durationMs} bytes=${identityOnly.bytes} rows=${identityOnly.rowCount ?? 'none'}`);
console.log(`SNAPSHOT_PAGED_100 pages=${pageResults.length} successful=${successfulPages.length} rows=${pagedRows} duration_ms=${pagedDurationMs} max_page_ms=${pagedMaxDurationMs} bytes=${pagedBytes}`);
console.log(`SNAPSHOT_PAGED_100_DETAILS ${pageResults.map((row, index) => `${index}:${row.status}/${row.errorCode || 'none'}/${row.rowCount ?? 'none'}${row.errorMessage ? `/${row.errorMessage}` : ''}`).join(' | ')}`);
console.log(`SNAPSHOT_CHUNKED_250 pages=${chunked250Results.length} successful=${successfulChunks250.length} rows=${chunked250Rows} duration_ms=${chunked250DurationMs} max_page_ms=${chunked250MaxDurationMs} bytes=${chunked250Bytes}`);
console.log(`SNAPSHOT_REVISION_FINGERPRINT status=${revisionFingerprint.status} duration_ms=${revisionFingerprint.durationMs} bytes=${revisionFingerprint.bytes} rows=${revisionFingerprint.rowCount ?? 'none'}`);
console.log(`TOMBSTONES_A media=${aCounts.mediaTombstones} logs=${aCounts.logTombstones}`);
console.log(`IMAGE_SHAPES total=${imageShapes.total} top_level=${imageShapes.topLevel} nested=${imageShapes.nested} provider_derived=${imageShapes.providerDerived} only_top_level=${imageShapes.onlyTopLevel}`);
console.log(`TV_FORENSICS planned_episode_zero=${plannedEpisodeZero} exact_timestamp_multi_season_groups=${multiSeasonExactTimestampGroups} same_day_multi_season_groups=${multiSeasonSameDayGroups}`);

await Promise.all([
  clientA.auth.signOut(), clientB.auth.signOut(), switchClient.auth.signOut(), badPasswordClient.auth.signOut(),
]);
for (const client of [clientA, clientB, switchClient, badPasswordClient]) client.realtime.disconnect();
