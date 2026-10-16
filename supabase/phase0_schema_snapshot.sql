-- SEA ESTATES · Phase 0 live schema snapshot (read-only, changes nothing)
-- Run in Supabase dashboard → SQL Editor → Run, then use the result's
-- "Export" (or "Download CSV") button and attach the file to the chat.
-- One row per table, view, policy, function, trigger, enum, grant and bucket.
select * from (
  select 'table'::text as kind, c.relname::text as name,
         jsonb_build_object(
           'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
           'columns', (select jsonb_agg(jsonb_build_object(
                          'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
                          'not_null', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid))
                        order by a.attnum)
                       from pg_attribute a
                       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                       where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
           'constraints', (select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname)
                           from pg_constraint k where k.conrelid = c.oid)) as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  union all
  select 'view', c.relname::text,
         jsonb_build_object('definition', pg_get_viewdef(c.oid, true), 'options', to_jsonb(c.reloptions))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
  union all
  select 'policy', (schemaname || '.' || tablename || ' :: ' || policyname)::text,
         jsonb_build_object('cmd', cmd, 'roles', to_jsonb(roles), 'using', qual, 'check', with_check, 'permissive', permissive)
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'function', (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text,
         jsonb_build_object('security_definer', p.prosecdef, 'acl', p.proacl::text, 'definition', pg_get_functiondef(p.oid))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')
  union all
  select 'trigger', (c.relname || ' :: ' || t.tgname)::text,
         jsonb_build_object('definition', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
  union all
  select 'enum', t.typname::text, to_jsonb(array_agg(e.enumlabel::text order by e.enumsortorder))
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' group by t.typname
  union all
  select 'grant', (g.table_name || ' :: ' || g.grantee)::text, to_jsonb(array_agg(g.privilege_type::text order by g.privilege_type))
  from information_schema.role_table_grants g
  where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')
  group by g.table_name, g.grantee
  union all
  select 'bucket', b.id::text, jsonb_build_object('public', b.public)
  from storage.buckets b
) s
order by kind, name;
