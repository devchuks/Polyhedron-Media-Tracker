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
  assert.match(sql, /create or replace function public\.upsert_user_media/i);
  assert.match(sql, /where public\.media_library\.updated_at <= excluded\.updated_at/i);
  assert.match(sql, /create table if not exists public\.media_tombstones/i);
  assert.match(sql, /create or replace function public\.apply_telegram_media_event/i);
  assert.match(sql, /raise exception 'Canonical identity migration stopped: duplicate/i);
});
