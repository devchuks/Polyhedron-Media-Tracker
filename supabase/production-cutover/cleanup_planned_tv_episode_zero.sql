-- REVIEWED PRODUCTION CUTOVER STEP; DO NOT EXECUTE DURING READ-ONLY PREFLIGHT.
-- The 2026-08-24 production preflight found exactly this one obsolete sentinel.
do $cleanup_planned_tv_episode_zero$
declare
  affected_rows integer;
  media_rows_before bigint;
begin
  select count(*) into media_rows_before from public.media_library;

  if (select count(*) from public.media_library
      where type = 'tv' and status = 'planned' and progress = 'S01 E00') <> 1 then
    raise exception 'Episode-zero cleanup stopped: expected exactly one production sentinel';
  end if;

  if (select count(*) from public.media_library
      where id = '126118' and type = 'tv' and title = 'Chapelwaite'
        and status = 'planned' and progress = 'S01 E00') <> 1 then
    raise exception 'Episode-zero cleanup stopped: Chapelwaite guard drifted';
  end if;

  update public.media_library
  set progress = null
  where id = '126118' and type = 'tv' and title = 'Chapelwaite'
    and status = 'planned' and progress = 'S01 E00';
  get diagnostics affected_rows = row_count;

  if affected_rows <> 1
     or (select count(*) from public.media_library) <> media_rows_before
     or exists (select 1 from public.media_library
                where type = 'tv' and status = 'planned' and progress = 'S01 E00') then
    raise exception 'Episode-zero cleanup stopped: post-update accounting failed';
  end if;
end
$cleanup_planned_tv_episode_zero$;
