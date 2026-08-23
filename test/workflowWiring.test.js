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

test('realtime initial subscription avoids redundant hydration fetches', async () => {
  const source = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /status === 'SUBSCRIBED'\) void get\(\)\.fetchCloudData/);
});

test('cloud hydration retains complete rows, chunks large responses, and validates revisions', async () => {
  const source = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  assert.match(source, /fetchCloudTable\('media_library'[\s\S]*pageSize: 250/);
  assert.match(source, /select\(selectColumns/);
  assert.match(source, /validateRows: async rows/);
  assert.match(source, /columns = '\*'/);
});

test('auth transitions use cached owner data without blocking and avoid callback re-entry', async () => {
  const source = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  assert.match(source, /canUseCachedSnapshot/);
  assert.match(source, /isLoading: !canUseCachedSnapshot/);
  assert.match(source, /get\(\)\.fetchCloudData\(data\.user, generation\)\.then\(/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*setAuthMode\('admin', session\.user\)/);
  assert.match(source, /listenerGeneration !== authGeneration\) return/);
});

test('failed cloud snapshot is bounded and does not silently destroy owner state', async () => {
  const source = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  assert.match(source, /retryAfterJwtRefresh\([\s\S]*refreshSession/);
  assert.match(source, /finally \{[\s\S]*isCloudSyncing: false, isLoading: false/);
  assert.doesNotMatch(source, /set\(\{ authMode: null, isCloudSyncing: false/);
});

test('TV modal uses the tested progress serializer instead of persisting episode zero', async () => {
  const source = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(source, /finalProgress = serializeTvProgress\(status, inputSeason, inputEpisode\)/);
  assert.match(source, /\^S\\d\+\\s\*E0\+\$/);
});

test('detail view resolves images from the complete stored row', async () => {
  const sourceUI = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(sourceUI, /const image = preferredMediaImage\(item\)/);
  assert.doesNotMatch(sourceUI, /image: apiData\?\.image \|\| targetItem\?\.image/);

  const sourcePages = await readFile(new URL('../src/pages/Pages.jsx', import.meta.url), 'utf8');
  assert.match(sourcePages, /resolveMediaImage\(storeItem \|\| previewItem/);
});

test('ImageWithFallback tracks load and failure by source without render-phase state updates', async () => {
  const sourceUI = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(sourceUI, /loadedSrc === src/);
  assert.match(sourceUI, /failedSrc === src/);
  assert.doesNotMatch(sourceUI, /if\s*\(\s*src\s*!==[\s\S]*setCurrentSrc/);
});

test('login screen uses the shared environment policy without a Layout import cycle', async () => {
  const sourceGate = await readFile(new URL('../src/pages/Gate.jsx', import.meta.url), 'utf8');
  assert.match(sourceGate, /showEnvironmentBadge &&/);
  assert.match(sourceGate, /from '\.\.\/config\/environment'/);
  assert.doesNotMatch(sourceGate, /appEnvironment.*from '\.\.\/components\/Layout'/);
});

test('intentional abort handling is wired narrowly and ordinary errors still reach reporting', async () => {
  const sourceApi = await readFile(new URL('../src/services/apiRegistry.js', import.meta.url), 'utf8');
  assert.match(sourceApi, /if \(isIntentionalAbort\(err\)\) return;/);
  assert.match(sourceApi, /console\.error\(`🔴 \[\$\{serviceName\}\] Error Detail:/);
  assert.doesNotMatch(sourceApi, /error\.context\?\.status === 401[\s\S]*setTimeout\(resolve, 2000\)/);

  const sourceDiscovery = await readFile(new URL('../src/pages/Discovery.jsx', import.meta.url), 'utf8');
  assert.match(sourceDiscovery, /if \(!isIntentionalAbort\(err\)\) console\.error/);
});
