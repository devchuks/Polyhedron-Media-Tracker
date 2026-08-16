select jsonb_build_object(
  'columns', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', table_name,
      'ordinal', ordinal_position,
      'name', column_name,
      'type', data_type,
      'udt', udt_name,
      'nullable', is_nullable,
      'default', column_default
    ) order by table_name, ordinal_position)
    from information_schema.columns
    where table_schema = 'public'
  ), '[]'::jsonb),
  'constraints', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', c.relname,
      'name', con.conname,
      'type', con.contype,
      'definition', pg_get_constraintdef(con.oid, true)
    ) order by c.relname, con.conname)
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  ), '[]'::jsonb),
  'indexes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', tablename,
      'name', indexname,
      'definition', indexdef
    ) order by tablename, indexname)
    from pg_indexes
    where schemaname = 'public'
  ), '[]'::jsonb),
  'relations', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'kind', c.relkind,
      'rls', c.relrowsecurity,
      'force_rls', c.relforcerowsecurity,
      'replica_identity', c.relreplident
    ) order by c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
  ), '[]'::jsonb),
  'policies', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', tablename,
      'name', policyname,
      'command', cmd,
      'roles', roles,
      'using', qual,
      'check', with_check
    ) order by tablename, policyname)
    from pg_policies
    where schemaname = 'public'
  ), '[]'::jsonb),
  'grants', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', table_name,
      'grantee', grantee,
      'privileges', privileges
    ) order by table_name, grantee)
    from (
      select table_name, grantee, array_agg(privilege_type order by privilege_type) as privileges
      from information_schema.role_table_grants
      where table_schema = 'public'
      group by table_name, grantee
    ) grouped_grants
  ), '[]'::jsonb),
  'functions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'arguments', pg_get_function_identity_arguments(p.oid),
      'result', pg_get_function_result(p.oid),
      'security_definer', p.prosecdef
    ) order by p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ), '[]'::jsonb),
  'publications', coalesce((
    select jsonb_agg(jsonb_build_object(
      'publication', pubname,
      'table', tablename
    ) order by pubname, tablename)
    from pg_publication_tables
    where schemaname = 'public'
  ), '[]'::jsonb),
  'triggers', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', c.relname,
      'name', t.tgname,
      'definition', pg_get_triggerdef(t.oid, true)
    ) order by c.relname, t.tgname)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and not t.tgisinternal
  ), '[]'::jsonb)
) as core_contract_snapshot;
