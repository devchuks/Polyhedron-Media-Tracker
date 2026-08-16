-- Preservation-first canonical identity, ownership, RLS, and atomic workflows.
-- This migration is intentionally generated but NOT executed by the local remediation.

create extension if not exists pgcrypto;

create table if not exists public.media_library (
  library_row_id uuid not null default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  provider text,
  provider_id text,
  media_type text,
  media_key text,
  title text not null default 'Unknown Title',
  type text not null,
  subtype text,
  progress text,
  status text not null default 'planned',
  rating numeric not null default 0,
  "addedAt" bigint,
  "dateStarted" bigint,
  "dateCompleted" bigint,
  "rewatchCount" integer not null default 0,
  "readIssueIds" jsonb not null default '[]'::jsonb,
  image text,
  "apiData" jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.media_library
  add column if not exists library_row_id uuid default gen_random_uuid(),
  add column if not exists provider text,
  add column if not exists provider_id text,
  add column if not exists media_type text,
  add column if not exists media_key text,
  add column if not exists updated_at timestamptz default now();

create table if not exists public.media_logs (
  log_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id text not null,
  provider text,
  provider_id text,
  media_type text not null,
  media_key text,
  action_type text not null default 'LOGGED',
  log_date timestamptz not null,
  review_text text not null default '',
  image text,
  season_label text,
  season_year text,
  updated_at timestamptz not null default now()
);

alter table public.media_logs
  add column if not exists provider text,
  add column if not exists provider_id text,
  add column if not exists media_key text,
  add column if not exists updated_at timestamptz default now();

-- Refuse to invent ownership. An operator must repair any legacy unowned row explicitly.
do $$
begin
  if exists (select 1 from public.media_library where user_id is null)
     or exists (select 1 from public.media_logs where user_id is null) then
    raise exception 'Canonical identity migration stopped: rows with null user_id require an explicit ownership backfill';
  end if;
  if exists (
    select 1 from public.media_library
    where status is null or status not in ('planned', 'in progress', 'completed', 'dropped')
       or rating is null or rating < 0 or rating > 10
       or (status = 'completed' and "dateCompleted" is null)
       or (status <> 'completed' and "dateCompleted" is not null)
  ) then
    raise exception 'Canonical identity migration stopped: status, rating, or completion-date invariants require explicit repair';
  end if;
end
$$;

update public.media_library
set media_type = coalesce(nullif(media_type, ''), type),
    provider = coalesce(nullif(provider, ''), case coalesce(nullif(media_type, ''), type)
      when 'movies' then 'tmdb'
      when 'tv' then 'tmdb'
      when 'games' then 'igdb'
      when 'anime' then 'anilist'
      when 'manga' then 'anilist'
      when 'vn' then 'vndb'
      when 'books' then 'openlibrary'
      when 'comics' then 'metron'
      else null
    end),
    provider_id = coalesce(nullif(provider_id, ''), case coalesce(nullif(media_type, ''), type)
      when 'games' then regexp_replace(id::text, '^igdb_', '', 'i')
      when 'books' then regexp_replace(id::text, '^/works/', '', 'i')
      else id::text
    end),
    library_row_id = coalesce(library_row_id, gen_random_uuid()),
    updated_at = coalesce(updated_at, now());

update public.media_library
set media_key = provider || ':' || media_type || ':' || provider_id
where media_key is null or media_key = '';

update public.media_logs
set provider = coalesce(nullif(provider, ''), case media_type
      when 'movies' then 'tmdb'
      when 'tv' then 'tmdb'
      when 'games' then 'igdb'
      when 'anime' then 'anilist'
      when 'manga' then 'anilist'
      when 'vn' then 'vndb'
      when 'books' then 'openlibrary'
      when 'comics' then 'metron'
      else null
    end),
    provider_id = coalesce(nullif(provider_id, ''), case media_type
      when 'games' then regexp_replace(media_id::text, '^igdb_', '', 'i')
      when 'books' then regexp_replace(media_id::text, '^/works/', '', 'i')
      else media_id::text
    end),
    updated_at = coalesce(updated_at, now());

update public.media_logs
set media_key = provider || ':' || media_type || ':' || provider_id
where media_key is null or media_key = '';

do $$
begin
  if exists (
    select 1 from public.media_library
    where provider is null or provider_id is null or media_type is null or media_key is null
  ) or exists (
    select 1 from public.media_logs
    where provider is null or provider_id is null or media_key is null
  ) then
    raise exception 'Canonical identity migration stopped: an unsupported legacy media type requires manual mapping';
  end if;

  if exists (
    select 1 from public.media_library group by user_id, media_key having count(*) > 1
  ) then
    raise exception 'Canonical identity migration stopped: duplicate (user_id, media_key) rows require preservation-aware reconciliation';
  end if;

  if exists (
    select 1 from public.media_logs group by user_id, log_id having count(*) > 1
  ) then
    raise exception 'Canonical identity migration stopped: duplicate (user_id, log_id) rows require preservation-aware reconciliation';
  end if;

  if exists (
    select 1
    from public.media_logs l
    left join public.media_library m on m.user_id = l.user_id and m.media_key = l.media_key
    where m.media_key is null
  ) then
    raise exception 'Canonical identity migration stopped: orphan diary rows require explicit reconciliation';
  end if;
end
$$;

-- Diary IDs are stable within an owner. A copied backup must be restorable by another owner.
do $$
declare constraint_row record;
begin
  for constraint_row in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.media_logs'::regclass
      and c.contype in ('p', 'u')
      and exists (
        select 1 from unnest(c.conkey) key(attnum)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key.attnum
        where a.attname = 'log_id'
      )
      and not exists (
        select 1 from unnest(c.conkey) key(attnum)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key.attnum
        where a.attname = 'user_id'
      )
  loop
    execute format('alter table public.media_logs drop constraint %I', constraint_row.conname);
  end loop;
end
$$;

do $$
declare index_row record;
begin
  for index_row in
    select index_class.relname as index_name
    from pg_index idx
    join pg_class index_class on index_class.oid = idx.indexrelid
    where idx.indrelid = 'public.media_logs'::regclass
      and idx.indisunique
      and not exists (select 1 from pg_constraint c where c.conindid = idx.indexrelid)
      and exists (
        select 1 from unnest(idx.indkey) key(attnum)
        join pg_attribute a on a.attrelid = idx.indrelid and a.attnum = key.attnum
        where a.attname = 'log_id'
      )
      and not exists (
        select 1 from unnest(idx.indkey) key(attnum)
        join pg_attribute a on a.attrelid = idx.indrelid and a.attnum = key.attnum
        where a.attname = 'user_id'
      )
  loop
    execute format('drop index public.%I', index_row.index_name);
  end loop;
end
$$;

alter table public.media_library
  alter column user_id set not null,
  alter column library_row_id set not null,
  alter column provider set not null,
  alter column provider_id set not null,
  alter column media_type set not null,
  alter column media_key set not null,
  alter column updated_at set not null;

alter table public.media_logs
  alter column user_id set not null,
  alter column provider set not null,
  alter column provider_id set not null,
  alter column media_key set not null,
  alter column updated_at set not null;

-- Remove legacy FKs/identity constraints which make raw IDs globally unique.
do $$
declare constraint_row record;
begin
  for constraint_row in
    select conname, conrelid::regclass as relation_name
    from pg_constraint
    where contype = 'f'
      and confrelid = 'public.media_library'::regclass
      and conrelid = 'public.media_logs'::regclass
  loop
    execute format('alter table %s drop constraint %I', constraint_row.relation_name, constraint_row.conname);
  end loop;

  for constraint_row in
    select c.conname, c.contype
    from pg_constraint c
    where c.conrelid = 'public.media_library'::regclass
      and c.contype in ('p', 'u')
      and exists (
        select 1 from unnest(c.conkey) key(attnum)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key.attnum
        where a.attname = 'id'
      )
      and not exists (
        select 1 from unnest(c.conkey) key(attnum)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key.attnum
        where a.attname = 'media_key'
      )
  loop
    execute format('alter table public.media_library drop constraint %I', constraint_row.conname);
  end loop;
end
$$;

do $$
declare index_row record;
begin
  for index_row in
    select index_class.relname as index_name
    from pg_index idx
    join pg_class index_class on index_class.oid = idx.indexrelid
    where idx.indrelid = 'public.media_library'::regclass
      and idx.indisunique
      and not exists (select 1 from pg_constraint c where c.conindid = idx.indexrelid)
      and exists (
        select 1 from unnest(idx.indkey) key(attnum)
        join pg_attribute a on a.attrelid = idx.indrelid and a.attnum = key.attnum
        where a.attname = 'id'
      )
      and not exists (
        select 1 from unnest(idx.indkey) key(attnum)
        join pg_attribute a on a.attrelid = idx.indrelid and a.attnum = key.attnum
        where a.attname = 'media_key'
      )
  loop
    execute format('drop index public.%I', index_row.index_name);
  end loop;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.media_library'::regclass and contype = 'p'
  ) then
    alter table public.media_library add constraint media_library_pkey primary key (library_row_id);
  end if;
end
$$;

alter table public.media_library
  drop constraint if exists media_library_user_media_key_key,
  add constraint media_library_user_media_key_key unique (user_id, media_key),
  drop constraint if exists media_library_status_check,
  add constraint media_library_status_check check (status in ('planned', 'in progress', 'completed', 'dropped')) not valid,
  drop constraint if exists media_library_rating_check,
  add constraint media_library_rating_check check (rating >= 0 and rating <= 10) not valid,
  drop constraint if exists media_library_completion_date_check,
  add constraint media_library_completion_date_check check (
    (status = 'completed' and "dateCompleted" is not null)
    or (status <> 'completed' and "dateCompleted" is null)
  ) not valid;

alter table public.media_library validate constraint media_library_status_check;
alter table public.media_library validate constraint media_library_rating_check;
alter table public.media_library validate constraint media_library_completion_date_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.media_library'::regclass
      and c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and exists (
        select 1 from unnest(c.conkey) key(attnum)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key.attnum
        where a.attname = 'user_id'
      )
  ) then
    alter table public.media_library add constraint media_library_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.media_logs'::regclass
      and c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and exists (
        select 1 from unnest(c.conkey) key(attnum)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key.attnum
        where a.attname = 'user_id'
      )
  ) then
    alter table public.media_logs add constraint media_logs_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.media_logs'::regclass and contype = 'p'
  ) then
    alter table public.media_logs add constraint media_logs_pkey primary key (user_id, log_id);
  end if;
end
$$;

alter table public.media_logs
  drop constraint if exists media_logs_user_media_key_fkey,
  add constraint media_logs_user_media_key_fkey foreign key (user_id, media_key)
    references public.media_library(user_id, media_key) on update cascade on delete cascade;

alter table public.media_library replica identity full;
alter table public.media_logs replica identity full;

create index if not exists media_library_user_updated_idx on public.media_library(user_id, updated_at desc);
create index if not exists media_logs_user_date_idx on public.media_logs(user_id, log_date desc);
create index if not exists media_logs_user_media_idx on public.media_logs(user_id, media_key);

alter table public.media_library enable row level security;
alter table public.media_library force row level security;
alter table public.media_logs enable row level security;
alter table public.media_logs force row level security;

do $$
declare policy_row record;
begin
  for policy_row in select policyname, tablename from pg_policies where schemaname = 'public' and tablename in ('media_library', 'media_logs')
  loop
    execute format('drop policy %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
end
$$;

create policy media_library_select_own on public.media_library for select to authenticated using (auth.uid() = user_id);
create policy media_library_insert_own on public.media_library for insert to authenticated with check (auth.uid() = user_id);
create policy media_library_update_own on public.media_library for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy media_library_delete_own on public.media_library for delete to authenticated using (auth.uid() = user_id);

create policy media_logs_select_own on public.media_logs for select to authenticated using (auth.uid() = user_id);
create policy media_logs_insert_own on public.media_logs for insert to authenticated with check (auth.uid() = user_id);
create policy media_logs_update_own on public.media_logs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy media_logs_delete_own on public.media_logs for delete to authenticated using (auth.uid() = user_id);

revoke all on public.media_library, public.media_logs from anon;
grant select, insert, update, delete on public.media_library, public.media_logs to authenticated;

create table if not exists public.media_tombstones (
  user_id uuid not null references auth.users(id) on delete cascade,
  media_key text not null,
  deleted_at timestamptz not null,
  primary key (user_id, media_key)
);
alter table public.media_tombstones enable row level security;
alter table public.media_tombstones force row level security;
revoke all on public.media_tombstones from anon;
grant select, insert, update, delete on public.media_tombstones to authenticated;
drop policy if exists media_tombstones_own on public.media_tombstones;
create policy media_tombstones_own on public.media_tombstones for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.log_tombstones (
  user_id uuid not null references auth.users(id) on delete cascade,
  log_id text not null,
  deleted_at timestamptz not null,
  primary key (user_id, log_id)
);
alter table public.log_tombstones enable row level security;
alter table public.log_tombstones force row level security;
revoke all on public.log_tombstones from anon;
grant select, insert, update, delete on public.log_tombstones to authenticated;
drop policy if exists log_tombstones_own on public.log_tombstones;
create policy log_tombstones_own on public.log_tombstones for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.delete_user_media(p_media_key text, p_deleted_at timestamptz default now())
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  insert into public.media_tombstones(user_id, media_key, deleted_at)
  values (auth.uid(), p_media_key, p_deleted_at)
  on conflict (user_id, media_key) do update set deleted_at = greatest(excluded.deleted_at, public.media_tombstones.deleted_at);
  delete from public.media_library where user_id = auth.uid() and media_key = p_media_key;
end;
$$;

create or replace function public.delete_user_log(p_log_id text, p_deleted_at timestamptz default now())
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  insert into public.log_tombstones(user_id, log_id, deleted_at)
  values (auth.uid(), p_log_id, p_deleted_at)
  on conflict (user_id, log_id) do update set deleted_at = greatest(excluded.deleted_at, public.log_tombstones.deleted_at);
  delete from public.media_logs where user_id = auth.uid() and log_id = p_log_id;
end;
$$;

create or replace function public.delete_user_media_logs(p_media_key text, p_deleted_at timestamptz default now())
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  insert into public.log_tombstones(user_id, log_id, deleted_at)
  select auth.uid(), log_id, p_deleted_at
  from public.media_logs
  where user_id = auth.uid() and media_key = p_media_key
  on conflict (user_id, log_id) do update set deleted_at = greatest(excluded.deleted_at, public.log_tombstones.deleted_at);
  delete from public.media_logs where user_id = auth.uid() and media_key = p_media_key;
end;
$$;

create or replace function public.reset_user_library()
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  insert into public.media_tombstones(user_id, media_key, deleted_at)
  select auth.uid(), media_key, now() from public.media_library where user_id = auth.uid()
  on conflict (user_id, media_key) do update set deleted_at = greatest(excluded.deleted_at, public.media_tombstones.deleted_at);
  insert into public.log_tombstones(user_id, log_id, deleted_at)
  select auth.uid(), log_id, now() from public.media_logs where user_id = auth.uid()
  on conflict (user_id, log_id) do update set deleted_at = greatest(excluded.deleted_at, public.log_tombstones.deleted_at);
  delete from public.media_logs where user_id = auth.uid();
  delete from public.media_library where user_id = auth.uid();
end;
$$;

create or replace function public.upsert_user_media(p_media jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  owner_id uuid := auth.uid();
  revision timestamptz := coalesce(nullif(p_media->>'updated_at', '')::timestamptz, now());
begin
  if owner_id is null then raise exception 'authentication required'; end if;
  if exists (
    select 1 from public.media_tombstones
    where user_id = owner_id and media_key = p_media->>'media_key' and deleted_at >= revision
  ) then return; end if;
  delete from public.media_tombstones
  where user_id = owner_id and media_key = p_media->>'media_key' and deleted_at < revision;
  insert into public.media_library (
    user_id, id, provider, provider_id, media_type, media_key, title, type, subtype, progress,
    status, rating, "addedAt", "dateStarted", "dateCompleted", "rewatchCount", "readIssueIds", image, "apiData", updated_at
  ) values (
    owner_id, p_media->>'id', p_media->>'provider', p_media->>'provider_id', p_media->>'media_type', p_media->>'media_key',
    coalesce(p_media->>'title', 'Unknown Title'), p_media->>'type', p_media->>'subtype', p_media->>'progress',
    coalesce(p_media->>'status', 'planned'), coalesce((p_media->>'rating')::numeric, 0),
    nullif(p_media->>'addedAt', '')::bigint, nullif(p_media->>'dateStarted', '')::bigint,
    nullif(p_media->>'dateCompleted', '')::bigint, coalesce((p_media->>'rewatchCount')::integer, 0),
    coalesce(p_media->'readIssueIds', '[]'::jsonb), p_media->>'image', coalesce(p_media->'apiData', '{}'::jsonb), revision
  )
  on conflict (user_id, media_key) do update set
    title = excluded.title, type = excluded.type, subtype = excluded.subtype, progress = excluded.progress,
    status = excluded.status, rating = excluded.rating, "addedAt" = excluded."addedAt",
    "dateStarted" = excluded."dateStarted", "dateCompleted" = excluded."dateCompleted",
    "rewatchCount" = excluded."rewatchCount", "readIssueIds" = excluded."readIssueIds",
    image = excluded.image, "apiData" = excluded."apiData", updated_at = excluded.updated_at
  where public.media_library.updated_at <= excluded.updated_at;
end;
$$;

create or replace function public.upsert_user_log(p_log jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  owner_id uuid := auth.uid();
  revision timestamptz := coalesce(nullif(p_log->>'updated_at', '')::timestamptz, now());
begin
  if owner_id is null then raise exception 'authentication required'; end if;
  if exists (
    select 1 from public.log_tombstones
    where user_id = owner_id and log_id = p_log->>'log_id' and deleted_at >= revision
  ) then return; end if;
  delete from public.log_tombstones
  where user_id = owner_id and log_id = p_log->>'log_id' and deleted_at < revision;
  insert into public.media_logs (
    log_id, user_id, media_id, provider, provider_id, media_type, media_key, action_type,
    log_date, review_text, image, season_label, season_year, updated_at
  ) values (
    p_log->>'log_id', owner_id, p_log->>'media_id', p_log->>'provider', p_log->>'provider_id',
    p_log->>'media_type', p_log->>'media_key', coalesce(p_log->>'action_type', 'LOGGED'),
    (p_log->>'log_date')::timestamptz, coalesce(p_log->>'review_text', ''), p_log->>'image',
    p_log->>'season_label', p_log->>'season_year', revision
  )
  on conflict (user_id, log_id) do update set
    media_id = excluded.media_id, provider = excluded.provider, provider_id = excluded.provider_id,
    media_type = excluded.media_type, media_key = excluded.media_key, action_type = excluded.action_type,
    log_date = excluded.log_date, review_text = excluded.review_text, image = excluded.image,
    season_label = excluded.season_label, season_year = excluded.season_year, updated_at = excluded.updated_at
  where public.media_logs.user_id = owner_id and public.media_logs.updated_at <= excluded.updated_at;
end;
$$;

create or replace function public.upsert_user_media_with_log(p_media jsonb, p_log jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  perform public.upsert_user_media(p_media);
  if p_log is not null then
    perform public.upsert_user_log(p_log);
  end if;
end;
$$;

create or replace function public.replace_user_library(p_media jsonb, p_logs jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  owner_id uuid := auth.uid();
  row_data jsonb;
begin
  if owner_id is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(p_media) <> 'array' or jsonb_typeof(p_logs) <> 'array' then raise exception 'invalid backup payload'; end if;
  if jsonb_array_length(p_media) > 160000 or jsonb_array_length(p_logs) > 500000 then raise exception 'backup payload exceeds row limits'; end if;

  insert into public.media_tombstones(user_id, media_key, deleted_at)
  select owner_id, media_key, now() from public.media_library where user_id = owner_id
  on conflict (user_id, media_key) do update set deleted_at = greatest(excluded.deleted_at, public.media_tombstones.deleted_at);
  insert into public.log_tombstones(user_id, log_id, deleted_at)
  select owner_id, log_id, now() from public.media_logs where user_id = owner_id
  on conflict (user_id, log_id) do update set deleted_at = greatest(excluded.deleted_at, public.log_tombstones.deleted_at);
  delete from public.media_logs where user_id = owner_id;
  delete from public.media_library where user_id = owner_id;

  for row_data in select value from jsonb_array_elements(p_media)
  loop
    delete from public.media_tombstones
    where user_id = owner_id and media_key = row_data->>'media_key';
    insert into public.media_library (
      user_id, id, provider, provider_id, media_type, media_key, title, type, subtype, progress,
      status, rating, "addedAt", "dateStarted", "dateCompleted", "rewatchCount", "readIssueIds", image, "apiData", updated_at
    ) values (
      owner_id, row_data->>'id', row_data->>'provider', row_data->>'provider_id', row_data->>'media_type', row_data->>'media_key',
      coalesce(row_data->>'title', 'Unknown Title'), row_data->>'type', row_data->>'subtype', row_data->>'progress',
      coalesce(row_data->>'status', 'planned'), coalesce((row_data->>'rating')::numeric, 0),
      nullif(row_data->>'addedAt', '')::bigint, nullif(row_data->>'dateStarted', '')::bigint,
      nullif(row_data->>'dateCompleted', '')::bigint, coalesce((row_data->>'rewatchCount')::integer, 0),
      coalesce(row_data->'readIssueIds', '[]'::jsonb), row_data->>'image', coalesce(row_data->'apiData', '{}'::jsonb), now()
    );
  end loop;

  for row_data in select value from jsonb_array_elements(p_logs)
  loop
    delete from public.log_tombstones
    where user_id = owner_id and log_id = row_data->>'log_id';
    insert into public.media_logs (
      log_id, user_id, media_id, provider, provider_id, media_type, media_key, action_type,
      log_date, review_text, image, season_label, season_year, updated_at
    ) values (
      row_data->>'log_id', owner_id, row_data->>'media_id', row_data->>'provider', row_data->>'provider_id',
      row_data->>'media_type', row_data->>'media_key', coalesce(row_data->>'action_type', 'LOGGED'),
      (row_data->>'log_date')::timestamptz, coalesce(row_data->>'review_text', ''), row_data->>'image',
      row_data->>'season_label', row_data->>'season_year', now()
    );
  end loop;
end;
$$;

revoke all on function public.delete_user_media(text, timestamptz) from public, anon;
revoke all on function public.delete_user_log(text, timestamptz) from public, anon;
revoke all on function public.delete_user_media_logs(text, timestamptz) from public, anon;
revoke all on function public.reset_user_library() from public, anon;
revoke all on function public.upsert_user_media(jsonb) from public, anon;
revoke all on function public.upsert_user_log(jsonb) from public, anon;
revoke all on function public.upsert_user_media_with_log(jsonb, jsonb) from public, anon;
revoke all on function public.replace_user_library(jsonb, jsonb) from public, anon;
grant execute on function public.delete_user_media(text, timestamptz) to authenticated;
grant execute on function public.delete_user_log(text, timestamptz) to authenticated;
grant execute on function public.delete_user_media_logs(text, timestamptz) to authenticated;
grant execute on function public.reset_user_library() to authenticated;
grant execute on function public.upsert_user_media(jsonb) to authenticated;
grant execute on function public.upsert_user_log(jsonb) to authenticated;
grant execute on function public.upsert_user_media_with_log(jsonb, jsonb) to authenticated;
grant execute on function public.replace_user_library(jsonb, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'media_library'
    ) then alter publication supabase_realtime add table public.media_library; end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'media_logs'
    ) then alter publication supabase_realtime add table public.media_logs; end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'media_tombstones'
    ) then alter publication supabase_realtime add table public.media_tombstones; end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'log_tombstones'
    ) then alter publication supabase_realtime add table public.log_tombstones; end if;
  end if;
end
$$;

create table if not exists public.edge_rate_limits (
  scope text not null,
  subject_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (scope, subject_hash, window_start),
  constraint edge_rate_limits_count_positive check (request_count > 0)
);
alter table public.edge_rate_limits enable row level security;
alter table public.edge_rate_limits force row level security;
revoke all on public.edge_rate_limits from public, anon, authenticated;

create or replace function public.consume_edge_quota(p_scope text, p_subject_hash text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_window timestamptz := date_trunc('minute', clock_timestamp());
  allowed boolean;
begin
  if p_scope not in ('tmdb', 'igdb', 'metron', 'vndb')
     or p_subject_hash !~ '^[0-9a-f]{64}$'
     or p_limit < 1 or p_limit > 10000 then
    raise exception 'invalid quota request';
  end if;
  insert into public.edge_rate_limits(scope, subject_hash, window_start, request_count)
  values (p_scope, p_subject_hash, current_window, 1)
  on conflict (scope, subject_hash, window_start) do update
    set request_count = public.edge_rate_limits.request_count + 1
  returning request_count <= p_limit into allowed;
  delete from public.edge_rate_limits where window_start < current_window - interval '1 day';
  return allowed;
end;
$$;
revoke all on function public.consume_edge_quota(text, text, integer) from public, anon, authenticated;
grant execute on function public.consume_edge_quota(text, text, integer) to service_role;

create table if not exists public.webhook_events (
  source text not null,
  event_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  processed_at timestamptz not null default now(),
  primary key (source, event_id)
);
alter table public.webhook_events enable row level security;
alter table public.webhook_events force row level security;
revoke all on public.webhook_events from public, anon, authenticated;

create table if not exists public.webhook_batches (
  source text not null,
  event_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan jsonb not null,
  created_at timestamptz not null default now(),
  primary key (source, event_id),
  constraint webhook_batches_plan_array check (jsonb_typeof(plan) = 'array')
);
alter table public.webhook_batches enable row level security;
alter table public.webhook_batches force row level security;
revoke all on public.webhook_batches from public, anon, authenticated;

create or replace function public.prepare_telegram_batch(p_event_id text, p_user_id uuid, p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare stable_plan jsonb;
begin
  if p_event_id is null or length(p_event_id) > 200 then raise exception 'invalid event id'; end if;
  if jsonb_typeof(p_plan) <> 'array' or jsonb_array_length(p_plan) > 10 then raise exception 'invalid Telegram plan'; end if;
  insert into public.webhook_batches(source, event_id, user_id, plan)
  values ('telegram', p_event_id, p_user_id, p_plan)
  on conflict (source, event_id) do nothing;
  select plan into stable_plan from public.webhook_batches
  where source = 'telegram' and event_id = p_event_id and user_id = p_user_id;
  if stable_plan is null then raise exception 'Telegram batch belongs to a different owner'; end if;
  return stable_plan;
end;
$$;

create or replace function public.apply_telegram_media_event(
  p_event_id text,
  p_user_id uuid,
  p_media jsonb,
  p_log jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare inserted_event integer;
begin
  if p_event_id is null or length(p_event_id) > 200 then raise exception 'invalid event id'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || coalesce(p_media->>'media_key', ''), 0));
  insert into public.webhook_events(source, event_id, user_id)
  values ('telegram', p_event_id, p_user_id)
  on conflict do nothing;
  get diagnostics inserted_event = row_count;
  if inserted_event = 0 then return false; end if;

  delete from public.media_tombstones
  where user_id = p_user_id and media_key = p_media->>'media_key';

  insert into public.media_library (
    user_id, id, provider, provider_id, media_type, media_key, title, type, subtype, progress,
    status, rating, "addedAt", "dateStarted", "dateCompleted", "rewatchCount", "readIssueIds", image, "apiData", updated_at
  ) values (
    p_user_id, p_media->>'id', p_media->>'provider', p_media->>'provider_id', p_media->>'media_type', p_media->>'media_key',
    p_media->>'title', p_media->>'type', p_media->>'subtype', p_media->>'progress', p_media->>'status',
    coalesce((p_media->>'rating')::numeric, 0), nullif(p_media->>'addedAt', '')::bigint,
    nullif(p_media->>'dateStarted', '')::bigint, nullif(p_media->>'dateCompleted', '')::bigint,
    coalesce((p_media->>'rewatchCount')::integer, 0), coalesce(p_media->'readIssueIds', '[]'::jsonb),
    p_media->>'image', coalesce(p_media->'apiData', '{}'::jsonb),
    coalesce(nullif(p_media->>'updated_at', '')::timestamptz, now())
  )
  on conflict (user_id, media_key) do update set
    title = case when excluded.updated_at >= public.media_library.updated_at then excluded.title else public.media_library.title end,
    subtype = case when excluded.updated_at >= public.media_library.updated_at then excluded.subtype else public.media_library.subtype end,
    progress = case when excluded.updated_at >= public.media_library.updated_at then excluded.progress else public.media_library.progress end,
    status = case when excluded.updated_at >= public.media_library.updated_at then excluded.status else public.media_library.status end,
    rating = case when excluded.updated_at >= public.media_library.updated_at then excluded.rating else public.media_library.rating end,
    "dateStarted" = case when excluded.updated_at >= public.media_library.updated_at then excluded."dateStarted" else public.media_library."dateStarted" end,
    "dateCompleted" = case when excluded.updated_at >= public.media_library.updated_at then excluded."dateCompleted" else public.media_library."dateCompleted" end,
    "rewatchCount" = public.media_library."rewatchCount" + greatest(0, coalesce((p_media #>> '{_mutation,rewatch_increment}')::integer, 0)),
    "readIssueIds" = case
      when nullif(p_media #>> '{_mutation,add_read_issue}', '') is null then public.media_library."readIssueIds"
      else (
        select coalesce(jsonb_agg(issue_id order by issue_id), '[]'::jsonb)
        from (
          select distinct value as issue_id
          from jsonb_array_elements_text(coalesce(public.media_library."readIssueIds", '[]'::jsonb))
          union
          select p_media #>> '{_mutation,add_read_issue}'
        ) issue_union
      )
    end,
    image = case when excluded.updated_at >= public.media_library.updated_at then excluded.image else public.media_library.image end,
    "apiData" = case when excluded.updated_at >= public.media_library.updated_at then excluded."apiData" else public.media_library."apiData" end,
    updated_at = greatest(excluded.updated_at, public.media_library.updated_at);

  if p_log is not null then
    delete from public.log_tombstones
    where user_id = p_user_id and log_id = p_log->>'log_id';
    insert into public.media_logs (
      log_id, user_id, media_id, provider, provider_id, media_type, media_key, action_type,
      log_date, review_text, image, season_label, season_year
    ) values (
      p_log->>'log_id', p_user_id, p_log->>'media_id', p_log->>'provider', p_log->>'provider_id',
      p_log->>'media_type', p_log->>'media_key', p_log->>'action_type', (p_log->>'log_date')::timestamptz,
      coalesce(p_log->>'review_text', ''), p_log->>'image', p_log->>'season_label', p_log->>'season_year'
    ) on conflict (user_id, log_id) do nothing;
  end if;
  return true;
end;
$$;

revoke all on function public.apply_telegram_media_event(text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.prepare_telegram_batch(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_telegram_media_event(text, uuid, jsonb, jsonb) to service_role;
grant execute on function public.prepare_telegram_batch(text, uuid, jsonb) to service_role;

comment on table public.media_library is 'Canonical user-owned media. Raw provider IDs are unique only with provider and media_type.';
comment on column public.media_library.id is 'Legacy route/provider identifier retained for backwards compatibility; never use alone for ownership or destructive identity.';
comment on column public.media_library.media_key is 'Deterministic provider:media_type:provider_id identity, unique per user.';
