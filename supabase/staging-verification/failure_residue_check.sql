-- STAGING ONLY: prove that an intentionally failed canonical migration left the
-- legacy schema untouched. A clean result is one row with all counts equal to 0.
select
  (select count(*)
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'media_library'
     and column_name in (
       'library_row_id', 'provider', 'provider_id', 'media_type',
       'media_key', 'updated_at'
     )) as canonical_library_columns,
  (select count(*)
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'media_logs'
     and column_name in ('provider', 'provider_id', 'media_key', 'updated_at'))
    as canonical_log_columns,
  (select count(*)
   from information_schema.tables
   where table_schema = 'public'
     and table_name in (
       'media_library_tombstones',
       'media_log_tombstones',
       'webhook_events',
       'edge_rate_limits'
     )) as canonical_tables,
  (select count(*) from public.media_library) as media_rows,
  (select count(*) from public.media_logs) as log_rows,
  (select count(*) from public.media_library
    where status = 'completed' and "dateCompleted" is null) as completion_blockers;
