\set ON_ERROR_STOP 1
-- Inquiry and lead alerts, and the four access fixes (supabase/migrations/0004). Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when insufficient_privilege then return 'refused'; when others then return 'error: ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(uid text, em text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', em)::text, true); $$;
create or replace function pg_temp.seen(q text) returns text language plpgsql as $$
declare n bigint;
begin execute q into n; return n::text; exception when insufficient_privilege then return 'refused'; end $$;
create or replace function pg_temp.nobody() returns void language sql as $$
  select set_config('request.jwt.claims', '', true); $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
create temp table results(name text, ok boolean, detail text);
grant all on results to authenticated, anon;
delete from public.notifications;

-- A second super-admin, so "told every super-admin" can be told apart from "told one".
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin2@x.ph', '{}', now());
update public.profiles set role = 'super-admin', registration_status = 'approved', email = 'admin2@x.ph' where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
-- A listing owned by the agent.
insert into public.shared_listings (id, owner_id, title) values ('lst-1', '11111111-1111-1111-1111-111111111111', 'Test House');

-- ===== Inquiry alerts (A1) =====
select pg_temp.nobody();
insert into public.listing_inquiries (listing_id, user_id, full_name, phone, consent_at) values ('lst-1', null, 'Visitor Vera', '0917', now());
insert into results select 'a visitor''s inquiry tells the listing''s owner',
  (select count(*) from public.notifications where user_id = '11111111-1111-1111-1111-111111111111' and title = 'New inquiry: Test House') = 1, '';
insert into public.listing_inquiries (listing_id, user_id, full_name, phone, consent_at) values ('lst-1', '11111111-1111-1111-1111-111111111111', 'Owner Self', '0917', now());
insert into results select 'the owner inquiring on their own listing is not told',
  (select count(*) from public.notifications where user_id = '11111111-1111-1111-1111-111111111111' and title = 'New inquiry: Test House') = 1, '';
insert into public.listing_inquiries (listing_id, user_id, full_name, phone, consent_at) values ('lst-1', '22222222-2222-2222-2222-222222222222', 'Signed In Sam', '0917', now());
insert into results select 'a signed-in buyer''s inquiry tells the owner',
  (select count(*) from public.notifications where user_id = '11111111-1111-1111-1111-111111111111' and title = 'New inquiry: Test House') = 2, '';

-- ===== Lead alerts (A2) =====
delete from public.notifications;
-- A lead made from a listing inquiry, assigned to the listing's owner: told once (the inquiry alert), not twice.
insert into public.crm_leads (id, ref, name, payload, created_by, assigned_to_id)
  values ('lead-b1', 'L-B1', 'Listing Lena', '{"source":"listing","listingId":"lst-1"}', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111');
insert into results select 'a listing lead for the owner does not alert them a second time',
  (select count(*) from public.notifications where user_id = '11111111-1111-1111-1111-111111111111') = 0, '';
-- ... but a listing lead for a different agent does.
insert into public.crm_leads (id, ref, name, payload, created_by, assigned_to_id)
  values ('lead-b2', 'L-B2', 'Listing Leo', '{"source":"listing","listingId":"lst-1"}', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into results select 'a listing lead for another agent alerts that agent',
  (select count(*) from public.notifications where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and title = 'New lead for you: Listing Leo') = 1, '';
-- A website lead nobody is assigned to, saved under the super-admin's own id: every super-admin hears of it.
insert into public.crm_leads (id, ref, name, payload, created_by)
  values ('lead-b3', 'L-B3', 'Web Wendy', '{"source":"website"}', '77777777-7777-7777-7777-777777777777');
insert into results select 'a website lead tells every super-admin, including the account it is saved under',
  (select count(*) from public.notifications where title = 'New lead: Web Wendy' and user_id in ('77777777-7777-7777-7777-777777777777', 'dddddddd-dddd-dddd-dddd-dddddddddddd')) = 2, '';
-- A super-admin typing a lead in the app is not told about their own lead, the other one is.
set local role authenticated;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into public.crm_leads (id, ref, name, payload, created_by) values ('lead-b4', 'L-B4', 'Typed Tina', '{}', '77777777-7777-7777-7777-777777777777');
reset role;
insert into results select 'a lead typed in by a super-admin does not alert them',
  (select count(*) from public.notifications where title = 'New lead: Typed Tina' and user_id = '77777777-7777-7777-7777-777777777777') = 0, '';
insert into results select '... but the other super-admin is told',
  (select count(*) from public.notifications where title = 'New lead: Typed Tina' and user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd') = 1, '';

-- ===== Who may create a lead (C2) =====
select pg_temp.nobody();
set local role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'buyer@x.ph');
insert into results select 'buyer: cannot create a lead', pg_temp.fails($q$insert into public.crm_leads (id, name, created_by) values ('lead-c1', 'x', auth.uid())$q$) = 'refused', '';
select pg_temp.as_user('55555555-5555-5555-5555-555555555555', 'owner@x.ph');
insert into results select 'owner: cannot create a lead', pg_temp.fails($q$insert into public.crm_leads (id, name, created_by) values ('lead-c2', 'x', auth.uid())$q$) = 'refused', '';
select pg_temp.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc', 'brokerc@x.ph');
insert into results select 'pending broker: cannot create a lead', pg_temp.fails($q$insert into public.crm_leads (id, name, created_by) values ('lead-c3', 'x', auth.uid())$q$) = 'refused', '';
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
insert into results select 'agent: creates their own lead', pg_temp.fails($q$insert into public.crm_leads (id, name, created_by) values ('lead-c4', 'x', auth.uid())$q$) = 'ran', '';
insert into results select 'agent: cannot create a lead in someone else''s name', pg_temp.fails($q$insert into public.crm_leads (id, name, created_by) values ('lead-c5', 'x', '22222222-2222-2222-2222-222222222222')$q$) = 'refused', '';
select pg_temp.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'brokerb@x.ph');
insert into results select 'broker: creates their own lead', pg_temp.fails($q$insert into public.crm_leads (id, name, created_by) values ('lead-c6', 'x', auth.uid())$q$) = 'ran', '';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into results select 'super-admin: creates a lead', pg_temp.fails($q$insert into public.crm_leads (id, name, created_by) values ('lead-c7', 'x', auth.uid())$q$) = 'ran', '';
reset role;

-- ===== Compliance records: reading needs an approved account (C3) =====
insert into public.compliance_records (id, type, name, owner) values ('comp-1', 'prc', 'Agent licence', '11111111-1111-1111-1111-111111111111');
set local role authenticated;
select pg_temp.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'brokerb@x.ph');
insert into results select 'approved broker: reads the compliance book', (select count(*) from public.compliance_records where id = 'comp-1') = 1, '';
select pg_temp.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc', 'brokerc@x.ph');
insert into results select 'pending broker: reads nothing', (select count(*) from public.compliance_records) = 0, '';
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
insert into results select 'agent: still reads their own record', (select count(*) from public.compliance_records where id = 'comp-1') = 1, '';
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'buyer@x.ph');
insert into results select 'buyer: cannot read an agent''s record', (select count(*) from public.compliance_records where id = 'comp-1') = 0, '';
reset role;

-- ===== Pre-selling payment schedules (C1) =====
insert into public.presell_projects (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Tower One');
insert into public.presell_units (id, project_id, unit_no, status, reserved_for, reserved_by) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '1201', 'reserved', 'Buyer One', '22222222-2222-2222-2222-222222222222'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', '1202', 'reserved', 'Somebody Else', null);
insert into public.presell_payments (id, unit_id, due_date, label, amount) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', '2026-11-01', 'Reservation', 20000),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b2', '2026-11-01', 'Reservation', 20000);
set local role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'buyer@x.ph');
insert into results select 'buyer: sees the schedule of their own unit only', (select count(*) from public.presell_payments) = 1
  and (select count(*) from public.presell_payments where unit_id = '00000000-0000-0000-0000-0000000000b1') = 1, '';
insert into results select 'buyer: still browses the unit list', (select count(*) from public.presell_units) = 2, '';
select pg_temp.as_user('55555555-5555-5555-5555-555555555555', 'owner@x.ph');
insert into results select 'owner account: sees no payment schedules', (select count(*) from public.presell_payments) = 0, '';
select pg_temp.as_user('33333333-3333-3333-3333-333333333333', 'pending@x.ph');
insert into results select 'pending account: sees no payment schedules', (select count(*) from public.presell_payments) = 0, '';
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
insert into results select 'agent: sees all payment schedules', (select count(*) from public.presell_payments) = 2, '';
select pg_temp.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'brokerb@x.ph');
insert into results select 'broker: sees all payment schedules', (select count(*) from public.presell_payments) = 2, '';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into results select 'super-admin: sees all payment schedules', (select count(*) from public.presell_payments) = 2, '';
insert into results select 'super-admin: can still change a payment', pg_temp.fails($q$update public.presell_payments set status = 'paid' where id = '00000000-0000-0000-0000-0000000000c1'$q$) = 'ran', '';
reset role;
set local role anon;
select pg_temp.nobody();
insert into results select 'visitor: sees no payment schedules', pg_temp.seen('select count(*) from public.presell_payments') in ('0', 'refused'), pg_temp.seen('select count(*) from public.presell_payments');
reset role;

-- ===== The statistics counter is not for visitors (C5) =====
set local role anon;
insert into results select 'visitor: cannot call the listing counter', pg_temp.fails($q$select public.increment_shared_listing_stat('lst-1', 'views')$q$) = 'refused', '';
reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
insert into results select 'signed-in app: still cannot call it directly (the website API does)', pg_temp.fails($q$select public.increment_shared_listing_stat('lst-1', 'views')$q$) = 'refused', '';
reset role;

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
