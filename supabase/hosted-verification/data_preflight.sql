with
library_candidates as (
  select
    user_id,
    id,
    type as media_type,
    case type
      when 'movies' then 'tmdb'
      when 'tv' then 'tmdb'
      when 'games' then 'igdb'
      when 'anime' then 'anilist'
      when 'manga' then 'anilist'
      when 'vn' then 'vndb'
      when 'books' then 'openlibrary'
      when 'comics' then 'metron'
      else null
    end as provider,
    case type
      when 'games' then regexp_replace(id, '^igdb_', '', 'i')
      when 'books' then regexp_replace(id, '^/works/', '', 'i')
      else id
    end as provider_id
  from public.media_library
),
library_keys as (
  select *, provider || ':' || media_type || ':' || provider_id as media_key
  from library_candidates
),
log_candidates as (
  select
    log_id,
    user_id,
    media_id,
    media_type,
    log_date,
    season_label,
    case media_type
      when 'movies' then 'tmdb'
      when 'tv' then 'tmdb'
      when 'games' then 'igdb'
      when 'anime' then 'anilist'
      when 'manga' then 'anilist'
      when 'vn' then 'vndb'
      when 'books' then 'openlibrary'
      when 'comics' then 'metron'
      else null
    end as provider,
    case media_type
      when 'games' then regexp_replace(media_id, '^igdb_', '', 'i')
      when 'books' then regexp_replace(media_id, '^/works/', '', 'i')
      else media_id
    end as provider_id
  from public.media_logs
),
log_keys as (
  select *, provider || ':' || media_type || ':' || provider_id as media_key
  from log_candidates
)
select jsonb_build_object(
  'counts', jsonb_build_object(
    'library_rows', (select count(*) from public.media_library),
    'log_rows', (select count(*) from public.media_logs),
    'library_owners', (select count(distinct user_id) from public.media_library),
    'log_owners', (select count(distinct user_id) from public.media_logs)
  ),
  'library_by_type', coalesce((
    select jsonb_object_agg(type_key, row_count order by type_key)
    from (
      select coalesce(type, '<null>') as type_key, count(*) as row_count
      from public.media_library
      group by type
    ) grouped
  ), '{}'::jsonb),
  'library_by_status', coalesce((
    select jsonb_object_agg(status_key, row_count order by status_key)
    from (
      select coalesce(status, '<null>') as status_key, count(*) as row_count
      from public.media_library
      group by status
    ) grouped
  ), '{}'::jsonb),
  'logs_by_type', coalesce((
    select jsonb_object_agg(type_key, row_count order by type_key)
    from (
      select coalesce(media_type, '<null>') as type_key, count(*) as row_count
      from public.media_logs
      group by media_type
    ) grouped
  ), '{}'::jsonb),
  'logs_by_action', coalesce((
    select jsonb_object_agg(action_key, row_count order by action_key)
    from (
      select coalesce(action_type, '<null>') as action_key, count(*) as row_count
      from public.media_logs
      group by action_type
    ) grouped
  ), '{}'::jsonb),
  'ownership', jsonb_build_object(
    'library_null_user_id', (select count(*) from public.media_library where user_id is null),
    'logs_null_user_id', (select count(*) from public.media_logs where user_id is null),
    'library_missing_auth_user', (
      select count(*) from public.media_library m left join auth.users u on u.id = m.user_id where u.id is null
    ),
    'logs_missing_auth_user', (
      select count(*) from public.media_logs l left join auth.users u on u.id = l.user_id where u.id is null
    )
  ),
  'identity', jsonb_build_object(
    'library_unsupported_type_rows', (select count(*) from library_keys where provider is null),
    'log_unsupported_or_null_type_rows', (select count(*) from log_keys where provider is null),
    'library_empty_raw_id_rows', (select count(*) from public.media_library where btrim(id) = ''),
    'log_empty_media_id_rows', (select count(*) from public.media_logs where btrim(media_id) = ''),
    'canonical_library_duplicate_groups', (
      select count(*) from (
        select user_id, media_key from library_keys group by user_id, media_key having count(*) > 1
      ) collisions
    ),
    'canonical_library_duplicate_rows', (
      select coalesce(sum(row_count), 0) from (
        select count(*) as row_count from library_keys group by user_id, media_key having count(*) > 1
      ) collisions
    ),
    'raw_id_cross_type_groups', (
      select count(*) from (
        select user_id, id from public.media_library group by user_id, id having count(distinct type) > 1
      ) collisions
    ),
    'owner_log_id_duplicate_groups', (
      select count(*) from (
        select user_id, log_id from public.media_logs group by user_id, log_id having count(*) > 1
      ) collisions
    ),
    'global_log_id_duplicate_groups', (
      select count(*) from (
        select log_id from public.media_logs group by log_id having count(*) > 1
      ) collisions
    ),
    'canonical_orphan_log_rows', (
      select count(*)
      from log_keys l
      left join library_keys m on m.user_id = l.user_id and m.media_key = l.media_key
      where m.media_key is null
    ),
    'raw_same_owner_orphan_log_rows', (
      select count(*)
      from public.media_logs l
      left join public.media_library m on m.user_id = l.user_id and m.id = l.media_id
      where m.id is null
    )
  ),
  'library_invariants', jsonb_build_object(
    'null_status', (select count(*) from public.media_library where status is null),
    'unsupported_status', (
      select count(*) from public.media_library
      where status is not null and status not in ('planned', 'in progress', 'completed', 'dropped')
    ),
    'null_rating', (select count(*) from public.media_library where rating is null),
    'rating_out_of_range', (select count(*) from public.media_library where rating < 0 or rating > 10),
    'completed_without_date', (
      select count(*) from public.media_library where status = 'completed' and "dateCompleted" is null
    ),
    'noncompleted_with_date', (
      select count(*) from public.media_library where status <> 'completed' and "dateCompleted" is not null
    ),
    'null_title', (select count(*) from public.media_library where title is null),
    'empty_title', (select count(*) from public.media_library where btrim(title) = ''),
    'null_rewatch_count', (select count(*) from public.media_library where "rewatchCount" is null),
    'negative_rewatch_count', (select count(*) from public.media_library where "rewatchCount" < 0),
    'null_read_issue_ids', (select count(*) from public.media_library where "readIssueIds" is null),
    'read_issue_ids_not_array', (
      select count(*) from public.media_library
      where "readIssueIds" is not null and jsonb_typeof("readIssueIds") <> 'array'
    ),
    'null_api_data', (select count(*) from public.media_library where "apiData" is null),
    'api_data_not_object', (
      select count(*) from public.media_library
      where "apiData" is not null and jsonb_typeof("apiData") <> 'object'
    ),
    'added_at_nonpositive', (select count(*) from public.media_library where "addedAt" <= 0),
    'date_started_nonpositive', (select count(*) from public.media_library where "dateStarted" <= 0),
    'date_completed_nonpositive', (select count(*) from public.media_library where "dateCompleted" <= 0),
    'millisecond_dates_after_2100', (
      select count(*) from public.media_library
      where coalesce("addedAt", 0) > 4102444800000
         or coalesce("dateStarted", 0) > 4102444800000
         or coalesce("dateCompleted", 0) > 4102444800000
    )
  ),
  'log_invariants', jsonb_build_object(
    'null_log_date', (select count(*) from public.media_logs where log_date is null),
    'null_action_type', (select count(*) from public.media_logs where action_type is null),
    'null_review_text', (select count(*) from public.media_logs where review_text is null),
    'future_log_date_after_2100', (select count(*) from public.media_logs where log_date >= timestamptz '2100-01-01'),
    'same_day_identity_duplicate_groups', (
      select count(*) from (
        select user_id, media_key, (log_date at time zone 'UTC')::date, coalesce(season_label, '')
        from log_keys
        group by user_id, media_key, (log_date at time zone 'UTC')::date, coalesce(season_label, '')
        having count(*) > 1
      ) duplicates
    )
  )
) as data_preflight;
