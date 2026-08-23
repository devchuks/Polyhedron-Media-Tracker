-- STAGING ONLY: remove the current remediated application tables before a
-- full-fidelity production READ-ONLY fixture is loaded into the legacy schema.
begin;

do $guard$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'media_library'
      and column_name = 'media_key'
  ) or not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'media_logs'
  ) then
    raise exception 'Manual acceptance reset stopped: staging is not in the expected canonical state';
  end if;
end
$guard$;

drop table public.media_logs cascade;
drop table public.media_library cascade;
drop table public.media_tombstones cascade;
drop table public.log_tombstones cascade;
drop table public.edge_rate_limits cascade;
drop table public.webhook_events cascade;
drop table public.webhook_batches cascade;

commit;
