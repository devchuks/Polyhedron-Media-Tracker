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
    end || ':' || m.type || ':' ||
    case m.type
      when 'games' then regexp_replace(m.id, '^igdb_', '', 'i')
      when 'books' then regexp_replace(m.id, '^/works/', '', 'i')
      else m.id
    end as media_key
  from public.media_library m
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
    end || ':' || l.media_type || ':' ||
    case l.media_type
      when 'games' then regexp_replace(l.media_id, '^igdb_', '', 'i')
      when 'books' then regexp_replace(l.media_id, '^/works/', '', 'i')
      else l.media_id
    end as media_key
  from public.media_logs l
),
missing_completion as (
  select m.user_id, m.media_key, m.type, m."addedAt", m."dateStarted"
  from library_keys m
  where m.status = 'completed' and m."dateCompleted" is null
),
missing_completion_evidence as (
  select
    m.user_id,
    m.media_key,
    m.type,
    m."addedAt",
    m."dateStarted",
    count(l.log_id) as linked_log_count,
    max(l.log_date) as latest_linked_log_date
  from missing_completion m
  left join log_keys l on l.user_id = m.user_id and l.media_key = m.media_key
  group by m.user_id, m.media_key, m.type, m."addedAt", m."dateStarted"
),
orphans as (
  select l.*
  from log_keys l
  left join library_keys m on m.user_id = l.user_id and m.media_key = l.media_key
  where m.media_key is null
)
select jsonb_build_object(
  'completed_without_date', jsonb_build_object(
    'by_type', coalesce((
      select jsonb_object_agg(type, row_count order by type)
      from (select type, count(*) as row_count from missing_completion_evidence group by type) grouped
    ), '{}'::jsonb),
    'with_linked_log', (select count(*) from missing_completion_evidence where linked_log_count > 0),
    'without_linked_log', (select count(*) from missing_completion_evidence where linked_log_count = 0),
    'with_date_started', (select count(*) from missing_completion_evidence where "dateStarted" is not null),
    'with_added_at', (select count(*) from missing_completion_evidence where "addedAt" is not null),
    'linked_log_action_counts', coalesce((
      select jsonb_object_agg(action_key, row_count order by action_key)
      from (
        select coalesce(l.action_type, '<null>') as action_key, count(*) as row_count
        from missing_completion m
        join log_keys l on l.user_id = m.user_id and l.media_key = m.media_key
        group by l.action_type
      ) grouped
    ), '{}'::jsonb)
  ),
  'orphan_logs', jsonb_build_object(
    'by_type', coalesce((
      select jsonb_object_agg(type_key, row_count order by type_key)
      from (
        select coalesce(media_type, '<null>') as type_key, count(*) as row_count
        from orphans group by media_type
      ) grouped
    ), '{}'::jsonb),
    'by_action', coalesce((
      select jsonb_object_agg(action_key, row_count order by action_key)
      from (
        select coalesce(action_type, '<null>') as action_key, count(*) as row_count
        from orphans group by action_type
      ) grouped
    ), '{}'::jsonb),
    'with_review_text', (select count(*) from orphans where coalesce(review_text, '') <> ''),
    'with_image', (select count(*) from orphans where coalesce(image, '') <> ''),
    'image_matches_same_owner_library', (
      select count(*)
      from orphans o
      where coalesce(o.image, '') <> ''
        and exists (
          select 1 from public.media_library m
          where m.user_id = o.user_id and coalesce(m.image, '') = o.image
        )
    )
  ),
  'identifier_shapes', jsonb_build_object(
    'tmdb_non_numeric', (
      select count(*) from public.media_library where type in ('movies', 'tv') and id !~ '^[0-9]+$'
    ),
    'anilist_non_numeric', (
      select count(*) from public.media_library where type in ('anime', 'manga') and id !~ '^[0-9]+$'
    ),
    'igdb_prefixed', (
      select count(*) from public.media_library where type = 'games' and id ~* '^igdb_[0-9]+$'
    ),
    'igdb_raw_numeric', (
      select count(*) from public.media_library where type = 'games' and id ~ '^[0-9]+$'
    ),
    'igdb_other', (
      select count(*) from public.media_library where type = 'games' and id !~* '^igdb_[0-9]+$' and id !~ '^[0-9]+$'
    ),
    'vndb_expected', (
      select count(*) from public.media_library where type = 'vn' and id ~* '^v[0-9]+$'
    ),
    'vndb_other', (
      select count(*) from public.media_library where type = 'vn' and id !~* '^v[0-9]+$'
    ),
    'openlibrary_work_path', (
      select count(*) from public.media_library where type = 'books' and id ~* '^/works/OL[0-9]+W$'
    ),
    'openlibrary_work_id', (
      select count(*) from public.media_library where type = 'books' and id ~* '^OL[0-9]+W$'
    ),
    'openlibrary_other', (
      select count(*) from public.media_library
      where type = 'books' and id !~* '^/works/OL[0-9]+W$' and id !~* '^OL[0-9]+W$'
    ),
    'metron_series_prefixed', (
      select count(*) from public.media_library where type = 'comics' and id ~* '^series_[0-9]+$'
    ),
    'metron_issue_prefixed', (
      select count(*) from public.media_library where type = 'comics' and id ~* '^issue_[0-9]+$'
    ),
    'metron_raw_numeric', (
      select count(*) from public.media_library where type = 'comics' and id ~ '^[0-9]+$'
    ),
    'metron_other', (
      select count(*) from public.media_library
      where type = 'comics'
        and id !~* '^series_[0-9]+$'
        and id !~* '^issue_[0-9]+$'
        and id !~ '^[0-9]+$'
    )
  )
) as blocker_characteristics;
