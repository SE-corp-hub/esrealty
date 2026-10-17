\set ON_ERROR_STOP 1
-- PMS books: brokers and super-admins each manage their own records (pms_v3_books.sql).
-- Runs inside one transaction and rolls back, so it leaves the test data as it was.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when others then return 'refused'; end $$;
create or replace function pg_temp.changed(q text) returns int language plpgsql as $$
declare n int; begin execute q; get diagnostics n = row_count; return n; exception when others then return -1; end $$;
create or replace function pg_temp.as_user(uid text, em text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', em)::text, true); $$;
grant execute on all functions in schema pg_temp to authenticated;
create temp table results(name text, ok boolean, detail text);
grant all on results to authenticated;

set local role authenticated;
-- Broker Alpha builds a rental in their own book
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','brokera@x.ph');
insert into public.pms_owners (id, data, auth_user_id) values ('a-o1', '{"name":"Alpha Owner","bank":"BPI","account_number":"999"}', '55555555-5555-5555-5555-555555555555');
insert into public.pms_properties (id, data, owner_id, book_id) values ('a-p1', '{"title":"Alpha House"}', 'a-o1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into public.pms_units (id, data, property_id) values ('a-u1', '{"unit_number":"A1"}', 'a-p1');
insert into public.pms_tenants (id, data, owner_id, auth_user_id) values ('a-t1', '{"name":"Alpha Tenant","monthly_income":70000}', 'a-o1', '88888888-8888-8888-8888-888888888888');
insert into public.pms_leases (id, data, property_id, unit_id, tenant_id, owner_id) values ('a-l1', '{"rent":15000}', 'a-p1', 'a-u1', 'a-t1', 'a-o1');
insert into public.pms_payments (id, data, lease_id, property_id, tenant_id) values ('a-pay1', '{"amount":15000,"status":"paid"}', 'a-l1', 'a-p1', 'a-t1');
insert into results select 'broker: rows land in their own book', (select count(*) = 6 from (select book_id from pms_owners where id='a-o1' union all select book_id from pms_properties where id='a-p1' union all select book_id from pms_units where id='a-u1' union all select book_id from pms_tenants where id='a-t1' union all select book_id from pms_leases where id='a-l1' union all select book_id from pms_payments where id='a-pay1') x where book_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '';
insert into results select 'broker: sees only their own book', (select count(*) from pms_properties) = 1 and (select count(*) from pms_payments) = 1, (select string_agg(id, ',') from pms_properties);
insert into results select 'broker: cannot write into the company book', pg_temp.fails($q$insert into public.pms_properties (id, data, book_id) values ('a-px', '{}', '00000000-0000-0000-0000-000000000000')$q$) = 'refused', '';
insert into results select 'broker: cannot link to a company record', pg_temp.fails($q$insert into public.pms_leases (id, data, property_id, tenant_id) values ('a-lx', '{}', 'a-p1', 't-1')$q$) = 'refused', '';
insert into results select 'broker: cannot move a record to another book', pg_temp.fails($q$update public.pms_properties set book_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id = 'a-p1'$q$) = 'refused', '';
insert into results select 'broker: cannot change company rows', pg_temp.changed($q$update public.pms_properties set data = '{"title":"hacked"}' where id = 'p-1'$q$) = 0, '';
insert into results select 'broker: login status covers their own people', (select jsonb_array_length(public.pms_login_status())) = 2, public.pms_login_status()::text;
insert into results select 'broker: finds an existing owner login by email', (public.pms_find_login('OWNER@x.ph', 'owner') ->> 'id') = '55555555-5555-5555-5555-555555555555', public.pms_find_login('owner@x.ph','owner')::text;
insert into results select 'broker: an email with another kind of account is flagged', (public.pms_find_login('agent@x.ph', 'tenant') ->> 'other_role') = 'true', '';
insert into results select 'broker: cannot look up agent logins', pg_temp.fails($q$select public.pms_find_login('agent@x.ph', 'agent')$q$) = 'refused', '';
insert into results select 'broker: cannot list books or move them', pg_temp.fails($q$select public.pms_books()$q$) = 'refused' and pg_temp.fails($q$select public.pms_transfer_book('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$q$) = 'refused', '';
-- receipts
insert into results select 'broker: can save a receipt in their own folder', pg_temp.fails($q$insert into storage.objects (bucket_id, name) values ('pms-receipts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a-pay1/r.jpg')$q$) = 'ran', '';
insert into results select 'broker: cannot save into the company folder', pg_temp.fails($q$insert into storage.objects (bucket_id, name) values ('pms-receipts', '00000000-0000-0000-0000-000000000000/pay-1/x.jpg')$q$) = 'refused' and pg_temp.fails($q$insert into storage.objects (bucket_id, name) values ('pms-receipts', 'payments/pay-1/x.jpg')$q$) = 'refused', '';

-- Broker Beta sees nothing of Alpha's
select pg_temp.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','brokerb@x.ph');
insert into results select 'other broker: sees none of it', (select count(*) from pms_properties) + (select count(*) from pms_tenants) + (select count(*) from pms_payments) = 0, '';
insert into results select 'other broker: cannot open the receipt', (select count(*) from storage.objects where bucket_id = 'pms-receipts') = 0, '';
insert into results select 'other broker: cannot change it', pg_temp.changed($q$update public.pms_properties set data = '{}' where id = 'a-p1'$q$) = 0, '';
-- pending broker and agent
select pg_temp.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc','brokerc@x.ph');
insert into results select 'pending broker: no book', pg_temp.fails($q$insert into public.pms_properties (id, data) values ('c-p1', '{}')$q$) = 'refused' and (select count(*) from pms_properties) = 0, '';
select pg_temp.as_user('11111111-1111-1111-1111-111111111111','agent@x.ph');
insert into results select 'agent: no PMS at all', pg_temp.fails($q$insert into public.pms_properties (id, data) values ('g-p1', '{}')$q$) = 'refused' and (select count(*) from pms_properties) = 0, '';

-- Owner 5555 is listed in the company book and in Alpha's book
select pg_temp.as_user('55555555-5555-5555-5555-555555555555','owner@x.ph');
insert into results select 'owner: sees their properties from both books', (select string_agg(id, ',' order by id) from pms_properties) = 'a-p1,p-1', (select string_agg(id, ',' order by id) from pms_properties);
insert into results select 'owner: tenant names but no income', (select bool_and(not (x ? 'monthly_income')) from jsonb_array_elements(public.pms_owner_tenants()) x), '';
-- Tenant 8888 (tenant2) rents from Alpha
select pg_temp.as_user('88888888-8888-8888-8888-888888888888','tenant2@x.ph');
insert into results select 'tenant: sees their Alpha lease and payment', (select count(*) from pms_leases where id='a-l1') = 1 and (select count(*) from pms_payments where id='a-pay1') = 1, '';
insert into results select 'tenant: can open their receipt', (select count(*) from storage.objects where name like 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a-pay1/%') = 1, '';

-- Super-admin: company book to manage, broker books to read
select pg_temp.as_user('77777777-7777-7777-7777-777777777777','admin@x.ph');
insert into results select 'super-admin: reads every book', (select count(*) from pms_properties) = 3, (select string_agg(id || ':' || left(book_id::text, 4), ',' order by id) from pms_properties);
insert into results select 'super-admin: cannot change a broker book', pg_temp.changed($q$update public.pms_properties set data = '{}' where id = 'a-p1'$q$) = 0, '';
insert into results select 'super-admin: cannot add to a broker book', pg_temp.fails($q$insert into public.pms_properties (id, data, book_id) values ('s-p1', '{}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$q$) = 'refused', '';
insert into results select 'super-admin: still manages the company book', pg_temp.changed($q$update public.pms_properties set data = data || '{"note":"x"}' where id = 'p-1'$q$) = 1, '';
select pg_temp.fails($q$insert into public.pms_expenses (id, data, property_id) values ('s-e1', '{"amount":1}', 'p-1')$q$);
insert into results select 'super-admin: new rows default to the company book', (select book_id::text from pms_expenses where id = 's-e1') = '00000000-0000-0000-0000-000000000000', '';
insert into results select 'super-admin: can open a broker receipt', (select count(*) from storage.objects where name like 'aaaaaaaa%') = 1, '';
insert into results select 'super-admin: book list', (select string_agg(x ->> 'name', ',' order by (x ->> 'company') desc, x ->> 'name') from jsonb_array_elements(public.pms_books()) x) = 'Company,Broker Alpha', public.pms_books()::text;
insert into results select 'super-admin: cannot move a book to a pending broker', pg_temp.fails($q$select public.pms_transfer_book('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc')$q$) = 'refused', '';
insert into results select 'super-admin: moves Alpha''s book to Beta', (public.pms_transfer_book('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') ->> 'pms_payments') = '1', '';
select pg_temp.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','brokerb@x.ph');
insert into results select 'after the move: Beta has the records', (select count(*) from pms_properties) = 1 and (select count(*) from pms_leases) = 1, '';
insert into results select 'after the move: Beta can replace the old receipt', pg_temp.fails($q$delete from storage.objects where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a-pay1/r.jpg'$q$) = 'ran', '';
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','brokera@x.ph');
insert into results select 'after the move: Alpha has none', (select count(*) from pms_properties) = 0, '';
reset role;
insert into results select 'the move is logged', (select count(*) from audit_events where event_type = 'pms_transfer_book' and created_at = now()) = 1, '';
insert into results select 'email lookups are logged', (select count(*) from audit_events where event_type = 'pms_find_login' and created_at = now()) >= 2, '';
select (case when ok then 'PASS ' else 'FAIL ' end) || name || case when ok then '' else '  ' || coalesce(detail, '') end from results;
select (select count(*) filter (where ok) from results) || '/' || (select count(*) from results) || ' passed';
rollback;
