select jsonb_build_object(
  'server', jsonb_build_object(
    'version', current_setting('server_version'),
    'database', current_database()
  ),
  'extensions', coalesce((
    select jsonb_agg(jsonb_build_object('name', e.extname, 'version', e.extversion) order by e.extname)
    from pg_extension e
  ), '[]'::jsonb),
  'relations', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'name', c.relname,
      'kind', c.relkind,
      'owner', pg_get_userbyid(c.relowner),
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity,
      'replica_identity', c.relreplident
    ) order by n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'S')
  ), '[]'::jsonb),
  'columns', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', c.table_schema,
      'table', c.table_name,
      'ordinal', c.ordinal_position,
      'name', c.column_name,
      'data_type', c.data_type,
      'udt_name', c.udt_name,
      'nullable', c.is_nullable,
      'default', c.column_default,
      'identity', c.is_identity,
      'generated', c.is_generated
    ) order by c.table_schema, c.table_name, c.ordinal_position)
    from information_schema.columns c
    where c.table_schema in ('public', 'auth')
      and (
        c.table_schema = 'public'
        or c.table_name = 'users'
      )
  ), '[]'::jsonb),
  'constraints', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'table', cls.relname,
      'name', con.conname,
      'type', con.contype,
      'definition', pg_get_constraintdef(con.oid, true),
      'validated', con.convalidated,
      'deferrable', con.condeferrable,
      'deferred', con.condeferred
    ) order by n.nspname, cls.relname, con.conname)
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    where n.nspname = 'public'
  ), '[]'::jsonb),
  'indexes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', schemaname,
      'table', tablename,
      'name', indexname,
      'definition', indexdef
    ) order by schemaname, tablename, indexname)
    from pg_indexes
    where schemaname = 'public'
  ), '[]'::jsonb),
  'triggers', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'table', c.relname,
      'name', t.tgname,
      'definition', pg_get_triggerdef(t.oid, true),
      'enabled', t.tgenabled
    ) order by n.nspname, c.relname, t.tgname)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and not t.tgisinternal
  ), '[]'::jsonb),
  'policies', coalesce((
    select jsonb_agg(to_jsonb(p) order by p.schemaname, p.tablename, p.policyname)
    from pg_policies p
    where p.schemaname = 'public'
  ), '[]'::jsonb),
  'table_grants', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', g.table_schema,
      'table', g.table_name,
      'grantor', g.grantor,
      'grantee', g.grantee,
      'privilege', g.privilege_type,
      'grantable', g.is_grantable
    ) order by g.table_schema, g.table_name, g.grantee, g.privilege_type)
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
  ), '[]'::jsonb),
  'functions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'name', p.proname,
      'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'result', pg_get_function_result(p.oid),
      'security_definer', p.prosecdef,
      'volatility', p.provolatile,
      'parallel', p.proparallel,
      'definition', pg_get_functiondef(p.oid)
    ) order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ), '[]'::jsonb),
  'routine_grants', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', g.routine_schema,
      'routine', g.routine_name,
      'grantor', g.grantor,
      'grantee', g.grantee,
      'privilege', g.privilege_type,
      'grantable', g.is_grantable
    ) order by g.routine_schema, g.routine_name, g.grantee, g.privilege_type)
    from information_schema.role_routine_grants g
    where g.routine_schema = 'public'
  ), '[]'::jsonb),
  'publications', coalesce((
    select jsonb_agg(jsonb_build_object(
      'publication', p.pubname,
      'schema', pt.schemaname,
      'table', pt.tablename
    ) order by p.pubname, pt.schemaname, pt.tablename)
    from pg_publication p
    join pg_publication_tables pt on pt.pubname = p.pubname
    where pt.schemaname = 'public'
  ), '[]'::jsonb)
) as catalog_snapshot;
