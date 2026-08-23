-- STAGING ONLY: populate the freshly recreated legacy tables from the
-- seven-blocker snapshot, then remove the temporary snapshot schema.
begin;

do $guard$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'media_library'
      and column_name in ('library_row_id', 'media_key', 'provider')
  ) then
    raise exception 'Staging restore stopped: media_library is not the legacy contract';
  end if;
end
$guard$;

insert into public.media_library (
  id, user_id, title, type, subtype, progress, status, rating,
  "addedAt", "dateStarted", "dateCompleted", "rewatchCount",
  "readIssueIds", image, "apiData"
)
select
  id, user_id, title, type, subtype, progress, status, rating,
  "addedAt", "dateStarted", "dateCompleted", "rewatchCount",
  "readIssueIds", image, "apiData"
from staging_reproducibility.media_library;

insert into public.media_logs (
  log_id, user_id, media_id, media_type, action_type, log_date,
  review_text, image, season_label, season_year
)
select
  log_id, user_id, media_id, media_type, action_type, log_date,
  review_text, image, season_label, season_year
from staging_reproducibility.media_logs;

do $accounting$
begin
  if (select count(*) from public.media_library) <> 705
     or (select count(*) from public.media_logs) <> 658
     or (select count(*) from public.media_library
         where status = 'completed' and "dateCompleted" is null) <> 5
     or (select count(*) from public.media_logs
         where log_id in (
           '08c943c8-cbf4-4462-b29e-780421751dbf',
           '922ad384-ce27-4daa-a5fc-591a30eb012e'
         )) <> 2 then
    raise exception 'Staging restore stopped: seven-blocker accounting failed';
  end if;
end
$accounting$;

drop schema staging_reproducibility cascade;

commit;
