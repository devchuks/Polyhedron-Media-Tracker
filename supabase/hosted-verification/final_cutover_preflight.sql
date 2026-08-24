-- PRODUCTION READ-ONLY: aggregate and deterministic cutover guards only.
-- This file contains one SELECT and must never be changed into a mutating query.
with expected_media(id, type, title, expected_date) as (
  values
    ('1083381', 'movies', 'Backrooms', date '2026-07-20'),
    ('36557', 'movies', 'Casino Royale', date '2026-06-14'),
    ('1380316', 'movies', 'Is God Is', date '2026-06-23'),
    ('10764', 'movies', 'Quantum of Solace', date '2026-06-14'),
    ('1368337', 'movies', 'The Odyssey', date '2026-07-20')
),
expected_logs(log_id, media_id, media_type, action_type) as (
  values
    ('08c943c8-cbf4-4462-b29e-780421751dbf', '77917', 'manga', 'READ'),
    ('922ad384-ce27-4daa-a5fc-591a30eb012e', 'v1298', 'vn', 'PLAYED')
),
sentinels as (
  select id, title, type, status, progress
  from public.media_library
  where type = 'tv' and status = 'planned' and progress = 'S01 E00'
)
select jsonb_build_object(
  'production_ref_guard', current_database(),
  'reconciliation_media', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id,
      'type', e.type,
      'title', e.title,
      'exists', m.id is not null,
      'title_matches', m.title is not distinct from e.title,
      'completed_without_date', m.status = 'completed' and m."dateCompleted" is null,
      'started_calendar_date', case when m."dateStarted" is null then null else (to_timestamp(m."dateStarted" / 1000.0) at time zone 'UTC')::date end,
      'expected_calendar_date', e.expected_date,
      'matching_watched_logs', (
        select count(*) from public.media_logs l
        where l.user_id = m.user_id and l.media_id = m.id and l.media_type = m.type and l.action_type = 'WATCHED'
      )
    ) order by e.title)
    from expected_media e
    left join public.media_library m on m.id = e.id and m.type = e.type
  ), '[]'::jsonb),
  'reconciliation_logs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'log_id', e.log_id,
      'media_id', e.media_id,
      'media_type', e.media_type,
      'action_type', e.action_type,
      'exists', l.log_id is not null,
      'guard_matches', l.media_id = e.media_id and l.media_type = e.media_type and l.action_type = e.action_type,
      'has_deterministic_parent', exists (
        select 1 from public.media_library m
        where m.user_id = l.user_id and m.id = l.media_id and m.type = l.media_type
      )
    ) order by e.media_type)
    from expected_logs e
    left join public.media_logs l on l.log_id = e.log_id
  ), '[]'::jsonb),
  'planned_tv_episode_zero', jsonb_build_object(
    'count', (select count(*) from sentinels),
    'rows', coalesce((select jsonb_agg(to_jsonb(s) order by s.title, s.id) from sentinels s), '[]'::jsonb)
  )
) as final_cutover_preflight;
