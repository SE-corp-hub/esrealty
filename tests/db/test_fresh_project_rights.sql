\set ON_ERROR_STOP 1
-- Fresh project rights (supabase/migrations/0020): visitors can't query the old PMS record.
-- Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create temp table results(name text, ok boolean, detail text);

-- What a new Supabase project does on its own: grant visitors everything on new tables.
grant all on public.pms_workspaces, public.pms_workspaces_backup_20261017 to anon;
grant select on public.pms_workspaces_backup_20261017 to authenticated;
\i supabase/migrations/0020_fresh_project_rights.sql
insert into results select 'visitors have no rights on the old PMS record',
  not has_table_privilege('anon', 'public.pms_workspaces', 'select,insert,update,delete'), '';
insert into results select 'nobody but the service reads its backup',
  not has_table_privilege('anon', 'public.pms_workspaces_backup_20261017', 'select')
  and not has_table_privilege('authenticated', 'public.pms_workspaces_backup_20261017', 'select'), '';
insert into results select 'signed-in users keep their rights on the record (row rules decide)',
  has_table_privilege('authenticated', 'public.pms_workspaces', 'select'), '';

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
