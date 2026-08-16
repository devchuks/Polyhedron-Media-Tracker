import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/202608160001_canonical_identity_rls.sql', import.meta.url);

test('database migration defines canonical ownership, all CRUD RLS policies, and atomic RPCs', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /unique \(user_id, media_key\)/i);
  assert.match(sql, /foreign key \(user_id, media_key\)[\s\S]*on delete cascade/i);
  for (const table of ['media_library', 'media_logs']) {
    for (const operation of ['select', 'insert', 'update', 'delete']) {
      assert.match(sql, new RegExp(`create policy ${table}_${operation}_own`, 'i'));
    }
  }
  assert.match(sql, /create or replace function public\.delete_user_media/i);
  assert.match(sql, /create or replace function public\.replace_user_library/i);
  assert.match(sql, /replace_user_library\(p_media jsonb, p_logs jsonb\)[\s\S]*returns void/i);
  assert.match(sql, /greatest\(now\(\), existing\.updated_at \+ interval '1 millisecond'\)/i);
  assert.match(sql, /tombstone\.deleted_at \+ interval '1 millisecond'/i);
  assert.match(sql, /backup contains an orphan log/i);
  assert.match(sql, /on conflict \(user_id, media_key\) do update set[\s\S]*updated_at = excluded\.updated_at/i);
  assert.match(sql, /create or replace function public\.upsert_user_media/i);
  assert.match(sql, /create or replace function public\.patch_user_media/i);
  assert.match(sql, /progress = case when p_updates \? 'progress'[\s\S]*else progress end/i);
  assert.match(sql, /rating = case when p_updates \? 'rating'[\s\S]*else rating end/i);
  assert.match(sql, /media patch contains an unsupported field/i);
  assert.match(sql, /where public\.media_library\.updated_at <= excluded\.updated_at/i);
  assert.match(sql, /create table if not exists public\.media_tombstones/i);
  assert.match(sql, /create table if not exists public\.log_tombstones/i);
  assert.match(sql, /replica identity full/i);
  assert.match(sql, /primary key \(user_id, log_id\)/i);
  assert.match(sql, /create or replace function public\.upsert_user_media_with_log/i);
  assert.match(sql, /create or replace function public\.prepare_telegram_batch/i);
  assert.match(sql, /create or replace function public\.consume_edge_quota/i);
  assert.match(sql, /create or replace function public\.apply_telegram_media_event/i);
  assert.doesNotMatch(sql, /hashtextextended\(p_user_id::text \|\| ':'/i);
  assert.ok((sql.match(/pg_advisory_xact_lock\(hashtextextended\((?:auth\.uid\(\)|owner_id|p_user_id)::text, 0\)\)/gi) || []).length >= 10);
  assert.match(sql, /insert into public\.log_tombstones[\s\S]*delete from public\.media_library/i);
  assert.match(sql, /media_key = p_media->>'media_key' and deleted_at >= event_revision/i);
  assert.match(sql, /log_id = p_log->>'log_id' and deleted_at >= log_revision/i);
  assert.match(sql, /raise exception 'Canonical identity migration stopped: duplicate/i);
});
