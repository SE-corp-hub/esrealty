-- ES Realty DIAGNOSTIC — run this whole file, then paste ALL result rows back.
-- Goal: find the one broken object that makes PostgREST fail with
-- "Database error querying schema".

-- 1) Does the app_role enum exist and where?
select 'app_role_enum' as check_name, n.nspname, t.typname
from pg_type t join pg_namespace n on n.oid = t.typnamespace
where t.typname = 'app_role';

-- 2) Every column of profiles and its resolved type
select 'profiles_column' as check_name, a.attname, format_type(a.atttypid, a.atttypmod) as col_type
from pg_attribute a
join pg_class c on c.oid = a.attrelid and c.relname = 'profiles'
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where a.attnum > 0 and not a.attisdropped
order by a.attnum;

-- 3) Every function in public (name + arguments). Look for any that look wrong.
select 'public_function' as check_name, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
order by p.proname;

-- 4) Triggers in public that call functions (a broken trigger body also breaks schema load)
select 'public_trigger' as check_name, c.relname as on_table, t.tgname, p.proname as calls_func
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal and n.nspname = 'public';

-- 5) Does PostgREST's key table (profiles) resolve as a relation?
select 'profiles_relation' as check_name, c.relname, c.relkind
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relname = 'profiles' and n.nspname = 'public';

-- 6) Check the function bodies actually parse by dumping their definitions.
--    If ANY of these throw an error, that function is the culprit.
select 'def_admin_list_profiles' as check_name, pg_get_functiondef('public.admin_list_profiles()'::regprocedure) as def;
select 'def_admin_create_account' as check_name, pg_get_functiondef(p.oid::regprocedure) as def
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'admin_create_account';
select 'def_admin_set_profile_access' as check_name, pg_get_functiondef(p.oid::regprocedure) as def
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'admin_set_profile_access';
