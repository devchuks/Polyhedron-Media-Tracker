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
