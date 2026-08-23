-- STAGING ONLY: remove the remediated application contract so the verified
-- legacy schema can be recreated. The snapshot schema is retained.
begin;

do $guard$
begin
  if (select count(*) from staging_reproducibility.media_library) <> 705
     or (select count(*) from staging_reproducibility.media_logs) <> 658 then
    raise exception 'Staging reset stopped: reproducibility snapshot is absent or incomplete';
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
