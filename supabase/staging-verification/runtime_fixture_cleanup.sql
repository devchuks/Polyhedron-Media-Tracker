-- STAGING ONLY: remove only fixtures created by staging-runtime-verification.mjs.
-- Production-derived provider identifiers and log IDs do not use this prefix.
begin;

delete from public.media_logs
where log_id like 'staging-%';

delete from public.media_library
where provider_id like 'staging-%';

delete from public.log_tombstones
where log_id like 'staging-%';

delete from public.media_tombstones
where media_key like '%:staging-%';

commit;
