-- STAGING ONLY: concise catalog and data proof after the canonical migration.
with expected_library as (
  select
    m.*,
    case m.type
      when 'movies' then 'tmdb'
      when 'tv' then 'tmdb'
      when 'games' then 'igdb'
      when 'anime' then 'anilist'
      when 'manga' then 'anilist'
      when 'vn' then 'vndb'
      when 'books' then 'openlibrary'
      when 'comics' then 'metron'
    end as expected_provider,
    case m.type
      when 'games' then regexp_replace(m.id, '^igdb_', '', 'i')
      when 'books' then regexp_replace(m.id, '^/works/', '', 'i')
      else m.id
    end as expected_provider_id
  from public.media_library m
), expected_logs as (
  select
    l.*,
    case l.media_type
      when 'movies' then 'tmdb'
      when 'tv' then 'tmdb'
      when 'games' then 'igdb'
      when 'anime' then 'anilist'
      when 'manga' then 'anilist'
      when 'vn' then 'vndb'
      when 'books' then 'openlibrary'
      when 'comics' then 'metron'
    end as expected_provider,
    case l.media_type
      when 'games' then regexp_replace(l.media_id, '^igdb_', '', 'i')
      when 'books' then regexp_replace(l.media_id, '^/works/', '', 'i')
      else l.media_id
    end as expected_provider_id
  from public.media_logs l
), app_relations as (
  select c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relreplident
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'media_library', 'media_logs', 'media_tombstones', 'log_tombstones',
      'edge_rate_limits', 'webhook_events', 'webhook_batches'
    )
), expected_functions(name) as (
  values
    ('delete_user_media'), ('delete_user_log'), ('delete_user_media_logs'),
    ('reset_user_library'), ('upsert_user_media'), ('patch_user_media'),
    ('upsert_user_log'), ('upsert_user_media_with_log'),
    ('replace_user_library'), ('consume_edge_quota'),
    ('prepare_telegram_batch'), ('apply_telegram_media_event')
)
select jsonb_build_object(
  'row_accounting', jsonb_build_object(
    'media_rows', (select count(*) from public.media_library),
    'log_rows', (select count(*) from public.media_logs),
    'distinct_library_row_ids',
      (select count(distinct library_row_id) from public.media_library)
  ),
  'canonical_identity', jsonb_build_object(
    'library_null_or_malformed', (select count(*) from expected_library
      where library_row_id is null or provider is null or provider_id is null
         or media_type is null or media_key is null
         or media_key <> provider || ':' || media_type || ':' || provider_id),
    'library_mapping_mismatches', (select count(*) from expected_library
      where provider <> expected_provider or provider_id <> expected_provider_id
         or media_type <> type),
    'log_null_or_malformed', (select count(*) from expected_logs
      where provider is null or provider_id is null or media_key is null
         or media_key <> provider || ':' || media_type || ':' || provider_id),
    'log_mapping_mismatches', (select count(*) from expected_logs
      where provider <> expected_provider or provider_id <> expected_provider_id),
    'owner_collision_groups', (select count(*) from (
      select user_id, media_key from public.media_library
      group by user_id, media_key having count(*) > 1
    ) collisions),
    'owner_log_id_collision_groups', (select count(*) from (
      select user_id, log_id from public.media_logs
      group by user_id, log_id having count(*) > 1
    ) collisions),
    'orphan_logs', (select count(*) from public.media_logs l
      left join public.media_library m
        on m.user_id = l.user_id and m.media_key = l.media_key
      where m.library_row_id is null)
  ),
  'constraints', jsonb_build_object(
    'library_surrogate_pk', exists (
      select 1 from pg_constraint
      where conrelid = 'public.media_library'::regclass and contype = 'p'
        and pg_get_constraintdef(oid) = 'PRIMARY KEY (library_row_id)'
    ),
    'owner_media_unique', exists (
      select 1 from pg_constraint
      where conrelid = 'public.media_library'::regclass and contype = 'u'
        and pg_get_constraintdef(oid) = 'UNIQUE (user_id, media_key)'
    ),
    'owner_log_pk', exists (
      select 1 from pg_constraint
      where conrelid = 'public.media_logs'::regclass and contype = 'p'
        and pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, log_id)'
    ),
    'composite_media_log_fk', exists (
      select 1 from pg_constraint
      where conrelid = 'public.media_logs'::regclass
        and conname = 'media_logs_user_media_key_fkey'
        and contype = 'f' and confupdtype = 'c' and confdeltype = 'c'
        and convalidated
    ),
    'owner_fk_cascade_count', (select count(*) from pg_constraint
      where conrelid in ('public.media_library'::regclass, 'public.media_logs'::regclass)
        and contype = 'f' and confrelid = 'auth.users'::regclass
        and confdeltype = 'c' and convalidated),
    'validated_library_checks', (select count(*) from pg_constraint
      where conrelid = 'public.media_library'::regclass and contype = 'c'
        and conname in (
          'media_library_status_check', 'media_library_rating_check',
          'media_library_completion_date_check'
        ) and convalidated)
  ),
  'security', jsonb_build_object(
    'rls_enabled_relation_count', (select count(*) from app_relations where relrowsecurity),
    'rls_forced_relation_count', (select count(*) from app_relations where relforcerowsecurity),
    'expected_policy_count', (select count(*) from pg_policies
      where schemaname = 'public' and policyname in (
        'media_library_select_own', 'media_library_insert_own',
        'media_library_update_own', 'media_library_delete_own',
        'media_logs_select_own', 'media_logs_insert_own',
        'media_logs_update_own', 'media_logs_delete_own',
        'media_tombstones_own', 'log_tombstones_own'
      )),
    'anon_private_table_grants', (select count(*)
      from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'
        and table_name in (
          'media_library', 'media_logs', 'media_tombstones', 'log_tombstones'
        )),
    'authenticated_forbidden_table_grants', (select count(*)
      from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public'
        and table_name in (
          'media_library', 'media_logs', 'media_tombstones', 'log_tombstones'
        ) and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
    'authenticated_dml_grants', (select count(*)
      from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public'
        and table_name in (
          'media_library', 'media_logs', 'media_tombstones', 'log_tombstones'
        ) and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
  ),
  'realtime', jsonb_build_object(
    'full_replica_identity_count', (select count(*) from app_relations
      where relname in ('media_library', 'media_logs') and relreplident = 'f'),
    'publication_membership_count', (select count(*)
      from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename in (
          'media_library', 'media_logs', 'media_tombstones', 'log_tombstones'
        ))
  ),
  'supporting_contract', jsonb_build_object(
    'server_version_num', current_setting('server_version_num'),
    'app_relation_count', (select count(*) from app_relations),
    'expected_function_count', (select count(distinct p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      join expected_functions e on e.name = p.proname
      where n.nspname = 'public')
  )
) as canonical_contract;
