-- STAGING READ-ONLY: size/content metrics for the primary acceptance owner.
with primary_owner as (
  select user_id
  from public.media_library
  group by user_id
  order by count(*) desc
  limit 1
), media as (
  select m.*
  from public.media_library m
  join primary_owner o using (user_id)
), logs as (
  select l.*
  from public.media_logs l
  join primary_owner o using (user_id)
), completion_targets as (
  select * from (values
    ('1083381'::text, 'Backrooms'::text, '2026-07-20'::text),
    ('36557'::text, 'Casino Royale'::text, '2026-06-14'::text),
    ('1380316'::text, 'Is God Is'::text, '2026-06-23'::text),
    ('10764'::text, 'Quantum of Solace'::text, '2026-06-14'::text),
    ('1368337'::text, 'The Odyssey'::text, '2026-07-20'::text)
  ) expected(id, title, completion_date)
)
select jsonb_build_object(
  'ownership', jsonb_build_object(
    'media_owners', (select count(distinct user_id) from public.media_library),
    'log_owners', (select count(distinct user_id) from public.media_logs),
    'primary_media_rows', (select count(*) from media),
    'primary_log_rows', (select count(*) from logs),
    'other_owner_media_rows', (select count(*) from public.media_library where user_id <> (select user_id from primary_owner)),
    'other_owner_log_rows', (select count(*) from public.media_logs where user_id <> (select user_id from primary_owner))
  ),
  'payload', jsonb_build_object(
    'media_table_bytes', pg_total_relation_size('public.media_library'),
    'media_heap_bytes', pg_relation_size('public.media_library'),
    'media_json_bytes', (select coalesce(sum(pg_column_size(to_jsonb(media))), 0) from media),
    'api_data_bytes', (select coalesce(sum(pg_column_size("apiData")), 0) from media),
    'api_data_max_bytes', (select coalesce(max(pg_column_size("apiData")), 0) from media),
    'image_text_bytes', (select coalesce(sum(octet_length(image)), 0) from media),
    'log_json_bytes', (select coalesce(sum(pg_column_size(to_jsonb(logs))), 0) from logs),
    'review_text_bytes', (select coalesce(sum(octet_length(review_text)), 0) from logs)
  ),
  'recognizable_content', jsonb_build_object(
    'nonempty_api_data_rows', (select count(*) from media where "apiData" <> '{}'::jsonb),
    'nonempty_image_rows', (select count(*) from media where nullif(image, '') is not null),
    'nonempty_review_rows', (select count(*) from logs where nullif(review_text, '') is not null),
    'nonempty_log_image_rows', (select count(*) from logs where nullif(image, '') is not null),
    'fixture_title_rows', (select count(*) from media where title like 'Fixture %')
  ),
  'identity', jsonb_build_object(
    'collision_groups', (select count(*) from (
      select user_id, media_key from public.media_library group by user_id, media_key having count(*) > 1
    ) c),
    'orphan_logs', (select count(*) from public.media_logs l left join public.media_library m
      on m.user_id = l.user_id and m.media_key = l.media_key where m.library_row_id is null),
    'bogus_logs_remaining', (select count(*) from public.media_logs where log_id in (
      '08c943c8-cbf4-4462-b29e-780421751dbf',
      '922ad384-ce27-4daa-a5fc-591a30eb012e'
    ))
  ),
  'completion_targets', (select jsonb_agg(jsonb_build_object(
    'title', expected.title,
    'date', to_char(to_timestamp(m."dateCompleted" / 1000.0) at time zone 'UTC', 'YYYY-MM-DD'),
    'correct', to_char(to_timestamp(m."dateCompleted" / 1000.0) at time zone 'UTC', 'YYYY-MM-DD') = expected.completion_date
  ) order by expected.title)
  from completion_targets expected
  left join media m on m.type = 'movies' and m.id = expected.id and m.title = expected.title),
  'tombstones', jsonb_build_object(
    'media_rows', (select count(*) from public.media_tombstones),
    'log_rows', (select count(*) from public.log_tombstones)
  )
) as manual_discovery_metrics;
