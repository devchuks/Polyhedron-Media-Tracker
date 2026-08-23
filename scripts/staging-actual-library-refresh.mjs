import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const execFileAsync = promisify(execFile);
const repoRoot = new URL('../', import.meta.url);
const repoPath = decodeURIComponent(repoRoot.pathname).replace(/^\/(?:([A-Za-z]:))/u, '$1');
const sqlPath = (relativePath) => `${repoPath.replace(/[\\/]$/u, '')}/${relativePath}`.replaceAll('/', '\\');
const isWindows = process.platform === 'win32';
const cli = isWindows ? process.env.ComSpec || 'cmd.exe' : 'npx';
const cliPrefix = isWindows ? ['/d', '/c', 'npx.cmd'] : [];

const parseEnv = (source) => Object.fromEntries(
  source.split(/\r?\n/u)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);
const staging = parseEnv(await readFile(new URL('../.env.staging.local', import.meta.url), 'utf8'));
for (const name of [
  'SUPABASE_STAGING_PROJECT_REF', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_STAGING_SERVICE_ROLE_KEY', 'STAGING_USER_A_EMAIL', 'STAGING_USER_A_PASSWORD',
  'STAGING_USER_A_ID', 'STAGING_USER_B_EMAIL', 'STAGING_USER_B_PASSWORD', 'STAGING_USER_B_ID',
]) assert.ok(staging[name], `Missing ignored staging setting: ${name}`);

const productionRef = (await readFile(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8')).trim();
const stagingLinkedRef = (await readFile(
  new URL('../.supabase/staging/supabase/.temp/project-ref', import.meta.url),
  'utf8',
)).trim();
assert.equal(stagingLinkedRef, staging.SUPABASE_STAGING_PROJECT_REF);
assert.notEqual(productionRef, stagingLinkedRef);
assert.equal(new URL(staging.VITE_SUPABASE_URL).hostname.split('.')[0], stagingLinkedRef);

const runCli = async (args) => {
  const { stdout } = await execFileAsync(cli, [...cliPrefix, '--yes', 'supabase@2.105.0', ...args], {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
};
const parseCliJson = (output) => {
  const clean = output.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  assert.ok(start >= 0 && end > start, 'Supabase CLI did not return a JSON result');
  return JSON.parse(clean.slice(start, end + 1));
};

// This is the only production operation in this script. The SQL file contains
// one SELECT and the full result remains in process memory.
const productionOutput = await runCli([
  'db', 'query', '--linked', '--file',
  sqlPath('supabase/hosted-verification/production_actual_fixture_export.sql'),
]);
const productionEnvelope = parseCliJson(productionOutput);
const fixture = productionEnvelope.rows?.[0]?.actual_fixture;
assert.ok(fixture && Array.isArray(fixture.media) && Array.isArray(fixture.logs));
assert.equal(fixture.library_rows, fixture.media.length);
assert.equal(fixture.log_rows, fixture.logs.length);
assert.equal(fixture.library_owners, 1);
assert.equal(fixture.log_owners, 1);
assert.equal(fixture.media.length, 705, 'Production library count drifted after the approved preflight');
assert.equal(fixture.logs.length, 658, 'Production diary count drifted after the approved preflight');

const completionTargets = new Map([
  ['movies:1083381', { title: 'Backrooms', source: 'dateStarted' }],
  ['movies:36557', { title: 'Casino Royale', logId: '140de8e8-a7d8-4963-849e-f2f39bf7d2ba' }],
  ['movies:1380316', { title: 'Is God Is', source: 'dateStarted' }],
  ['movies:10764', { title: 'Quantum of Solace', logId: '2c348f41-a6a7-4318-958b-9bbca2dd1199' }],
  ['movies:1368337', { title: 'The Odyssey', source: 'dateStarted' }],
]);
const bogusLogIds = new Set([
  '08c943c8-cbf4-4462-b29e-780421751dbf',
  '922ad384-ce27-4daa-a5fc-591a30eb012e',
]);
const currentCompletionBlockers = fixture.media.filter(
  (row) => row.status === 'completed' && row.dateCompleted === null,
);
assert.equal(currentCompletionBlockers.length, 5);
for (const row of currentCompletionBlockers) {
  const target = completionTargets.get(`${row.type}:${row.id}`);
  assert.ok(target, `Unexpected current completion blocker: ${row.type}:${row.id}`);
  assert.equal(row.title, target.title);
}
const currentBogusLogs = fixture.logs.filter((row) => bogusLogIds.has(row.log_id));
assert.equal(currentBogusLogs.length, 2);
assert.deepEqual(
  currentBogusLogs.map((row) => [row.log_id, row.media_type, row.media_id, row.action_type]).sort(),
  [
    ['08c943c8-cbf4-4462-b29e-780421751dbf', 'manga', '77917', 'READ'],
    ['922ad384-ce27-4daa-a5fc-591a30eb012e', 'vn', 'v1298', 'PLAYED'],
  ],
);

const serviceClient = createClient(
  staging.VITE_SUPABASE_URL,
  staging.SUPABASE_STAGING_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);
const ensureAuthUser = async (userId) => {
  const { data, error } = await serviceClient.auth.admin.getUserById(userId);
  assert.ifError(error);
  assert.equal(data.user.id, userId);
  assert.ok(data.user.email_confirmed_at, 'Staging Auth user must be email-confirmed');
};
await ensureAuthUser(staging.STAGING_USER_A_ID);
await ensureAuthUser(staging.STAGING_USER_B_ID);

await runCli([
  'db', 'query', '--linked', '--workdir', '.supabase/staging', '--file',
  sqlPath('supabase/staging-verification/manual_acceptance_reset.sql'),
]);
await runCli([
  'db', 'query', '--linked', '--workdir', '.supabase/staging', '--file',
  sqlPath('supabase/staging-verification/legacy_schema.sql'),
]);

const withOwner = (row) => ({ ...row, user_id: staging.STAGING_USER_A_ID });
const insertBatches = async (table, rows, size) => {
  for (let index = 0; index < rows.length; index += size) {
    const batch = rows.slice(index, index + size).map(withOwner);
    let lastError;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const { error } = await serviceClient.from(table).insert(batch);
      if (!error) { lastError = null; break; }
      lastError = error;
      if (!/schema cache|does not exist|could not find/iu.test(error.message)) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    assert.ifError(lastError);
  }
};
await insertBatches('media_library', fixture.media, 20);
await insertBatches('media_logs', fixture.logs, 40);

await runCli([
  'db', 'query', '--linked', '--workdir', '.supabase/staging', '--file',
  sqlPath('supabase/migrations/202608160000_reconcile_legacy_blockers.sql'),
]);
await runCli([
  'db', 'query', '--linked', '--workdir', '.supabase/staging', '--file',
  sqlPath('supabase/migrations/202608160001_canonical_identity_rls.sql'),
]);

const fetchAll = async (client, table, ownerId) => {
  const rows = [];
  for (let start = 0; ; start += 500) {
    let result;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      result = await client.from(table).select('*').eq('user_id', ownerId).range(start, start + 499);
      if (!result.error) break;
      if (!/schema cache|could not find/iu.test(result.error.message)) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    assert.ifError(result.error);
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
  }
};
const stagedMedia = await fetchAll(serviceClient, 'media_library', staging.STAGING_USER_A_ID);
const stagedLogs = await fetchAll(serviceClient, 'media_logs', staging.STAGING_USER_A_ID);
assert.equal(stagedMedia.length, 705);
assert.equal(stagedLogs.length, 656);
assert.equal((await fetchAll(serviceClient, 'media_library', staging.STAGING_USER_B_ID)).length, 0);
assert.equal((await fetchAll(serviceClient, 'media_logs', staging.STAGING_USER_B_ID)).length, 0);

const providerFor = (type) => ({
  movies: 'tmdb', tv: 'tmdb', games: 'igdb', anime: 'anilist', manga: 'anilist',
  vn: 'vndb', books: 'openlibrary', comics: 'metron',
})[type];
const providerIdFor = (type, id) => {
  if (type === 'games') return String(id).replace(/^igdb_/iu, '');
  if (type === 'books') return String(id).replace(/^\/works\//iu, '');
  return String(id);
};
const numberOrNull = (value) => value === null || value === undefined ? null : Number(value);
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stable(value[key])]),
  );
  return value;
};
const hash = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const mediaFields = [
  'id', 'title', 'type', 'subtype', 'progress', 'status', 'rating', 'addedAt',
  'dateStarted', 'dateCompleted', 'rewatchCount', 'readIssueIds', 'image', 'apiData',
];
const logFields = [
  'log_id', 'media_id', 'media_type', 'action_type', 'log_date', 'review_text',
  'image', 'season_label', 'season_year',
];
const pick = (row, fields) => Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
const normalizeMedia = (row) => {
  const normalized = pick(row, mediaFields);
  for (const field of ['rating', 'addedAt', 'dateStarted', 'dateCompleted', 'rewatchCount']) {
    normalized[field] = numberOrNull(normalized[field]);
  }
  return normalized;
};
const normalizeLog = (row) => {
  const normalized = pick(row, logFields);
  normalized.log_date = new Date(normalized.log_date).toISOString();
  return normalized;
};
const watchedCompletion = new Map();
for (const target of completionTargets.values()) {
  if (target.logId) {
    const matching = fixture.logs.filter((row) => row.log_id === target.logId);
    assert.equal(matching.length, 1);
    watchedCompletion.set(target.logId, new Date(matching[0].log_date).getTime());
  }
}
const expectedMedia = fixture.media.map((source) => {
  const row = normalizeMedia(source);
  const target = completionTargets.get(`${row.type}:${row.id}`);
  if (target) row.dateCompleted = target.source === 'dateStarted'
    ? row.dateStarted
    : watchedCompletion.get(target.logId);
  return row;
}).sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
const actualMedia = stagedMedia.map(normalizeMedia)
  .sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
const expectedLogs = fixture.logs.filter((row) => !bogusLogIds.has(row.log_id)).map(normalizeLog)
  .sort((a, b) => a.log_id.localeCompare(b.log_id));
const actualLogs = stagedLogs.map(normalizeLog).sort((a, b) => a.log_id.localeCompare(b.log_id));
assert.equal(hash(actualMedia), hash(expectedMedia), 'Full-fidelity media content comparison failed');
assert.equal(hash(actualLogs), hash(expectedLogs), 'Full-fidelity diary content comparison failed');

for (const row of stagedMedia) {
  const provider = providerFor(row.type);
  const providerId = providerIdFor(row.type, row.id);
  assert.equal(row.user_id, staging.STAGING_USER_A_ID);
  assert.equal(row.provider, provider);
  assert.equal(row.provider_id, providerId);
  assert.equal(row.media_type, row.type);
  assert.equal(row.media_key, `${provider}:${row.type}:${providerId}`);
}
for (const row of stagedLogs) assert.equal(row.user_id, staging.STAGING_USER_A_ID);

const userAClient = createClient(staging.VITE_SUPABASE_URL, staging.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const userBClient = createClient(staging.VITE_SUPABASE_URL, staging.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const signIn = async (client, email, password, expectedId) => {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  assert.equal(data.user.id, expectedId);
  assert.ok(data.user.email_confirmed_at);
};
await signIn(userAClient, staging.STAGING_USER_A_EMAIL, staging.STAGING_USER_A_PASSWORD, staging.STAGING_USER_A_ID);
await signIn(userBClient, staging.STAGING_USER_B_EMAIL, staging.STAGING_USER_B_PASSWORD, staging.STAGING_USER_B_ID);
const aMediaCount = await userAClient.from('media_library').select('*', { count: 'exact', head: true });
const aLogCount = await userAClient.from('media_logs').select('*', { count: 'exact', head: true });
const bMediaCount = await userBClient.from('media_library').select('*', { count: 'exact', head: true });
const bLogCount = await userBClient.from('media_logs').select('*', { count: 'exact', head: true });
for (const result of [aMediaCount, aLogCount, bMediaCount, bLogCount]) assert.ifError(result.error);
assert.equal(aMediaCount.count, 705);
assert.equal(aLogCount.count, 656);
assert.equal(bMediaCount.count, 0);
assert.equal(bLogCount.count, 0);

const sourceNonemptyReviews = fixture.logs.filter((row) => String(row.review_text || '').length > 0).length;
const stagedNonemptyReviews = stagedLogs.filter((row) => String(row.review_text || '').length > 0).length;
const sourceNonemptyApiData = fixture.media.filter(
  (row) => row.apiData && typeof row.apiData === 'object' && Object.keys(row.apiData).length > 0,
).length;
const stagedNonemptyApiData = stagedMedia.filter(
  (row) => row.apiData && typeof row.apiData === 'object' && Object.keys(row.apiData).length > 0,
).length;
assert.equal(stagedNonemptyReviews, sourceNonemptyReviews - currentBogusLogs.filter(
  (row) => String(row.review_text || '').length > 0,
).length);
assert.equal(stagedNonemptyApiData, sourceNonemptyApiData);

await Promise.all([userAClient.auth.signOut(), userBClient.auth.signOut()]);
userAClient.realtime.disconnect();
userBClient.realtime.disconnect();

console.log(`PASS production READ-ONLY export retained ${fixture.media.length} media and ${fixture.logs.length} diary rows in memory.`);
console.log('PASS full application-visible media and diary content hashes match after the five approved corrections and two approved deletions.');
console.log(`PASS staging User A authenticated and hydrated ${aMediaCount.count} media / ${aLogCount.count} diary rows; User B hydrated 0 / 0.`);
console.log(`PASS preserved ${stagedNonemptyApiData} nonempty API-data rows and ${stagedNonemptyReviews} nonempty diary reviews.`);
console.log('PASS production owner UUIDs were omitted from export and every staged source row is owned by staging User A.');
