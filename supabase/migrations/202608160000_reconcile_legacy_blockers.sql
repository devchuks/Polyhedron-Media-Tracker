-- Preservation-safe, single-use reconciliation of the seven legacy blockers
-- approved by the data owner on 2026-08-23.
--
-- This migration intentionally precedes 202608160001_canonical_identity_rls.sql.
-- Every mutation and assertion is contained in one DO statement, so an
-- exception rolls back the entire statement even if a migration runner does not
-- wrap the file in a wider transaction.

do $reconcile_legacy_blockers$
declare
  target record;
  affected_rows integer;
  matching_rows bigint;
  completion_blockers bigint;
  orphan_blockers bigint;
  media_rows_before bigint;
  log_rows_before bigint;
  corrected_media integer := 0;
  deleted_logs integer := 0;
  observed_started_at bigint;
  observed_log_date timestamptz;
begin
  select count(*) into media_rows_before from public.media_library;
  select count(*) into log_rows_before from public.media_logs;

  -- Refuse any ownership, identity-shape, invariant, or type drift not covered
  -- by the seven explicit decisions below.
  if exists (select 1 from public.media_library where user_id is null)
     or exists (select 1 from public.media_logs where user_id is null) then
    raise exception 'Legacy reconciliation stopped: ownership drift detected';
  end if;

  if exists (
    select 1
    from public.media_library
    where btrim(id) = ''
       or type not in ('movies', 'tv', 'games', 'anime', 'manga', 'vn', 'books', 'comics')
       or status is null
       or status not in ('planned', 'in progress', 'completed', 'dropped')
       or rating is null or rating < 0 or rating > 10
       or "rewatchCount" is null or "rewatchCount" < 0
       or "readIssueIds" is null or jsonb_typeof("readIssueIds") <> 'array'
       or "apiData" is null or jsonb_typeof("apiData") <> 'object'
       or (status <> 'completed' and "dateCompleted" is not null)
       or coalesce("addedAt", 1) <= 0
       or coalesce("dateStarted", 1) <= 0
       or coalesce("dateCompleted", 1) <= 0
       or coalesce("addedAt", 0) > 4102444800000
       or coalesce("dateStarted", 0) > 4102444800000
       or coalesce("dateCompleted", 0) > 4102444800000
  ) then
    raise exception 'Legacy reconciliation stopped: unapproved library blocker detected';
  end if;

  if exists (
    select 1
    from public.media_logs
    where btrim(media_id) = ''
       or media_type is null
       or media_type not in ('movies', 'tv', 'games', 'anime', 'manga', 'vn', 'books', 'comics')
       or action_type is null
       or log_date is null
       or review_text is null
       or log_date >= timestamptz '2100-01-01 00:00:00+00'
  ) then
    raise exception 'Legacy reconciliation stopped: unapproved diary blocker detected';
  end if;

  if exists (
    with candidates as (
      select
        user_id,
        case type
          when 'movies' then 'tmdb'
          when 'tv' then 'tmdb'
          when 'games' then 'igdb'
          when 'anime' then 'anilist'
          when 'manga' then 'anilist'
          when 'vn' then 'vndb'
          when 'books' then 'openlibrary'
          when 'comics' then 'metron'
        end || ':' || type || ':' ||
        case type
          when 'games' then regexp_replace(id, '^igdb_', '', 'i')
          when 'books' then regexp_replace(id, '^/works/', '', 'i')
          else id
        end as media_key
      from public.media_library
    )
    select 1
    from candidates
    group by user_id, media_key
    having count(*) > 1
  ) then
    raise exception 'Legacy reconciliation stopped: canonical identity collision detected';
  end if;

  select count(*)
  into completion_blockers
  from public.media_library
  where status = 'completed' and "dateCompleted" is null;

  if completion_blockers <> 5 then
    raise exception 'Legacy reconciliation stopped: expected 5 completion blockers, found %', completion_blockers;
  end if;

  with
  library_keys as (
    select
      user_id,
      case type
        when 'movies' then 'tmdb'
        when 'tv' then 'tmdb'
        when 'games' then 'igdb'
        when 'anime' then 'anilist'
        when 'manga' then 'anilist'
        when 'vn' then 'vndb'
        when 'books' then 'openlibrary'
        when 'comics' then 'metron'
      end || ':' || type || ':' ||
      case type
        when 'games' then regexp_replace(id, '^igdb_', '', 'i')
        when 'books' then regexp_replace(id, '^/works/', '', 'i')
        else id
      end as media_key
    from public.media_library
  ),
  log_keys as (
    select
      l.user_id,
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
      end as media_key
    from public.media_logs l
  )
  select count(*)
  into orphan_blockers
  from log_keys l
  left join library_keys m on m.user_id = l.user_id and m.media_key = l.media_key
  where m.media_key is null;

  if orphan_blockers <> 2 then
    raise exception 'Legacy reconciliation stopped: expected 2 orphan logs, found %', orphan_blockers;
  end if;

  -- The data owner confirmed that dateStarted is the correct completion
  -- timestamp for these three unique TMDB movie rows.
  for target in
    select *
    from (values
      ('1083381'::text, 'Backrooms'::text, date '2026-07-20', 1784533851003::bigint),
      ('1380316'::text, 'Is God Is'::text, date '2026-06-23', 1782205917000::bigint),
      ('1368337'::text, 'The Odyssey'::text, date '2026-07-20', 1784533851002::bigint)
    ) approved(media_id, expected_title, expected_date, expected_started_at)
  loop
    select count(*), max("dateStarted")
    into matching_rows, observed_started_at
    from public.media_library
    where id = target.media_id
      and title = target.expected_title
      and type = 'movies'
      and status = 'completed'
      and "dateCompleted" is null
      and "dateStarted" = target.expected_started_at;

    if matching_rows <> 1 then
      raise exception 'Legacy reconciliation stopped: expected one unchanged target for %, found %',
        target.expected_title, matching_rows;
    end if;

    if (to_timestamp(observed_started_at / 1000.0) at time zone 'UTC')::date <> target.expected_date then
      raise exception 'Legacy reconciliation stopped: dateStarted calendar drift for %', target.expected_title;
    end if;

    update public.media_library
    set "dateCompleted" = "dateStarted"
    where id = target.media_id
      and title = target.expected_title
      and type = 'movies'
      and status = 'completed'
      and "dateCompleted" is null
      and "dateStarted" = target.expected_started_at;
    get diagnostics affected_rows = row_count;

    if affected_rows <> 1 then
      raise exception 'Legacy reconciliation stopped: completion update drift for %', target.expected_title;
    end if;
    corrected_media := corrected_media + affected_rows;
  end loop;

  -- The data owner approved each unique WATCHED diary timestamp as the exact
  -- completion timestamp for its matching TMDB movie.
  for target in
    select *
    from (values
      (
        '36557'::text,
        'Casino Royale'::text,
        date '2026-06-14',
        '140de8e8-a7d8-4963-849e-f2f39bf7d2ba'::text,
        timestamptz '2026-06-14 17:10:59.858+00'
      ),
      (
        '10764'::text,
        'Quantum of Solace'::text,
        date '2026-06-14',
        '2c348f41-a6a7-4318-958b-9bbca2dd1199'::text,
        timestamptz '2026-06-14 17:12:24.386+00'
      )
    ) approved(media_id, expected_title, expected_date, watched_log_id, expected_log_date)
  loop
    select count(*), max(l.log_date)
    into matching_rows, observed_log_date
    from public.media_library m
    join public.media_logs l
      on l.user_id = m.user_id
     and l.media_id = m.id
     and l.media_type = m.type
     and l.action_type = 'WATCHED'
    where m.id = target.media_id
      and m.title = target.expected_title
      and m.type = 'movies'
      and m.status = 'completed'
      and m."dateCompleted" is null;

    if matching_rows <> 1 then
      raise exception 'Legacy reconciliation stopped: expected one WATCHED log for %, found %',
        target.expected_title, matching_rows;
    end if;

    if observed_log_date <> target.expected_log_date then
      raise exception 'Legacy reconciliation stopped: WATCHED timestamp drift for %', target.expected_title;
    end if;

    if (observed_log_date at time zone 'UTC')::date <> target.expected_date then
      raise exception 'Legacy reconciliation stopped: WATCHED calendar drift for %', target.expected_title;
    end if;

    if not exists (
      select 1
      from public.media_logs l
      join public.media_library m on m.user_id = l.user_id and m.id = l.media_id and m.type = l.media_type
      where l.log_id = target.watched_log_id
        and l.media_id = target.media_id
        and l.media_type = 'movies'
        and l.action_type = 'WATCHED'
        and l.log_date = target.expected_log_date
        and m.title = target.expected_title
        and m.status = 'completed'
        and m."dateCompleted" is null
    ) then
      raise exception 'Legacy reconciliation stopped: stable WATCHED log identity drift for %', target.expected_title;
    end if;

    update public.media_library
    set "dateCompleted" = floor(extract(epoch from observed_log_date) * 1000)::bigint
    where id = target.media_id
      and title = target.expected_title
      and type = 'movies'
      and status = 'completed'
      and "dateCompleted" is null;
    get diagnostics affected_rows = row_count;

    if affected_rows <> 1 then
      raise exception 'Legacy reconciliation stopped: completion update drift for %', target.expected_title;
    end if;
    corrected_media := corrected_media + affected_rows;
  end loop;

  if corrected_media <> 5 then
    raise exception 'Legacy reconciliation stopped: expected 5 corrected media rows, corrected %', corrected_media;
  end if;

  -- The data owner confirmed these exact stable diary records are bogus. Each
  -- delete repeats all material legacy fields and refuses to run if a canonical
  -- parent now exists for the same owner.
  for target in
    select *
    from (values
      (
        '08c943c8-cbf4-4462-b29e-780421751dbf'::text,
        'manga'::text,
        '77917'::text,
        'READ'::text,
        timestamptz '2026-05-29 15:05:52+00'
      ),
      (
        '922ad384-ce27-4daa-a5fc-591a30eb012e'::text,
        'vn'::text,
        'v1298'::text,
        'PLAYED'::text,
        timestamptz '2026-05-29 18:43:36+00'
      )
    ) approved(log_id, media_type, media_id, action_type, expected_log_date)
  loop
    select count(*)
    into matching_rows
    from public.media_logs l
    where l.log_id = target.log_id
      and l.media_type = target.media_type
      and l.media_id = target.media_id
      and l.action_type = target.action_type
      and l.log_date = target.expected_log_date
      and l.season_label is null
      and l.season_year is null;

    if matching_rows <> 1 then
      raise exception 'Legacy reconciliation stopped: expected one unchanged bogus log %, found %',
        target.log_id, matching_rows;
    end if;

    if exists (
      select 1
      from public.media_logs l
      join public.media_library m on m.user_id = l.user_id
      where l.log_id = target.log_id
        and m.type = target.media_type
        and (
          (target.media_type = 'manga' and m.id = target.media_id)
          or (target.media_type = 'vn' and m.id = target.media_id)
        )
    ) then
      raise exception 'Legacy reconciliation stopped: bogus log % now has a deterministic parent', target.log_id;
    end if;

    delete from public.media_logs l
    where l.log_id = target.log_id
      and l.media_type = target.media_type
      and l.media_id = target.media_id
      and l.action_type = target.action_type
      and l.log_date = target.expected_log_date
      and l.season_label is null
      and l.season_year is null
      and not exists (
        select 1
        from public.media_library m
        where m.user_id = l.user_id
          and m.type = target.media_type
          and m.id = target.media_id
      );
    get diagnostics affected_rows = row_count;

    if affected_rows <> 1 then
      raise exception 'Legacy reconciliation stopped: bogus-log delete drift for %', target.log_id;
    end if;
    deleted_logs := deleted_logs + affected_rows;
  end loop;

  if deleted_logs <> 2 then
    raise exception 'Legacy reconciliation stopped: expected 2 deleted logs, deleted %', deleted_logs;
  end if;

  if (select count(*) from public.media_library) <> media_rows_before then
    raise exception 'Legacy reconciliation stopped: media row accounting changed unexpectedly';
  end if;

  if (select count(*) from public.media_logs) <> log_rows_before - 2 then
    raise exception 'Legacy reconciliation stopped: log row accounting changed unexpectedly';
  end if;

  if exists (
    select 1 from public.media_library
    where status = 'completed' and "dateCompleted" is null
  ) then
    raise exception 'Legacy reconciliation stopped: completion blockers remain after correction';
  end if;

  with
  library_keys as (
    select
      user_id,
      case type
        when 'movies' then 'tmdb'
        when 'tv' then 'tmdb'
        when 'games' then 'igdb'
        when 'anime' then 'anilist'
        when 'manga' then 'anilist'
        when 'vn' then 'vndb'
        when 'books' then 'openlibrary'
        when 'comics' then 'metron'
      end || ':' || type || ':' ||
      case type
        when 'games' then regexp_replace(id, '^igdb_', '', 'i')
        when 'books' then regexp_replace(id, '^/works/', '', 'i')
        else id
      end as media_key
    from public.media_library
  ),
  log_keys as (
    select
      l.user_id,
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
      end as media_key
    from public.media_logs l
  )
  select count(*)
  into orphan_blockers
  from log_keys l
  left join library_keys m on m.user_id = l.user_id and m.media_key = l.media_key
  where m.media_key is null;

  if orphan_blockers <> 0 then
    raise exception 'Legacy reconciliation stopped: % orphan logs remain after approved deletion', orphan_blockers;
  end if;
end
$reconcile_legacy_blockers$;
