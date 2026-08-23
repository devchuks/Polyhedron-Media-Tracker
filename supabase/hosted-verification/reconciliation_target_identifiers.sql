with
approved_movies(title, expected_date) as (
  values
    ('Backrooms'::text, date '2026-07-20'),
    ('Casino Royale'::text, date '2026-06-14'),
    ('Is God Is'::text, date '2026-06-23'),
    ('Quantum of Solace'::text, date '2026-06-14'),
    ('The Odyssey'::text, date '2026-07-20')
),
movie_targets as (
  select
    m.id,
    m.title,
    m.type,
    m.status,
    m."dateStarted",
    m."dateCompleted",
    a.expected_date,
    count(l.log_id) filter (where l.action_type = 'WATCHED') as watched_log_count,
    coalesce(
      jsonb_agg(
        jsonb_build_object('log_id', l.log_id, 'log_date', l.log_date)
        order by l.log_date
      ) filter (where l.log_id is not null and l.action_type = 'WATCHED'),
      '[]'::jsonb
    ) as watched_logs
  from approved_movies a
  join public.media_library m
    on m.title = a.title
   and m.type = 'movies'
   and m.status = 'completed'
   and m."dateCompleted" is null
  left join public.media_logs l
    on l.user_id = m.user_id
   and l.media_id = m.id
   and l.media_type = m.type
   and l.action_type = 'WATCHED'
  group by m.user_id, m.id, m.title, m.type, m.status,
    m."dateStarted", m."dateCompleted", a.expected_date
),
library_keys as (
  select
    m.user_id,
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
orphan_targets as (
  select
    l.log_id,
    l.media_type,
    l.media_id,
    l.action_type,
    l.log_date,
    l.season_label,
    l.season_year
  from public.media_logs l
  left join library_keys m
    on m.user_id = l.user_id
   and m.media_key = (
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
     end
   )
  where m.media_key is null
    and (
      (l.media_type = 'manga' and l.media_id = '77917' and l.action_type = 'READ')
      or (l.media_type = 'vn' and l.media_id = 'v1298' and l.action_type = 'PLAYED')
    )
)
select jsonb_build_object(
  'movie_targets', coalesce(
    (select jsonb_agg(to_jsonb(movie_targets) order by title) from movie_targets),
    '[]'::jsonb
  ),
  'orphan_log_targets', coalesce(
    (select jsonb_agg(to_jsonb(orphan_targets) order by media_type) from orphan_targets),
    '[]'::jsonb
  )
) as reconciliation_target_identifiers;
