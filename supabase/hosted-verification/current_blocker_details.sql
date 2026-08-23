with
library_keys as (
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
    end as provider,
    case m.type
      when 'games' then regexp_replace(m.id, '^igdb_', '', 'i')
      when 'books' then regexp_replace(m.id, '^/works/', '', 'i')
      else m.id
    end as provider_id
  from public.media_library m
),
canonical_library as (
  select *, provider || ':' || type || ':' || provider_id as media_key
  from library_keys
),
log_keys as (
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
    end as provider,
    case l.media_type
      when 'games' then regexp_replace(l.media_id, '^igdb_', '', 'i')
      when 'books' then regexp_replace(l.media_id, '^/works/', '', 'i')
      else l.media_id
    end as provider_id
  from public.media_logs l
),
canonical_logs as (
  select *, provider || ':' || media_type || ':' || provider_id as media_key
  from log_keys
),
missing_completion as (
  select
    m.*,
    count(*) over (partition by lower(btrim(m.title)), m.type) as blocker_title_count
  from canonical_library m
  where m.status = 'completed' and m."dateCompleted" is null
),
completed_details as (
  select jsonb_build_object(
    'title', m.title,
    'media_type', m.type,
    'status', m.status,
    'disambiguating_raw_media_id', case when m.blocker_title_count > 1 then m.id else null end,
    'date_started_utc', case when m."dateStarted" is null then null
      else to_char(to_timestamp(m."dateStarted" / 1000.0) at time zone 'UTC', 'YYYY-MM-DD') end,
    'added_at_utc', case when m."addedAt" is null then null
      else to_char(to_timestamp(m."addedAt" / 1000.0) at time zone 'UTC', 'YYYY-MM-DD') end,
    'matching_diary_log_count', count(l.log_id),
    'completion_evidence_log_count', count(l.log_id) filter (
      where l.action_type in ('WATCHED', 'READ', 'PLAYED')
    ),
    'completion_evidence_logs', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'action_type', l.action_type,
          'log_date_utc', to_char(l.log_date at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')
        ) order by l.log_date
      ) filter (where l.log_id is not null and l.action_type in ('WATCHED', 'READ', 'PLAYED')),
      '[]'::jsonb
    )
  ) as detail
  from missing_completion m
  left join canonical_logs l on l.user_id = m.user_id and l.media_key = m.media_key
  group by m.user_id, m.media_key, m.title, m.type, m.status, m.id,
    m.blocker_title_count, m."dateStarted", m."addedAt"
),
orphans as (
  select l.*
  from canonical_logs l
  left join canonical_library m on m.user_id = l.user_id and m.media_key = l.media_key
  where m.media_key is null
),
orphan_details as (
  select jsonb_build_object(
    'media_type', o.media_type,
    'action_type', o.action_type,
    'provider', o.provider,
    'provider_id', o.provider_id,
    'season_label', o.season_label,
    'season_year', o.season_year,
    'log_date_utc', to_char(o.log_date at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    'image_url', o.image,
    'exact_canonical_match_count', count(distinct m.media_key) filter (where m.media_key = o.media_key),
    'same_raw_id_match_count', count(distinct raw_match.id),
    'exact_image_match_count', count(distinct image_match.id)
  ) as detail
  from orphans o
  left join canonical_library m on m.user_id = o.user_id and m.media_key = o.media_key
  left join public.media_library raw_match
    on raw_match.user_id = o.user_id and raw_match.id = o.media_id
  left join public.media_library image_match
    on image_match.user_id = o.user_id
   and coalesce(o.image, '') <> ''
   and image_match.image = o.image
  group by o.log_id, o.media_type, o.action_type, o.provider, o.provider_id,
    o.season_label, o.season_year, o.log_date, o.image
)
select jsonb_build_object(
  'completed_items_missing_completion_dates', coalesce(
    (select jsonb_agg(detail order by detail->>'title', detail->>'media_type') from completed_details),
    '[]'::jsonb
  ),
  'orphan_diary_logs', coalesce(
    (select jsonb_agg(detail order by detail->>'media_type', detail->>'log_date_utc') from orphan_details),
    '[]'::jsonb
  )
) as current_blocker_details;
