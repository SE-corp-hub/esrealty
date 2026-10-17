\set ON_ERROR_STOP 1
-- PMS v2 row rules (pms_v2_tables.sql, pms_v2_receipts.sql): owners and
-- tenants read only their own records; nobody else reads any.
-- Runs inside one transaction and rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when others then return 'refused: ' || sqlerrm; end $$;
create or replace function pg_temp.changed(q text) returns int language plpgsql as $$
declare n int; begin execute q; get diagnostics n = row_count; return n; exception when others then return -1; end $$;
create or replace function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', case when uid = '' then '{"role":"anon"}' else json_build_object('sub', uid, 'role', 'authenticated')::text end, true); $$;
grant execute on all functions in schema pg_temp to anon, authenticated;
create temp table results(name text, ok boolean, detail text);
grant all on results to anon, authenticated;
insert into storage.objects (bucket_id, name) values
  ('pms-receipts', '00000000-0000-0000-0000-000000000000/pay-1/a.jpg'),
  ('pms-receipts', '00000000-0000-0000-0000-000000000000/pay-2/b.jpg'),
  ('pms-receipts', 'payments/pay-1/old.jpg');

set local role authenticated;
select pg_temp.as_user('55555555-5555-5555-5555-555555555555');  -- owner of o-1 / p-1
insert into results select 'owner: sees only their property and what belongs to it',
  (select string_agg(id, ',' order by id) from pms_properties) = 'p-1'
  and (select string_agg(id, ',' order by id) from pms_units) = 'u-1'
  and (select string_agg(id, ',' order by id) from pms_leases) = 'l-1'
  and (select string_agg(id, ',' order by id) from pms_payments) = 'pay-1'
  and (select string_agg(id, ',' order by id) from pms_maintenance) = 'm-1'
  and (select string_agg(id, ',' order by id) from pms_expenses) = 'e-1'
  and (select string_agg(id, ',' order by id) from pms_documents) = 'd-1',
  (select string_agg(id, ',') from pms_properties) || ' / ' || coalesce((select string_agg(id, ',') from pms_payments), '');
insert into results select 'owner: reads no tenant rows directly', (select count(*) from pms_tenants) = 0, '';
insert into results select 'owner: tenant names come without income or notes',
  (select bool_and(not (x ? 'monthly_income') and not (x ? 'notes')) from jsonb_array_elements(public.pms_owner_tenants()) x)
  and jsonb_array_length(public.pms_owner_tenants()) >= 1, public.pms_owner_tenants()::text;
insert into results select 'owner: cannot change or add records',
  pg_temp.changed($q$update public.pms_properties set data = '{}' where id = 'p-1'$q$) = 0
  and pg_temp.fails($q$insert into public.pms_payments (id, data) values ('hack', '{}')$q$) like 'refused%', '';
insert into results select 'owner: opens only their property''s receipts',
  (select string_agg(name, ',' order by name) from storage.objects where bucket_id = 'pms-receipts')
  = '00000000-0000-0000-0000-000000000000/pay-1/a.jpg,payments/pay-1/old.jpg', (select string_agg(name, ',') from storage.objects);

select pg_temp.as_user('66666666-6666-6666-6666-666666666666');  -- tenant t-1 on l-1
insert into results select 'tenant: sees their lease, payment, unit and property',
  (select string_agg(id, ',') from pms_leases) = 'l-1' and (select string_agg(id, ',') from pms_payments) = 'pay-1'
  and (select string_agg(id, ',') from pms_units) = 'u-1' and (select string_agg(id, ',') from pms_properties) = 'p-1'
  and (select string_agg(id, ',') from pms_tenants) = 't-1', '';
insert into results select 'tenant: no repairs, expenses or documents', (select count(*) from pms_maintenance) + (select count(*) from pms_expenses) + (select count(*) from pms_documents) = 0, '';
insert into results select 'tenant: landlord without bank details',
  (select bool_and(not (x ? 'bank') and not (x ? 'account_number')) from jsonb_array_elements(public.pms_tenant_landlords()) x)
  and jsonb_array_length(public.pms_tenant_landlords()) = 1, public.pms_tenant_landlords()::text;
insert into results select 'tenant: cannot upload receipts', pg_temp.fails($q$insert into storage.objects (bucket_id, name) values ('pms-receipts', '00000000-0000-0000-0000-000000000000/pay-1/x.jpg')$q$) like 'refused%', '';

select pg_temp.as_user('88888888-8888-8888-8888-888888888888');  -- tenant t-2 on l-2
insert into results select 'other tenant: sees only their own lease and receipt',
  (select string_agg(id, ',') from pms_leases) = 'l-2'
  and (select string_agg(name, ',') from storage.objects where bucket_id = 'pms-receipts') = '00000000-0000-0000-0000-000000000000/pay-2/b.jpg', '';

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');  -- buyer, no PMS link
insert into results select 'unlinked buyer: sees nothing', (select count(*) from pms_properties) + (select count(*) from pms_payments) + (select count(*) from storage.objects where bucket_id = 'pms-receipts') = 0, '';

select pg_temp.as_user('77777777-7777-7777-7777-777777777777');  -- super-admin
insert into results select 'super-admin: sees and manages the company book',
  (select count(*) from pms_payments) = 2 and pg_temp.changed($q$update public.pms_payments set data = data || '{"note":"x"}' where id = 'pay-1'$q$) = 1, '';
insert into results select 'super-admin: the old shared record is read-only', pg_temp.changed($q$update public.pms_workspaces set payload = '{}'$q$) <= 0, '';
reset role;

set local role anon;
select pg_temp.as_user('');
insert into results select 'visitor: no access to PMS tables at all', pg_temp.fails($q$select count(*) from public.pms_properties$q$) like 'refused: permission denied%' and pg_temp.fails($q$select count(*) from public.pms_payments$q$) like 'refused: permission denied%', pg_temp.fails($q$select count(*) from public.pms_properties$q$);
reset role;
select (case when ok then 'PASS ' else 'FAIL ' end) || name || case when ok then '' else '  ' || coalesce(detail, '') end from results;
select (select count(*) filter (where ok) from results) || '/' || (select count(*) from results) || ' passed';
rollback;
