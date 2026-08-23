-- STAGING ONLY: prove the authenticated role cannot TRUNCATE either private
-- source table. Each attempt is isolated and must raise insufficient_privilege.
do $probe$
declare
  denial_count integer := 0;
begin
  set local role authenticated;

  begin
    truncate table public.media_logs;
  exception when insufficient_privilege then
    denial_count := denial_count + 1;
  end;

  begin
    truncate table public.media_library;
  exception when insufficient_privilege then
    denial_count := denial_count + 1;
  end;

  reset role;

  if denial_count <> 2 then
    raise exception 'Authenticated TRUNCATE probe failed: expected 2 denials, observed %', denial_count;
  end if;
end
$probe$;

select
  (select count(*) from public.media_library) as media_rows,
  (select count(*) from public.media_logs) as log_rows,
  'authenticated TRUNCATE denied for both tables' as result;
