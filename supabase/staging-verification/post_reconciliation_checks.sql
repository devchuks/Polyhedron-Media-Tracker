-- STAGING ONLY: preservation accounting after the reviewed reconciliation.
with corrected as (
  select
    m.title,
    m.id,
    m."dateStarted",
    m."dateCompleted",
    to_char(
      to_timestamp(m."dateCompleted" / 1000.0) at time zone 'UTC',
      'YYYY-MM-DD'
    ) as completion_date_utc,
    case m.id
      when '36557' then (
        select (extract(epoch from l.log_date) * 1000)::bigint
        from public.media_logs l
        where l.log_id = '140de8e8-a7d8-4963-849e-f2f39bf7d2ba'
      )
      when '10764' then (
        select (extract(epoch from l.log_date) * 1000)::bigint
        from public.media_logs l
        where l.log_id = '2c348f41-a6a7-4318-958b-9bbca2dd1199'
      )
      else m."dateStarted"
    end as expected_completion_timestamp
  from public.media_library m
  where m.type = 'movies'
    and m.id in ('1083381', '36557', '1380316', '10764', '1368337')
), exact_orphans as (
  select count(*) as remaining
  from public.media_logs
  where log_id in (
    '08c943c8-cbf4-4462-b29e-780421751dbf',
    '922ad384-ce27-4daa-a5fc-591a30eb012e'
  )
)
select
  (select count(*) from public.media_library) as media_rows,
  (select count(*) from public.media_logs) as log_rows,
  (select count(*) from corrected) as corrected_target_rows,
  (select count(*) from corrected
   where "dateCompleted" = expected_completion_timestamp) as exact_timestamp_matches,
  (select count(*) from public.media_library
   where status = 'completed' and "dateCompleted" is null) as completion_blockers,
  (select remaining from exact_orphans) as deleted_orphans_remaining,
  (select jsonb_agg(
     jsonb_build_object(
       'title', title,
       'raw_id', id,
       'completion_date_utc', completion_date_utc,
       'timestamp_matches_approved_source',
         "dateCompleted" = expected_completion_timestamp
     ) order by title
   ) from corrected) as approved_corrections;
