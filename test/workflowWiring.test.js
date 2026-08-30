import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('one modal exposes state-only save and atomic state-plus-activity commands', async () => {
  const source = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(source, /handleSubmit\('library'/);
  assert.match(source, /handleSubmit\('activity'/);
  assert.match(source, />\s*Save Changes\s*</);
  assert.match(source, /Log Activity/);
  assert.doesNotMatch(source, /Library State & Diary/);
  assert.match(source, /persistStateOrActivity\(/);
  assert.doesNotMatch(source, /addDiaryLog/);
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
  assert.match(source, /updateMediaStatus:[\s\S]*patchPayload = \{[\s\S]*dateStarted: targetItem\.dateStarted,[\s\S]*dateCompleted: targetItem\.dateCompleted/);
  assert.match(source, /toggleIssueRead:[\s\S]*readIssueIds: targetItem\.readIssueIds,[\s\S]*dateStarted: targetItem\.dateStarted,[\s\S]*dateCompleted: targetItem\.dateCompleted/);
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

test('TV modal routes state-only and explicit season actions through the TV workflow boundary', async () => {
  const source = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(source, /saveTvLibraryState\(/);
  assert.match(source, /completeTvSeries\(/);
  assert.match(source, /executeTvSeasonCompletion\(/);
  assert.match(source, /Complete & Log Season/);
  assert.match(source, /disabled=\{isSubmitting \|\| loadingModalEps \|\| maxEpisodesInSeason < 1\}/);
  assert.match(source, /persistStateOrActivity\(/);
  assert.doesNotMatch(source, /setInputSeason\(nextSeason\)/);

  const importSource = await readFile(new URL('../src/pages/ImportTerminal.jsx', import.meta.url), 'utf8');
  assert.match(importSource, /executeTvSeasonCompletion\(/);
});

test('detail view resolves images from the complete stored row', async () => {
  const sourceUI = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(sourceUI, /const image = preferredMediaImage\(item\)/);
  assert.doesNotMatch(sourceUI, /image: apiData\?\.image \|\| targetItem\?\.image/);

  const sourcePages = await readFile(new URL('../src/pages/Pages.jsx', import.meta.url), 'utf8');
  assert.match(sourcePages, /resolveMediaImage\(storeItem \|\| previewItem/);
  assert.match(sourcePages, /firstUsableImageUrl\(rawDetails\.image, preferredMediaImage\(storeItem \|\| previewItem \|\| normalizedDetail\)\)/);
  assert.doesNotMatch(sourcePages, /rawDetails\.image \|\| targetItem\.image \|\| previewItem\?\.image/);
});

test('detail routes remount by canonical route identity and season requests use a latest-request gate', async () => {
  const sourceApp = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const sourcePages = await readFile(new URL('../src/pages/Pages.jsx', import.meta.url), 'utf8');
  assert.match(sourceApp, /<DetailView key=\{`\$\{type\}:\$\{id\}`\} \/>/);
  assert.match(sourcePages, /previewItemForRoute\(location\.state\?\.previewData, type, id\)/);
  assert.match(sourcePages, /seasonRequestGateRef\.current\.isCurrent\(requestToken\)/);
});

test('cloud media writes and realtime merges normalize scalar image URLs', async () => {
  const sourceStore = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  assert.match(sourceStore, /image: normalizeImageUrl\(canonical\.image\)/);
  assert.match(sourceStore, /image: firstUsableImageUrl\([\s\S]*normalizedRecord\.image/);
});

test('detail-page adds open with an explicit planned status instead of an unsaveable blank state', async () => {
  const sourcePages = await readFile(new URL('../src/pages/Pages.jsx', import.meta.url), 'utf8');
  assert.match(sourcePages, /targetStatus: isPreview \? 'planned' : storeItem\?\.status/);
});

test('ImageWithFallback tracks load and failure by source without render-phase state updates', async () => {
  const sourceUI = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(sourceUI, /const imageSrc = normalizeImageUrl\(src\)/);
  assert.match(sourceUI, /loadedSrc === imageSrc/);
  assert.match(sourceUI, /failedSrc === imageSrc/);
  assert.doesNotMatch(sourceUI, /if\s*\(\s*src\s*!==[\s\S]*setCurrentSrc/);
});

test('detail banners do not remain hidden when a cached image loads before route effects settle', async () => {
  const sourcePages = await readFile(new URL('../src/pages/Pages.jsx', import.meta.url), 'utf8');
  assert.match(sourcePages, /src=\{bannerSrc\} className="absolute inset-0 w-full h-full object-cover opacity-75"/);
  assert.doesNotMatch(sourcePages, /loadedBannerSrc|setLoadedBannerSrc/);
});

test('login screen uses the shared environment policy without a Layout import cycle', async () => {
  const sourceGate = await readFile(new URL('../src/pages/Gate.jsx', import.meta.url), 'utf8');
  const sourceEnvironment = await readFile(new URL('../src/config/environment.js', import.meta.url), 'utf8');
  assert.match(sourceGate, /showEnvironmentBadge &&/);
  assert.match(sourceGate, /from '\.\.\/config\/environment'/);
  assert.doesNotMatch(sourceGate, /appEnvironment.*from '\.\.\/components\/Layout'/);
  assert.match(sourceEnvironment, /import\.meta\.env\.VITE_APP_ENVIRONMENT/);
  assert.match(sourceEnvironment, /import\.meta\.env\.DEV/);
  assert.doesNotMatch(sourceEnvironment, /=\s*import\.meta\.env\s*(?:\|\||;)/);
});

test('intentional abort handling is wired narrowly and ordinary errors still reach reporting', async () => {
  const sourceApi = await readFile(new URL('../src/services/apiRegistry.js', import.meta.url), 'utf8');
  assert.match(sourceApi, /if \(isIntentionalAbort\(err\)\) return null;/);
  assert.match(sourceApi, /console\.error\(`🔴 \[\$\{serviceName\}\] Error Detail:/);
  assert.doesNotMatch(sourceApi, /error\.context\?\.status === 401[\s\S]*setTimeout\(resolve, 2000\)/);

  const sourceDiscovery = await readFile(new URL('../src/pages/Discovery.jsx', import.meta.url), 'utf8');
  assert.match(sourceDiscovery, /if \(!isIntentionalAbort\(err\)\) console\.error/);
});

test('deterministic post-audit UI fixes remain wired to shared semantics', async () => {
  const sourceUI = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  const sourceLayout = await readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8');
  const sourceDiary = await readFile(new URL('../src/pages/Diary.jsx', import.meta.url), 'utf8');
  const sourceExplore = await readFile(new URL('../src/pages/Explore.jsx', import.meta.url), 'utf8');

  assert.match(sourceUI, /ratingForInteraction\(\{ starIndex: i,[\s\S]*keyboard: event\.detail === 0/);
  assert.match(sourceUI, /Tap or Hover to Reveal/);
  assert.match(sourceUI, /event\.pointerType === 'mouse'/);
  assert.match(sourceUI, /mediaStatusLabel\(item\.status, item\.type\)/);
  assert.match(sourceLayout, /mediaTypeFromPathname\(location\.pathname\)/);
  assert.doesNotMatch(sourceLayout, />Profile<\/a>/);
  assert.match(sourceDiary, /diaryActionsForMediaType\(log\.media_type\)/);
  assert.match(sourceExplore, /finally \{\s*setIsFetchingMore\(false\)/);
});

test('provider search failures have a persistent retry state distinct from empty results', async () => {
  const sourceApi = await readFile(new URL('../src/services/apiRegistry.js', import.meta.url), 'utf8');
  const sourceUI = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  const sourceLayout = await readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8');
  assert.match(sourceApi, /const failedSearchResult/);
  assert.match(sourceLayout, /error: response\.error \|\| null/);
  assert.match(sourceUI, /role="alert"/);
  assert.match(sourceUI, /Retry Search/);
});

test('direct details and Explore failures settle into retryable states without stale comic details', async () => {
  const sourcePages = await readFile(new URL('../src/pages/Pages.jsx', import.meta.url), 'utf8');
  const sourceExplore = await readFile(new URL('../src/pages/Explore.jsx', import.meta.url), 'utf8');
  const sourceApi = await readFile(new URL('../src/services/apiRegistry.js', import.meta.url), 'utf8');

  assert.match(sourcePages, /normalizeProviderDetail\(rawDetails, type\)/);
  assert.match(sourcePages, /detailEnrichment\.phase !== 'error'/);
  assert.match(sourcePages, /setDetailRetryKey\(key => key \+ 1\)/);
  assert.match(sourceExplore, /setModalDetails\(null\);\s*setIsModalLoading\(true\)/);
  assert.match(sourceExplore, /setEntityError\('The provider could not load these details\.'\)/);
  assert.match(sourceExplore, /setGridError\('The provider could not load these titles\.'\)/);
  assert.match(sourceExplore, /<ExploreErrorNotice[\s\S]*onRetry=/);
  assert.match(sourceApi, /reportApiError\(err, 'IGDB Discover'\); throw err/);
  assert.match(sourceApi, /reportApiError\(err, 'TMDB \(Person\)'\); throw err/);
});
