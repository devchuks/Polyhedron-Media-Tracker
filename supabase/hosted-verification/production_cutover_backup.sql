-- PRODUCTION READ-ONLY. Save the complete result only under the ignored
-- .supabase/production-cutover directory during an explicitly authorized cutover.
select jsonb_build_object(
  'captured_at', clock_timestamp(),
  'media_count', (select count(*) from public.media_library),
  'log_count', (select count(*) from public.media_logs),
  'media_library', coalesce((
    select jsonb_agg(to_jsonb(m) order by m.user_id, m.type, m.id)
    from public.media_library m
  ), '[]'::jsonb),
  'media_logs', coalesce((
    select jsonb_agg(to_jsonb(l) order by l.user_id, l.log_date, l.log_id)
    from public.media_logs l
  ), '[]'::jsonb)
) as production_cutover_backup;
