import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('paired diary UI saves use the atomic media-and-log workflow', async () => {
  const source = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(source, /saveMediaWithLog\(libraryPayload, type, diaryLog\)/);
  assert.doesNotMatch(source, /addMediaItem\(libraryPayload, type\);\s*\n\s*addDiaryLog\(/);
});

test('admin backup replacement reloads an authoritative cloud snapshot', async () => {
  const source = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  assert.match(source, /fetchCloudData\(authData\.user, authGeneration, true\)/);
  assert.doesNotMatch(source, /p_restore_floor/);
});

test('narrow frontend media edits use the serialized allowlisted patch RPC', async () => {
  const source = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\('media_library'\)\.update/);
  assert.match(source, /patchItemInCloud:[\s\S]*rpc\('patch_user_media'/);
  assert.match(source, /p_updates: updates/);
});

test('Telegram provider failures remain retryable while genuine empty results can use no-match feedback', async () => {
  const source = await readFile(new URL('../supabase/functions/telegram-logger/index.ts', import.meta.url), 'utf8');
  for (const provider of ['TMDB', 'IGDB', 'Metron', 'AniList', 'VNDB', 'OpenLibrary']) {
    assert.match(source, new RegExp(`${provider} lookup failed`));
  }
  assert.match(source, /assertGraphqlSuccess\(await res\.json\(\), 'AniList'\)/);
  assert.match(source, /failedItems \+= 1/);
  assert.match(source, /One or more items remain retryable'[\s\S]*status: 500/);
});

test('duplicate cloud hydration requests are deduplicated by promise', async () => {
  const source = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  assert.match(source, /_hydrationPromise/);
  assert.match(source, /if\s*\(\s*get\(\)\._hydrationPromise\s*&&\s*get\(\)\._hydrationGen\s*===\s*expectedGeneration/);
  assert.match(source, /set\(\{ _hydrationPromise: promise/);
});

test('realtime initial subscription avoids redundant hydration fetches', async () => {
  const source = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /status === 'SUBSCRIBED'\) void get\(\)\.fetchCloudData/);
});

test('cloud hydration uses a lightweight initial projection for library data', async () => {
  const source = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  assert.match(source, /libraryColumns = 'library_row_id, id, user_id, provider/);
  assert.doesNotMatch(source, /libraryColumns = '\*'/);
});

test('auth state transitions immediately without waiting for a slow cloud snapshot', async () => {
  const source = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  assert.match(source, /get\(\)\.fetchCloudData\(data\.user, generation\)\.then\(/);
  assert.doesNotMatch(source, /const synced = await get\(\)\.fetchCloudData/);
});

test('failed cloud snapshot stops loading without silently destroying auth mode', async () => {
  const source = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  assert.match(source, /else set\(\{ isCloudSyncing: false, isLoading: false \}\)/);
  assert.doesNotMatch(source, /set\(\{ authMode: null, isCloudSyncing: false/);
});

test('planned TV does not persist or render an unset episode-zero sentinel', async () => {
  const source = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  // Rendering exclusion
  assert.match(source, /prog === 'S01 E00' \|\| prog === 'S01 E0'/);
  // Persisting exclusion
  assert.match(source, /if \(status === 'planned' && inputSeason === 1 && inputEpisode === 0\)/);
  assert.match(source, /finalProgress = ''/);
});

test('image representation consistently prioritizes row-level image cache over apiData', async () => {
  const sourceUI = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(sourceUI, /const image = item\?\.image \|\| item\?\.apiData\?\.image/);
  assert.doesNotMatch(sourceUI, /image: apiData\?\.image \|\| targetItem\?\.image/);

  const sourcePages = await readFile(new URL('../src/pages/Pages.jsx', import.meta.url), 'utf8');
  assert.match(sourcePages, /resolveMediaImage\(storeItem \|\| previewItem/);
});

test('ImageWithFallback synchronously resets state on src change to prevent stale flashes', async () => {
  const sourceUI = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(sourceUI, /if\s*\(\s*src\s*!==\s*currentSrc\s*\)/);
  assert.doesNotMatch(sourceUI, /useEffect\(\(\) => \{\s*setLoaded\(false\);\s*setError\(false\);\s*\}, \[src\]\);/);
});

test('staging environment indicator renders as a clear pill on the login screen', async () => {
  const sourceGate = await readFile(new URL('../src/pages/Gate.jsx', import.meta.url), 'utf8');
  assert.match(sourceGate, /showEnvironmentBadge &&/);
  assert.match(sourceGate, /appEnvironment/);
});

test('edge function invocations provide a clock drift allowance for DEV environments', async () => {
  const source = await readFile(new URL('../src/services/apiRegistry.js', import.meta.url), 'utf8');
  assert.match(source, /import\.meta\.env\.DEV && error instanceof FunctionsHttpError && error\.context\?\.status === 401/);
  assert.match(source, /setTimeout\(resolve, 2000\)/);
});

test('intentional aborts are silently caught and do not clutter the console', async () => {
  const sourceApi = await readFile(new URL('../src/services/apiRegistry.js', import.meta.url), 'utf8');
  assert.match(sourceApi, /if \(err\?\.name === 'AbortError'\) return;/);

  const sourceDiscovery = await readFile(new URL('../src/pages/Discovery.jsx', import.meta.url), 'utf8');
  assert.match(sourceDiscovery, /if \(err\?\.name !== 'AbortError'\) console\.error/);
});
