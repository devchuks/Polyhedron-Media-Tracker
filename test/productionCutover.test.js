import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('final production preflight artifacts are SELECT-only and privacy-minimized', async () => {
  for (const file of ['supabase/hosted-verification/final_cutover_preflight.sql', 'supabase/hosted-verification/production_cutover_backup.sql']) {
    const sql = await read(file);
    assert.match(sql, /^-- PRODUCTION READ-ONLY/);
    assert.doesNotMatch(sql, /\b(insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/iu);
  }
});

test('episode-zero cutover cleanup is exact, drift guarded, and cannot touch genuine progress', async () => {
  const sql = await read('supabase/production-cutover/cleanup_planned_tv_episode_zero.sql');
  assert.match(sql, /id = '126118'/u);
  assert.match(sql, /title = 'Chapelwaite'/u);
  assert.match(sql, /type = 'tv'/u);
  assert.match(sql, /status = 'planned'/u);
  assert.match(sql, /progress = 'S01 E00'/u);
  assert.match(sql, /affected_rows <> 1/u);
  assert.doesNotMatch(sql, /S01 E01/u);
  assert.doesNotMatch(sql, /dateStarted|dateCompleted|apiData|media_logs/u);
});
