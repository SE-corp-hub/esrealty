\set ON_ERROR_STOP 1
-- Acknowledgement receipt numbers, and tenants sending payment proof and repair
-- requests (supabase/migrations/0001_pms_receipts_and_tenant_requests.sql).
-- Runs inside one transaction and rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when others then return 'refused'; end $$;
create or replace function pg_temp.changed(q text) returns int language plpgsql as $$
declare n int; begin execute q; get diagnostics n = row_count; return n; exception when others then return -1; end $$;
create or replace function pg_temp.as_user(uid text, em text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', em)::text, true); $$;
create or replace function pg_temp.rno(pid text) returns text language sql as $$
  select data ->> 'receipt_no' from public.pms_payments where id = pid; $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
create temp table results(name text, ok boolean, detail text);
create temp table ids(k text primary key, v text);
grant all on results, ids to authenticated, anon;

-- Receipt numbers ----------------------------------------------------------------
insert into results select 'receipts: payments already paid have numbers, in order', pg_temp.rno('pay-1') = 'AR-2026-0001' and pg_temp.rno('pay-2') = 'AR-2026-0002', pg_temp.rno('pay-1') || ' ' || pg_temp.rno('pay-2');

set local role authenticated;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777','admin@x.ph');
insert into public.pms_payments (id, data, lease_id, property_id, tenant_id) values ('pay-3', '{"amount":10000,"status":"paid","date":"2026-10-10","receipt_no":"AR-2026-9999"}', 'l-1', 'p-1', 't-1');
insert into results select 'receipts: the next payment gets the next number, whatever the phone sent', pg_temp.rno('pay-3') = 'AR-2026-0003', pg_temp.rno('pay-3');
insert into public.pms_payments (id, data, lease_id, property_id, tenant_id) values ('pay-4', '{"amount":5000,"status":"pending","date":"2026-10-11"}', 'l-1', 'p-1', 't-1');
insert into results select 'receipts: money not cleared yet gets no number', pg_temp.rno('pay-4') is null, coalesce(pg_temp.rno('pay-4'), 'none');
update public.pms_payments set data = data || '{"status":"paid"}' where id = 'pay-4';
insert into results select 'receipts: marking it paid gives it the next number', pg_temp.rno('pay-4') = 'AR-2026-0004', pg_temp.rno('pay-4');
update public.pms_payments set data = '{"amount":10000,"status":"paid","date":"2026-10-10"}' where id = 'pay-3';
insert into results select 'receipts: a save without the number keeps it', pg_temp.rno('pay-3') = 'AR-2026-0003', pg_temp.rno('pay-3');
update public.pms_payments set data = data || '{"receipt_no":"AR-2026-0100","status":"pending"}' where id = 'pay-3';
insert into results select 'receipts: a number can never be changed', pg_temp.rno('pay-3') = 'AR-2026-0003', pg_temp.rno('pay-3');
insert into public.pms_payments (id, data, lease_id, property_id, tenant_id) values ('pay-5', '{"amount":10000,"status":"paid","date":"2025-12-30"}', 'l-1', 'p-1', 't-1');
insert into results select 'receipts: each year has its own series (by payment date)', pg_temp.rno('pay-5') = 'AR-2025-0001', pg_temp.rno('pay-5');
insert into public.pms_payments (id, data, archived, lease_id, property_id, tenant_id) values ('pay-6', '{"amount":10000,"status":"paid","date":"2026-10-12"}', true, 'l-1', 'p-1', 't-1');
insert into results select 'receipts: an archived payment gets no number', pg_temp.rno('pay-6') is null, '';
insert into results select 'receipts: nobody reads or changes the counters', pg_temp.fails('select * from public.pms_receipt_counters') = 'refused' and pg_temp.fails($q$update public.pms_receipt_counters set last_no = 0$q$) = 'refused', '';

-- Broker Alpha: their own series
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','brokera@x.ph');
insert into public.pms_owners (id, data) values ('a-o1', '{"name":"Alpha Owner"}');
insert into public.pms_properties (id, data, owner_id) values ('a-p1', '{"title":"Alpha House"}', 'a-o1');
insert into public.pms_units (id, data, property_id) values ('a-u1', '{"unit_number":"A1"}', 'a-p1');
insert into public.pms_tenants (id, data, owner_id, auth_user_id) values ('a-t1', '{"name":"Alpha Tenant"}', 'a-o1', '88888888-8888-8888-8888-888888888888');
insert into public.pms_leases (id, data, property_id, unit_id, tenant_id, owner_id) values ('a-l1', '{"rent":15000}', 'a-p1', 'a-u1', 'a-t1', 'a-o1');
insert into public.pms_payments (id, data, lease_id, property_id, tenant_id) values ('a-pay1', '{"amount":15000,"status":"paid","date":"2026-10-05"}', 'a-l1', 'a-p1', 'a-t1');
insert into results select 'receipts: a broker''s book starts its own series', pg_temp.rno('a-pay1') = 'AR-2026-0001', pg_temp.rno('a-pay1');

-- Tenant One (lease l-1, company records) sends proof of a payment ----------------
select pg_temp.as_user('66666666-6666-6666-6666-666666666666','tenant@x.ph');
insert into ids select 'sent', public.pms_tenant_send_payment('l-1', 10000, (now() at time zone 'Asia/Manila')::date, '2026-11', 'GCash', 'REF 123', 'November rent') ->> 'id';
insert into results select 'tenant: can send proof of a payment for their lease', (select count(*) from public.pms_payments p join ids on ids.v = p.id and ids.k = 'sent'
  where p.data ->> 'status' = 'submitted' and p.book_id = '00000000-0000-0000-0000-000000000000' and p.data ->> 'sent_by' = '66666666-6666-6666-6666-666666666666'
    and p.data ->> 'reference' = 'REF 123' and p.data ->> 'month' = '2026-11') = 1, (select v from ids where k = 'sent');
insert into results select 'tenant: a sent payment has no receipt number yet', pg_temp.rno((select v from ids where k = 'sent')) is null, '';
insert into results select 'tenant: cannot send for someone else''s lease', pg_temp.fails($q$select public.pms_tenant_send_payment('l-2', 100, current_date, null, 'Cash', '', '')$q$) = 'refused', '';
insert into results select 'tenant: amount and date are checked', pg_temp.fails($q$select public.pms_tenant_send_payment('l-1', 0, current_date, null, 'Cash', '', '')$q$) = 'refused'
  and pg_temp.fails($q$select public.pms_tenant_send_payment('l-1', 100, current_date + 10, null, 'Cash', '', '')$q$) = 'refused', '';
insert into results select 'tenant: cannot mark their payment paid', pg_temp.changed(format($q$update public.pms_payments set data = data || '{"status":"paid"}' where id = %L$q$, (select v from ids where k = 'sent'))) = 0, '';
insert into results select 'tenant: cannot add payments directly', pg_temp.fails($q$insert into public.pms_payments (id, data, lease_id, book_id) values ('t-pay', '{"status":"paid","amount":1}', 'l-1', '00000000-0000-0000-0000-000000000000')$q$) = 'refused', '';
-- the photo
insert into results select 'tenant: can upload the photo for the payment they sent', pg_temp.fails(format($q$insert into storage.objects (bucket_id, name) values ('pms-receipts', %L)$q$, '00000000-0000-0000-0000-000000000000/' || (select v from ids where k = 'sent') || '/r.jpg')) = 'ran', '';
insert into results select 'tenant: cannot upload into a paid payment or another folder', pg_temp.fails($q$insert into storage.objects (bucket_id, name) values ('pms-receipts', '00000000-0000-0000-0000-000000000000/pay-1/x.jpg')$q$) = 'refused'
  and pg_temp.fails(format($q$insert into storage.objects (bucket_id, name) values ('pms-receipts', %L)$q$, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/' || (select v from ids where k = 'sent') || '/x.jpg')) = 'refused', '';
insert into results select 'tenant: cannot replace or delete files', pg_temp.changed($q$delete from storage.objects where bucket_id = 'pms-receipts'$q$) = 0, '';
select public.pms_tenant_attach_proof((select v from ids where k = 'sent'), '00000000-0000-0000-0000-000000000000/' || (select v from ids where k = 'sent') || '/r.jpg', 'gcash.jpg');
insert into results select 'tenant: the photo is linked to the payment', (select data ->> 'proofPath' from public.pms_payments where id = (select v from ids where k = 'sent')) like '00000000-0000-0000-0000-000000000000/%/r.jpg', '';
insert into results select 'tenant: cannot link a photo that was not uploaded', pg_temp.fails(format($q$select public.pms_tenant_attach_proof(%L, %L, 'x')$q$, (select v from ids where k = 'sent'), '00000000-0000-0000-0000-000000000000/' || (select v from ids where k = 'sent') || '/none.jpg')) = 'refused', '';
-- repair requests
insert into ids select 'repair', public.pms_tenant_request_repair('l-1', 'Leaking faucet', 'Kitchen sink drips all night', 'Plumbing') ->> 'id';
insert into results select 'tenant: can ask for a repair', (select count(*) from jsonb_array_elements(public.pms_my_repair_requests()) x where x ->> 'id' = (select v from ids where k = 'repair') and x ->> 'status' = 'open' and x ->> 'request' = 'Kitchen sink drips all night') = 1, public.pms_my_repair_requests()::text;
insert into results select 'tenant: sees no staff notes, costs or vendors', (select bool_and(not (x ? 'notes') and not (x ? 'cost') and not (x ? 'vendor')) from jsonb_array_elements(public.pms_my_repair_requests()) x), '';
insert into results select 'tenant: still cannot read work orders directly', (select count(*) from public.pms_maintenance) = 0, '';
insert into results select 'tenant: no repairs for someone else''s lease, no empty requests', pg_temp.fails($q$select public.pms_tenant_request_repair('l-2', 'Broken door', '', 'Other')$q$) = 'refused'
  and pg_temp.fails($q$select public.pms_tenant_request_repair('l-1', 'ab', '', 'Other')$q$) = 'refused', '';
insert into results select 'tenant: at most 10 payments a day', (select count(*) from generate_series(1, 9) g, lateral (select public.pms_tenant_send_payment('l-1', 100 + g, current_date, null, 'Cash', '', '')) x) = 9
  and pg_temp.fails($q$select public.pms_tenant_send_payment('l-1', 100, current_date, null, 'Cash', '', '')$q$) = 'refused', '';

-- Tenant Two can't touch Tenant One's
select pg_temp.as_user('88888888-8888-8888-8888-888888888888','tenant2@x.ph');
insert into results select 'other tenant: none of it shows', jsonb_array_length(public.pms_my_repair_requests()) = 0 and (select count(*) from public.pms_payments where lease_id = 'l-1') = 0, '';
insert into results select 'other tenant: cannot add a photo to it', pg_temp.fails(format($q$select public.pms_tenant_attach_proof(%L, 'x', 'x')$q$, (select v from ids where k = 'sent'))) = 'refused', '';
-- Tenant Two also rents from Broker Alpha: their request goes to Alpha's book
insert into ids select 'alpha', public.pms_tenant_send_payment('a-l1', 15000, current_date, null, 'Cash', '', '') ->> 'id';

-- Others can't use the tenant functions
select pg_temp.as_user('11111111-1111-1111-1111-111111111111','agent@x.ph');
insert into results select 'agent: cannot send tenant payments', pg_temp.fails($q$select public.pms_tenant_send_payment('l-1', 100, current_date, null, 'Cash', '', '')$q$) = 'refused', '';
reset role;
set local role anon;
insert into results select 'visitor: cannot call the tenant functions', pg_temp.fails($q$select public.pms_tenant_send_payment('l-1', 100, current_date, null, 'Cash', '', '')$q$) = 'refused'
  and pg_temp.fails($q$select public.pms_my_repair_requests()$q$) = 'refused', '';
reset role;

-- The managers --------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
insert into results select 'manager: the super-admin got a notice for each request', (select count(*) from public.notifications where user_id = '77777777-7777-7777-7777-777777777777' and title in ('Payment sent by a tenant', 'Repair request from a tenant') and link_view = 'pms') = 11, (select count(*)::text from public.notifications where user_id = '77777777-7777-7777-7777-777777777777');
insert into results select 'manager: Broker Alpha got the notice for their book, in their book', (select count(*) from public.notifications where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and title = 'Payment sent by a tenant') = 1
  and (select book_id from public.pms_payments where id = (select v from ids where k = 'alpha')) = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '';
set local role authenticated;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777','admin@x.ph');
insert into results select 'manager: sees the request in work orders, marked as from the tenant', (select count(*) from public.pms_maintenance where id = (select v from ids where k = 'repair') and data ->> 'source' = 'tenant' and unit_id = 'u-1') = 1, '';
update public.pms_payments set data = data || '{"status":"paid"}' where id = (select v from ids where k = 'sent');
insert into results select 'manager: confirming a sent payment gives it a receipt number', pg_temp.rno((select v from ids where k = 'sent')) = 'AR-2026-0005', coalesce(pg_temp.rno((select v from ids where k = 'sent')), 'none');
reset role;

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
