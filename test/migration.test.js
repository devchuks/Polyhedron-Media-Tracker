import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/202608160001_canonical_identity_rls.sql', import.meta.url);
const reconciliationPath = new URL('../supabase/migrations/202608160000_reconcile_legacy_blockers.sql', import.meta.url);
const migrationsDirectory = new URL('../supabase/migrations/', import.meta.url);
const configPath = new URL('../supabase/config.toml', import.meta.url);

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
  assert.match(sql, /confdeltype <> 'c'[\s\S]*drop constraint/i);
  assert.match(sql, /foreign key \(user_id\) references auth\.users\(id\) on delete cascade/i);
  assert.match(sql, /alter column media_type set not null[\s\S]*alter column action_type set not null[\s\S]*alter column log_date set not null/i);
  assert.match(sql, /revoke all on public\.media_library, public\.media_logs from anon, authenticated/i);
  assert.match(sql, /unrecognized library or log RLS policies require explicit review/i);
  assert.doesNotMatch(sql, /for policy_row in select policyname, tablename from pg_policies/i);
});

test('local disposable database matches the hosted PostgreSQL major version', async () => {
  const config = await readFile(configPath, 'utf8');
  assert.match(config, /\[db\][\s\S]*major_version\s*=\s*17/i);
});

test('legacy reconciliation targets only the seven approved blockers and precedes canonical identity', async () => {
  const sql = await readFile(reconciliationPath, 'utf8');
  const migrationNames = (await readdir(migrationsDirectory)).sort();
  assert.ok(
    migrationNames.indexOf('202608160000_reconcile_legacy_blockers.sql')
      < migrationNames.indexOf('202608160001_canonical_identity_rls.sql'),
  );

  for (const [title, date, mediaId] of [
    ['Backrooms', '2026-07-20', '1083381'],
    ['Casino Royale', '2026-06-14', '36557'],
    ['Is God Is', '2026-06-23', '1380316'],
    ['Quantum of Solace', '2026-06-14', '10764'],
    ['The Odyssey', '2026-07-20', '1368337'],
  ]) {
    assert.match(sql, new RegExp(`'${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'i'));
    assert.match(sql, new RegExp(`date '${date}'`, 'i'));
    assert.match(sql, new RegExp(`'${mediaId}'::text`, 'i'));
  }

  for (const [logId, mediaType, mediaId, action] of [
    ['08c943c8-cbf4-4462-b29e-780421751dbf', 'manga', '77917', 'READ'],
    ['922ad384-ce27-4daa-a5fc-591a30eb012e', 'vn', 'v1298', 'PLAYED'],
  ]) {
    assert.match(sql, new RegExp(logId, 'i'));
    assert.match(sql, new RegExp(`'${mediaType}'::text[\\s\\S]*'${mediaId}'::text[\\s\\S]*'${action}'::text`, 'i'));
  }

  assert.match(sql, /do \$reconcile_legacy_blockers\$[\s\S]*end\s*\$reconcile_legacy_blockers\$;/i);
  assert.match(sql, /completion_blockers <> 5/i);
  assert.match(sql, /orphan_blockers <> 2/i);
  assert.match(sql, /corrected_media <> 5/i);
  assert.match(sql, /deleted_logs <> 2/i);
  assert.match(sql, /media row accounting changed unexpectedly/i);
  assert.match(sql, /log row accounting changed unexpectedly/i);
  assert.match(sql, /expected one WATCHED log/i);
  assert.match(sql, /now has a deterministic parent/i);
  assert.match(sql, /delete from public\.media_logs l[\s\S]*l\.log_id = target\.log_id[\s\S]*l\.media_type = target\.media_type[\s\S]*l\.media_id = target\.media_id[\s\S]*l\.action_type = target\.action_type[\s\S]*l\.log_date = target\.expected_log_date/i);
  assert.doesNotMatch(sql, /delete from public\.media_library/i);
  assert.equal((sql.match(/delete from public\.media_logs/gi) || []).length, 1);
});
