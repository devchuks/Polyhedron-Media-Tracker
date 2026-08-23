-- PRODUCTION READ-ONLY. The caller must keep the result in memory and must not
-- print or commit it because it contains the user's application-visible data.
-- Production owner UUIDs are intentionally omitted.
select jsonb_build_object(
  'library_rows', (select count(*) from public.media_library),
  'log_rows', (select count(*) from public.media_logs),
  'library_owners', (select count(distinct user_id) from public.media_library),
  'log_owners', (select count(distinct user_id) from public.media_logs),
  'media', coalesce((
    select jsonb_agg(to_jsonb(m) - 'user_id' order by m.type, m.id)
    from public.media_library m
  ), '[]'::jsonb),
  'logs', coalesce((
    select jsonb_agg(to_jsonb(l) - 'user_id' order by l.log_date, l.log_id)
    from public.media_logs l
  ), '[]'::jsonb)
) as actual_fixture;
