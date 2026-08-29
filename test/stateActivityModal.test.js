import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { lifecycleDateFields, persistStateOrActivity } from '../src/domain/stateActivityModal.js';

test('Save Changes writes Library state without a Diary write', async () => {
  const calls = { library: 0, activity: 0 };
  const media = { id: 1, status: 'completed' };
  const result = await persistStateOrActivity({
    intent: 'library', media, type: 'movies', log: null,
    saveLibrary: async (saved, type) => { calls.library += 1; assert.equal(saved, media); assert.equal(type, 'movies'); },
    saveWithLog: async () => { calls.activity += 1; },
  });
  assert.deepEqual(calls, { library: 1, activity: 0 });
  assert.equal(result.log, null);
});

test('Log Activity atomically writes corresponding Library state and one stable activity', async () => {
  const calls = { library: 0, activity: 0 };
  const media = { id: 1, status: 'completed', rating: 9 };
  const log = { log_id: 'stable-log-1', media_id: 1, action_type: 'WATCHED' };
  const result = await persistStateOrActivity({
    intent: 'activity', media, type: 'movies', log,
    saveLibrary: async () => { calls.library += 1; },
    saveWithLog: async (saved, type, savedLog) => {
      calls.activity += 1;
      assert.equal(saved, media);
      assert.equal(type, 'movies');
      assert.equal(savedLog, log);
      return { media: saved, log: savedLog };
    },
  });
  assert.deepEqual(calls, { library: 0, activity: 1 });
  assert.equal(result.log.log_id, 'stable-log-1');
});

test('movie lifecycle exposes only Watched On mapped to canonical dateStarted', () => {
  assert.deepEqual(lifecycleDateFields('movies', 'completed'), [{ key: 'dateStarted', label: 'Watched On' }]);
  assert.doesNotMatch(JSON.stringify(lifecycleDateFields('movies', 'completed')), /dateCompleted|Started On|Completed On/);
});

test('long-form completed media exposes Started On and Completed On', () => {
  for (const type of ['tv', 'anime', 'manga', 'books', 'comics', 'games', 'vn']) {
    assert.deepEqual(lifecycleDateFields(type, 'completed'), [
      { key: 'dateStarted', label: 'Started On' },
      { key: 'dateCompleted', label: 'Completed On' },
    ]);
  }
});

test('detail page has one media-aware status control and no sibling Log Activity button', async () => {
  const source = await readFile(new URL('../src/pages/Pages.jsx', import.meta.url), 'utf8');
  assert.match(source, /mediaStatusLabel\(storeItem\?\.status, type, 'detail'\)/);
  assert.doesNotMatch(source, /Edit Library State/);
  assert.doesNotMatch(source, /<CalendarDays[^>]*\/>Log Activity/);
});

test('detail page preserves the established stacked mobile poster layout', async () => {
  const source = await readFile(new URL('../src/pages/Pages.jsx', import.meta.url), 'utf8');
  assert.match(source, /p-3 lg:p-5 flex flex-col gap-3 lg:gap-5/);
  assert.match(source, /w-48 sm:w-56 lg:w-full mx-auto lg:mx-0 flex flex-col gap-2/);
  assert.doesNotMatch(source, /p-3 lg:p-5 flex flex-row items-start gap-3 lg:flex-col/);
});

test('movie date input is wired to dateStarted while the unified modal offers both actions', async () => {
  const source = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(source, /selectedActivityTimestamp = \(\) => type === 'movies'[\s\S]*dateStarted/);
  assert.match(source, /handleSubmit\('library'/);
  assert.match(source, /handleSubmit\('activity'/);
  assert.match(source, /saveWithLog: saveMediaWithLog/);
});
