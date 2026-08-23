-- PRODUCTION READ-ONLY: emit a privacy-minimized legacy fixture for staging.
-- Owner identifiers, reviews, images, and provider payloads are excluded.

with
sanitized_media as (
  select jsonb_build_object(
    'id', m.id,
    'title', case
      when m.type = 'movies' and m.title in (
        'Backrooms',
        'Casino Royale',
        'Is God Is',
        'Quantum of Solace',
        'The Odyssey'
      ) then m.title
      else 'Fixture ' || m.type || ' ' || row_number() over (partition by m.type order by m.id)
    end,
    'type', m.type,
    'subtype', m.subtype,
    'progress', m.progress,
    'status', m.status,
    'rating', m.rating,
    'addedAt', m."addedAt",
    'dateStarted', m."dateStarted",
    'dateCompleted', m."dateCompleted",
    'rewatchCount', m."rewatchCount",
    'readIssueIds', m."readIssueIds",
    'image', null,
    'apiData', '{}'::jsonb
  ) as row_data
  from public.media_library m
),
sanitized_logs as (
  select jsonb_build_object(
    'log_id', l.log_id,
    'media_id', l.media_id,
    'media_type', l.media_type,
    'action_type', l.action_type,
    'log_date', l.log_date,
    'review_text', case when l.review_text is null then null else '' end,
    'image', null,
    'season_label', l.season_label,
    'season_year', l.season_year
  ) as row_data
  from public.media_logs l
)
select jsonb_build_object(
  'media_count', (select count(*) from sanitized_media),
  'log_count', (select count(*) from sanitized_logs),
  'media', coalesce((select jsonb_agg(row_data order by row_data->>'type', row_data->>'id') from sanitized_media), '[]'::jsonb),
  'logs', coalesce((select jsonb_agg(row_data order by row_data->>'media_type', row_data->>'log_id') from sanitized_logs), '[]'::jsonb)
) as staging_fixture;
