-- STAGING ONLY: reproduce the verified pre-remediation production contract.
-- This file must never be executed against the production link.

begin;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name in ('media_library', 'media_logs')
  ) then
    raise exception 'Legacy staging setup stopped: application tables already exist';
  end if;
end
$$;

create table public.media_library (
  id text not null,
  user_id uuid not null references auth.users(id),
  title text not null,
  type text not null,
  subtype text,
  progress text,
  status text,
  rating numeric default 0,
  "addedAt" bigint,
  "dateStarted" bigint,
  "dateCompleted" bigint,
  "rewatchCount" integer default 0,
  "readIssueIds" jsonb default '[]'::jsonb,
  image text,
  "apiData" jsonb default '{}'::jsonb,
  constraint media_library_pkey primary key (id, user_id)
);

create index idx_media_library_user_id on public.media_library(user_id);

create table public.media_logs (
  log_id text not null,
  user_id uuid not null references auth.users(id),
  media_id text not null,
  media_type text,
  action_type text,
  log_date timestamptz,
  review_text text,
  image text,
  season_label text,
  season_year text,
  constraint media_logs_pkey primary key (log_id)
);

create index idx_media_logs_user_id on public.media_logs(user_id);

alter table public.media_library enable row level security;
alter table public.media_logs enable row level security;
alter table public.media_library no force row level security;
alter table public.media_logs no force row level security;
alter table public.media_library replica identity default;
alter table public.media_logs replica identity default;

create policy "Users can manage their own library"
on public.media_library
for all
to public
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can manage their own logs"
on public.media_logs
for all
to public
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant all privileges on table public.media_library to anon, authenticated, service_role;
grant all privileges on table public.media_logs to anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'media_library'
    ) then
      alter publication supabase_realtime add table public.media_library;
    end if;
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'media_logs'
    ) then
      alter publication supabase_realtime add table public.media_logs;
    end if;
  else
    raise exception 'Legacy staging setup stopped: supabase_realtime publication is absent';
  end if;
end
$$;

commit;
