-- STAGING ONLY: preserve a legacy-shaped copy before a destructive staging
-- reconstruction. The two reviewed bogus orphan shapes are deliberately
-- restored so reconciliation is exercised again.
begin;

do $guard$
begin
  if (select count(*) from public.media_library) <> 705
     or (select count(*) from public.media_logs) <> 656
     or exists (select 1 from public.media_library where provider_id like 'staging-%')
     or exists (select 1 from public.media_logs where log_id like 'staging-%') then
    raise exception 'Reproducibility snapshot stopped: staging source accounting is not clean';
  end if;
end
$guard$;

drop schema if exists staging_reproducibility cascade;
create schema staging_reproducibility;

create table staging_reproducibility.media_library as
select
  id,
  user_id,
  title,
  type,
  subtype,
  progress,
  status,
  rating,
  "addedAt",
  "dateStarted",
  case
    when type = 'movies'
      and status = 'completed'
      and (
        (id = '1083381' and title = 'Backrooms')
        or (id = '36557' and title = 'Casino Royale')
        or (id = '1380316' and title = 'Is God Is')
        or (id = '10764' and title = 'Quantum of Solace')
        or (id = '1368337' and title = 'The Odyssey')
      )
      then null::bigint
    else "dateCompleted"
  end as "dateCompleted",
  "rewatchCount",
  "readIssueIds",
  image,
  "apiData"
from public.media_library;

create table staging_reproducibility.media_logs as
select
  log_id,
  user_id,
  media_id,
  media_type,
  action_type,
  log_date,
  review_text,
  image,
  season_label,
  season_year
from public.media_logs;

insert into staging_reproducibility.media_logs (
  log_id, user_id, media_id, media_type, action_type, log_date,
  review_text, image, season_label, season_year
)
select
  bogus.log_id,
  owner.user_id,
  bogus.media_id,
  bogus.media_type,
  bogus.action_type,
  bogus.log_date,
  '',
  null,
  null,
  null
from (
  values
    (
      '08c943c8-cbf4-4462-b29e-780421751dbf'::text,
      '77917'::text,
      'manga'::text,
      'READ'::text,
      '2026-05-29T15:05:52+00:00'::timestamptz
    ),
    (
      '922ad384-ce27-4daa-a5fc-591a30eb012e'::text,
      'v1298'::text,
      'vn'::text,
      'PLAYED'::text,
      '2026-05-29T18:43:36+00:00'::timestamptz
    )
) bogus(log_id, media_id, media_type, action_type, log_date)
cross join lateral (
  select user_id from staging_reproducibility.media_library limit 1
) owner;

do $accounting$
begin
  if (select count(*) from staging_reproducibility.media_library) <> 705
     or (select count(*) from staging_reproducibility.media_logs) <> 658
     or (select count(*) from staging_reproducibility.media_library
         where status = 'completed' and "dateCompleted" is null) <> 5
     or (select count(*) from staging_reproducibility.media_logs
         where log_id in (
           '08c943c8-cbf4-4462-b29e-780421751dbf',
           '922ad384-ce27-4daa-a5fc-591a30eb012e'
         )) <> 2 then
    raise exception 'Reproducibility snapshot stopped: seven-blocker accounting failed';
  end if;
end
$accounting$;

commit;
