\set ON_ERROR_STOP 1
-- Broker access, change log, ledger lock, site settings, stale-listing alerts (supabase/migrations/0005). Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create extension if not exists pgcrypto with schema extensions;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when insufficient_privilege then return 'refused'; when others then return 'error: ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(uid text, em text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', em)::text, true); $$;
create or replace function pg_temp.nobody() returns void language sql as $$
  select set_config('request.jwt.claims', '', true); $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
create temp table results(name text, ok boolean, detail text);
grant all on results to authenticated, anon;

-- ===== Broker team access follows the broker's current role (C4) =====
update public.profiles set broker = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' where id = '11111111-1111-1111-1111-111111111111';
insert into public.crm_leads (id, name, created_by) values ('lead-t1', 'Team Lead', '11111111-1111-1111-1111-111111111111');
set local role authenticated;
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'brokera@x.ph');
insert into results select 'approved broker: sees their agent''s lead', (select count(*) from public.crm_leads where id = 'lead-t1') = 1, '';
insert into results select 'approved broker: can list the team', (select count(*) from public.broker_team()) = 1, '';
select pg_temp.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'brokerb@x.ph');
insert into results select 'another broker: does not see it', (select count(*) from public.crm_leads where id = 'lead-t1') = 0, '';
reset role;

-- Demoted: the agent still points at the old broker, who is now a buyer.
update public.profiles set role = 'buyer' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set local role authenticated;
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'brokera@x.ph');
insert into results select 'demoted broker: no longer sees the team''s lead', (select count(*) from public.crm_leads where id = 'lead-t1') = 0, '';
insert into results select 'demoted broker: cannot list the team', pg_temp.fails($q$select * from public.broker_team()$q$) like 'error: Broker access required%', '';
reset role;
update public.profiles set role = 'broker' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Still pending: same.
update public.profiles set registration_status = 'pending' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set local role authenticated;
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'brokera@x.ph');
insert into results select 'unapproved broker: no team access', (select count(*) from public.crm_leads where id = 'lead-t1') = 0
  and pg_temp.fails($q$select * from public.broker_team()$q$) like 'error: Broker access required%', '';
reset role;
update public.profiles set registration_status = 'approved' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set local role authenticated;
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'brokera@x.ph');
insert into results select 'restored broker: access is back', (select count(*) from public.crm_leads where id = 'lead-t1') = 1, '';
reset role;

-- Creating a login names a supervising broker.
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into results select 'new login: supervisor must exist and be approved (buyer id refused)',
  pg_temp.fails($q$select public.admin_create_account('n1@x.ph', 'Passw0rd!x', 'N One', 'agent', null, null, null, '22222222-2222-2222-2222-222222222222')$q$) like 'error: Supervising broker not found or not approved%', '';
insert into results select 'new login: a pending broker cannot supervise',
  pg_temp.fails($q$select public.admin_create_account('n2@x.ph', 'Passw0rd!x', 'N Two', 'agent', null, null, null, 'cccccccc-cccc-cccc-cccc-cccccccccccc')$q$) like 'error: Supervising broker not found or not approved%', '';
insert into results select 'new login: an unknown id is refused',
  pg_temp.fails($q$select public.admin_create_account('n3@x.ph', 'Passw0rd!x', 'N Three', 'agent', null, null, null, '99999999-9999-9999-9999-999999999999')$q$) like 'error: Supervising broker not found or not approved%', '';
insert into results select 'new login: an approved broker can supervise',
  pg_temp.fails($q$select public.admin_create_account('n4@x.ph', 'Passw0rd!x', 'N Four', 'agent', null, null, null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$q$) = 'ran', '';
insert into results select 'new login: the profile points at that broker',
  (select broker from public.profiles where email = 'n4@x.ph' or id = (select id from auth.users where email = 'n4@x.ph')) = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '';
insert into results select 'new login: making it did not log a role change',
  (select count(*) from public.audit_events where event_type = 'role_changed' and entity_id = (select id::text from auth.users where email = 'n4@x.ph')) = 0, '';
select pg_temp.nobody();

-- ===== Indexes (D12) =====
insert into results select '25 new indexes exist',
  (select count(*) from pg_indexes where schemaname = 'public' and indexname in (
     'profiles_broker_idx', 'audit_events_owner_idx', 'cash_entries_approved_by_idx', 'cash_entries_created_by_idx',
     'cash_entries_linked_construction_idx', 'cash_entries_linked_phase_idx', 'cash_entries_linked_presell_project_idx',
     'cash_entries_reversal_of_idx', 'compliance_records_owner_idx', 'construction_change_orders_created_by_idx',
     'construction_invoices_created_by_idx', 'construction_invoices_ledger_entry_idx', 'construction_invoices_phase_idx',
     'construction_invoices_vendor_idx', 'construction_projects_created_by_idx', 'construction_projects_presell_project_idx',
     'construction_vendors_created_by_idx', 'password_resets_user_idx', 'portfolio_accounts_created_by_idx',
     'portfolio_proofs_uploaded_by_idx', 'presell_projects_created_by_idx', 'sales_playbooks_created_by_idx',
     'saved_listings_listing_idx', 'storefront_inquiries_user_idx', 'site_settings_updated_by_idx')) = 25, '';
insert into results select 'every single-column foreign key now has an index',
  (select count(*) from pg_constraint c
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
       and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])) = 0, '';

-- ===== Change log (B6) =====
delete from public.audit_events;
set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
-- leads
insert into public.crm_leads (id, name, payload, created_by) values ('lead-a1', 'Audit Lead', '{"status":"new","source":"manual"}', '11111111-1111-1111-1111-111111111111');
insert into results select 'logged: lead created', (select count(*) from public.audit_events where event_type = 'lead_created' and entity_id = 'lead-a1' and owner_id = '11111111-1111-1111-1111-111111111111') = 1, '';
update public.crm_leads set payload = '{"status":"contacted","source":"manual"}' where id = 'lead-a1';
insert into results select 'logged: lead status, with old and new', (select count(*) from public.audit_events where event_type = 'lead_status' and entity_id = 'lead-a1' and detail ->> 'from' = 'new' and detail ->> 'to' = 'contacted') = 1, '';
update public.crm_leads set assigned_to_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' where id = 'lead-a1';
insert into results select 'logged: lead assigned', (select count(*) from public.audit_events where event_type = 'lead_assigned' and entity_id = 'lead-a1' and detail ->> 'to' = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 1, '';
update public.crm_leads set name = 'Renamed Lead' where id = 'lead-a1';
insert into results select 'not logged: a plain edit', (select count(*) from public.audit_events where entity_id = 'lead-a1') = 3, (select count(*) from public.audit_events where entity_id = 'lead-a1')::text;
delete from public.crm_leads where id = 'lead-a1';
insert into results select 'logged: lead deleted', (select count(*) from public.audit_events where event_type = 'lead_deleted' and entity_id = 'lead-a1') = 1, '';
-- who can read the log
insert into results select 'agent: reads their own entries', (select count(*) from public.audit_events) = 4, (select count(*) from public.audit_events)::text;
insert into results select 'agent: cannot write the log directly',
  pg_temp.fails($q$insert into public.audit_events (owner_id, event_type, entity_type) values ('11111111-1111-1111-1111-111111111111', 'fake', 'x')$q$) = 'refused', '';
update public.audit_events set event_type = 'tampered' where owner_id = '11111111-1111-1111-1111-111111111111';
insert into results select 'agent: cannot change a log entry', (select count(*) from public.audit_events where event_type = 'tampered') = 0, '';
delete from public.audit_events where owner_id = '11111111-1111-1111-1111-111111111111';
insert into results select 'agent: cannot delete a log entry', (select count(*) from public.audit_events) = 4, '';
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'buyer@x.ph');
insert into results select 'buyer: sees none of it', (select count(*) from public.audit_events) = 0, '';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into results select 'super-admin: sees everyone''s entries', (select count(distinct owner_id) from public.audit_events) >= 1
  and (select count(*) from public.audit_events where owner_id = '11111111-1111-1111-1111-111111111111') = 4, '';
-- accounts: a role change keeps the old role
select public.admin_set_profile_access('22222222-2222-2222-2222-222222222222', 'agent', 'approved');
insert into results select 'logged: role change keeps the old role', (select count(*) from public.audit_events where event_type = 'role_changed' and entity_id = '22222222-2222-2222-2222-222222222222' and detail ->> 'from' = 'buyer' and detail ->> 'to' = 'agent' and owner_id = '77777777-7777-7777-7777-777777777777') = 1, '';
select public.admin_set_profile_access('22222222-2222-2222-2222-222222222222', 'agent', 'approved');
insert into results select 'not logged again when the role stays the same', (select count(*) from public.audit_events where event_type = 'role_changed' and entity_id = '22222222-2222-2222-2222-222222222222') = 1, '';
reset role;
-- a change with nobody signed in (server code, SQL editor) is saved but not logged
select pg_temp.nobody();
insert into public.crm_leads (id, name, payload, created_by) values ('lead-a2', 'Server Lead', '{}', '11111111-1111-1111-1111-111111111111');
insert into results select 'server change: saved, not logged', (select count(*) from public.crm_leads where id = 'lead-a2') = 1
  and (select count(*) from public.audit_events where entity_id = 'lead-a2') = 0, '';

-- ===== Ledger lock (B7) =====
select pg_temp.nobody();
insert into public.portfolio_accounts (id, owner_id, label) values ('a0a0a0a0-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'Main');
set local role authenticated;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into public.cash_entries (id, owner_id, account_id, direction, amount, purpose, status, idempotency_key, description)
  values ('e0e0e0e0-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'a0a0a0a0-0000-0000-0000-000000000001', 'in', 1000, '', 'posted', 'k1', 'Deposit');
insert into results select 'logged: cash entry posted', (select count(*) from public.audit_events where event_type = 'cash_posted' and entity_id = 'e0e0e0e0-0000-0000-0000-000000000001' and (detail ->> 'amount')::numeric = 1000) = 1, '';
insert into results select 'posted entry: description can still be corrected',
  pg_temp.fails($q$update public.cash_entries set description = 'Deposit (fixed)' where id = 'e0e0e0e0-0000-0000-0000-000000000001'$q$) = 'ran', '';
insert into results select 'posted entry: a proof can still be attached',
  pg_temp.fails($q$update public.cash_entries set proof_required = true where id = 'e0e0e0e0-0000-0000-0000-000000000001'$q$) = 'ran', '';
insert into results select 'posted entry: the app''s save with unchanged figures goes through',
  pg_temp.fails($q$insert into public.cash_entries (id, owner_id, account_id, direction, amount, purpose, status, idempotency_key, description, entry_date)
    select id, owner_id, account_id, direction, amount, purpose, status, idempotency_key, 'again', entry_date from public.cash_entries where id = 'e0e0e0e0-0000-0000-0000-000000000001'
    on conflict (id) do update set amount = excluded.amount, direction = excluded.direction, purpose = excluded.purpose, status = excluded.status, description = excluded.description, entry_date = excluded.entry_date$q$) = 'ran', '';
insert into results select 'posted entry: amount cannot change',
  pg_temp.fails($q$update public.cash_entries set amount = 1 where id = 'e0e0e0e0-0000-0000-0000-000000000001'$q$) like 'error: A posted ledger entry cannot be changed%', '';
insert into results select 'posted entry: direction cannot change',
  pg_temp.fails($q$update public.cash_entries set direction = 'out' where id = 'e0e0e0e0-0000-0000-0000-000000000001'$q$) like 'error: A posted ledger entry cannot be changed%', '';
insert into results select 'posted entry: date cannot change',
  pg_temp.fails($q$update public.cash_entries set entry_date = entry_date - 30 where id = 'e0e0e0e0-0000-0000-0000-000000000001'$q$) like 'error: A posted ledger entry cannot be changed%', '';
insert into results select 'posted entry: cannot be voided (it must be reversed)',
  pg_temp.fails($q$update public.cash_entries set status = 'voided' where id = 'e0e0e0e0-0000-0000-0000-000000000001'$q$) like 'error: A posted ledger entry cannot be changed%', '';
insert into results select 'posted entry: cannot be moved to someone else',
  pg_temp.fails($q$update public.cash_entries set owner_id = '11111111-1111-1111-1111-111111111111' where id = 'e0e0e0e0-0000-0000-0000-000000000001'$q$) like 'error: A posted ledger entry cannot be changed%', '';
insert into results select 'posted entry: cannot be deleted',
  pg_temp.fails($q$delete from public.cash_entries where id = 'e0e0e0e0-0000-0000-0000-000000000001'$q$) like 'error: A posted ledger entry cannot be deleted%', '';
-- a reversal is a new posted entry that points back
insert into public.cash_entries (id, owner_id, account_id, direction, amount, purpose, status, idempotency_key, reversal_of)
  values ('e0e0e0e0-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777', 'a0a0a0a0-0000-0000-0000-000000000001', 'out', 1000, '', 'posted', 'k2', 'e0e0e0e0-0000-0000-0000-000000000001');
insert into results select 'reversal: saves, and is logged with what it reverses', (select count(*) from public.audit_events where event_type = 'cash_posted' and entity_id = 'e0e0e0e0-0000-0000-0000-000000000002' and detail ->> 'reversal_of' = 'e0e0e0e0-0000-0000-0000-000000000001') = 1, '';
-- drafts and voided entries are still editable and deletable
insert into public.cash_entries (id, owner_id, account_id, direction, amount, purpose, status, idempotency_key)
  values ('e0e0e0e0-0000-0000-0000-000000000003', '77777777-7777-7777-7777-777777777777', 'a0a0a0a0-0000-0000-0000-000000000001', 'out', 50, '', 'draft', 'k3');
insert into results select 'draft: amount can change', pg_temp.fails($q$update public.cash_entries set amount = 75 where id = 'e0e0e0e0-0000-0000-0000-000000000003'$q$) = 'ran', '';
insert into results select 'draft: can be posted', pg_temp.fails($q$update public.cash_entries set status = 'posted' where id = 'e0e0e0e0-0000-0000-0000-000000000003'$q$) = 'ran', '';
insert into results select 'logged: draft posted', (select count(*) from public.audit_events where event_type = 'cash_posted' and entity_id = 'e0e0e0e0-0000-0000-0000-000000000003') = 1, '';
insert into public.cash_entries (id, owner_id, account_id, direction, amount, purpose, status, idempotency_key)
  values ('e0e0e0e0-0000-0000-0000-000000000004', '77777777-7777-7777-7777-777777777777', 'a0a0a0a0-0000-0000-0000-000000000001', 'out', 20, '', 'voided', 'k4');
insert into results select 'voided: can be deleted (purge)', pg_temp.fails($q$delete from public.cash_entries where id = 'e0e0e0e0-0000-0000-0000-000000000004'$q$) = 'ran', '';
insert into results select 'logged: purge', (select count(*) from public.audit_events where event_type = 'cash_deleted' and entity_id = 'e0e0e0e0-0000-0000-0000-000000000004') = 1, '';
reset role;
-- the SQL editor is not locked out
select pg_temp.nobody();
insert into results select 'SQL editor: can still correct a posted entry',
  pg_temp.fails($q$update public.cash_entries set amount = 1000 where id = 'e0e0e0e0-0000-0000-0000-000000000001'$q$) = 'ran', '';
-- removing an account removes its entries, posted or not
set local role authenticated;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into results select 'removing the account is allowed', pg_temp.fails($q$delete from public.portfolio_accounts where id = 'a0a0a0a0-0000-0000-0000-000000000001'$q$) = 'ran', '';
insert into results select '... and takes its posted entries with it', (select count(*) from public.cash_entries where account_id = 'a0a0a0a0-0000-0000-0000-000000000001') = 0, '';
reset role;
select pg_temp.nobody();

-- ===== Site settings (K1) =====
insert into public.site_settings (key, value, is_public) values ('siteContact', '{"phone":"0917 000 0000"}', true), ('internalNote', '{"x":1}', false);
set local role anon;
insert into results select 'visitor: reads public settings only', (select count(*) from public.site_settings) = 1 and (select count(*) from public.site_settings where key = 'siteContact') = 1, '';
insert into results select 'visitor: cannot write', pg_temp.fails($q$insert into public.site_settings (key, value) values ('hack', '{}')$q$) = 'refused', '';
reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
insert into results select 'agent: reads public settings only', (select count(*) from public.site_settings) = 1, '';
insert into results select 'agent: cannot write', pg_temp.fails($q$insert into public.site_settings (key, value) values ('hack', '{}')$q$) = 'refused', '';
update public.site_settings set value = '{"phone":"0"}' where key = 'siteContact';
insert into results select 'agent: cannot change a setting', (select value ->> 'phone' from public.site_settings where key = 'siteContact') = '0917 000 0000', '';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into results select 'super-admin: reads private settings too', (select count(*) from public.site_settings) = 2, '';
insert into public.site_settings (key, value, is_public) values ('valueGuide', '{"version":"2026.10"}', true);
insert into results select 'super-admin: saves a setting and is recorded as the editor', (select updated_by from public.site_settings where key = 'valueGuide') = '77777777-7777-7777-7777-777777777777', '';
reset role;
-- a second super-admin edits it: no longer tied to one person's blob
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin2@x.ph', '{}', now());
update public.profiles set role = 'super-admin', registration_status = 'approved' where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
set local role authenticated;
select pg_temp.as_user('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin2@x.ph');
update public.site_settings set value = '{"version":"2026.11"}' where key = 'valueGuide';
insert into results select 'a second super-admin''s edit is saved', (select value ->> 'version' from public.site_settings where key = 'valueGuide') = '2026.11'
  and (select updated_by from public.site_settings where key = 'valueGuide') = 'dddddddd-dddd-dddd-dddd-dddddddddddd', '';
insert into results select 'a setting must be an object', pg_temp.fails($q$insert into public.site_settings (key, value) values ('bad1', '[1,2]')$q$) like 'error: new row for relation "site_settings" violates check constraint%', '';
insert into results select 'a setting key must be a plain name', pg_temp.fails($q$insert into public.site_settings (key, value) values ('has space', '{}')$q$) like 'error: new row for relation "site_settings" violates check constraint%', '';
reset role;
select pg_temp.nobody();

-- ===== Stale-listing alerts (A6) =====
delete from public.notifications;
delete from public.shared_listings;
insert into public.shared_listings (id, owner_id, title, payload, is_published, status, created_at) values
  ('lst-s1', '11111111-1111-1111-1111-111111111111', 'Old House', json_build_object('updatedAt', to_char(now() - interval '80 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::jsonb, true, 'available', now() - interval '200 days'),
  ('lst-s2', '11111111-1111-1111-1111-111111111111', 'Fresh House', json_build_object('updatedAt', to_char(now() - interval '10 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::jsonb, true, 'available', now() - interval '200 days'),
  ('lst-s3', '11111111-1111-1111-1111-111111111111', 'Draft House', '{}', false, 'available', now() - interval '200 days'),
  ('lst-s4', '11111111-1111-1111-1111-111111111111', 'Sold House', '{}', true, 'sold', now() - interval '200 days'),
  ('lst-s5', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'No Date House', '{"updatedAt": "soon"}', true, 'rfo', now() - interval '100 days'),
  ('lst-s6', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bad Date House', '{"updatedAt": "2026-13-45"}', true, 'available', now() - interval '5 days');
create temp table sweep1 as select * from public.listing_stale_sweep(75, true);
insert into results select 'dry run: lists the stale ones', (select count(*) from sweep1) = 2 and (select count(*) from sweep1 where listing_id in ('lst-s1', 'lst-s5') and not alerted) = 2, (select count(*) from sweep1)::text;
insert into results select '... and tells no one', (select count(*) from public.notifications) = 0, '';
insert into results select 'a bad or missing date falls back to when it was created, never an error',
  (select idle_days from sweep1 where listing_id = 'lst-s5') >= 99 and (select count(*) from sweep1 where listing_id = 'lst-s6') = 0, '';
create temp table sweep2 as select * from public.listing_stale_sweep(75, false);
insert into results select 'real run: reports both', (select count(*) from sweep2 where alerted) = 2, (select count(*) from sweep2)::text;
insert into results select '... each owner is told once per stale listing',
  (select count(*) from public.notifications where user_id = '11111111-1111-1111-1111-111111111111' and title = 'Still available? Old House') = 1
  and (select count(*) from public.notifications where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and title = 'Still available? No Date House') = 1, '';
create temp table sweep3 as select * from public.listing_stale_sweep(75, false);
insert into results select 'second run the same day: no repeat', (select count(*) from sweep3) = 0 and (select count(*) from public.notifications) = 2, '';
update public.notifications set created_at = now() - interval '15 days';
create temp table sweep4 as select * from public.listing_stale_sweep(75, false);
insert into results select 'after two weeks it reminds again', (select count(*) from sweep4) = 2, '';
insert into results select 'unpublished and sold listings are never touched',
  (select count(*) from public.notifications where title in ('Still available? Draft House', 'Still available? Sold House')) = 0, '';
insert into results select 'nothing was unpublished', (select count(*) from public.shared_listings where is_published) = 5, (select count(*) from public.shared_listings where is_published)::text;
insert into results select 'a zero-day limit is refused', pg_temp.fails($q$select * from public.listing_stale_sweep(0, true)$q$) like 'error: p_alert_days must be at least 1%', '';
set local role authenticated;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into results select 'not callable from the app, even by a super-admin', pg_temp.fails($q$select * from public.listing_stale_sweep(75, true)$q$) = 'refused', '';
reset role;
set local role anon;
insert into results select 'not callable by visitors', pg_temp.fails($q$select * from public.listing_stale_sweep(75, true)$q$) = 'refused', '';
reset role;

-- ===== Web-form lead idempotency key (location-report double tap) =====
insert into public.crm_leads (id, name, payload, created_by) values ('lead-k1', 'Web 1', '{"idempotencyKey":"key-1"}', '11111111-1111-1111-1111-111111111111');
insert into results select 'the same web-form key twice: the second is refused (23505)',
  pg_temp.fails($q$insert into public.crm_leads (id, name, payload, created_by) values ('lead-k2', 'Web 2', '{"idempotencyKey":"key-1"}', '11111111-1111-1111-1111-111111111111')$q$) like 'error: duplicate key value%', pg_temp.fails($q$insert into public.crm_leads (id, name, payload, created_by) values ('lead-k2b', 'Web 2', '{"idempotencyKey":"key-1"}', '11111111-1111-1111-1111-111111111111')$q$);
insert into public.crm_leads (id, name, payload, created_by) values ('lead-k3', 'Web 3', '{"idempotencyKey":"key-2"}', '11111111-1111-1111-1111-111111111111');
insert into results select 'a different key is fine', (select count(*) from public.crm_leads where id in ('lead-k1', 'lead-k3')) = 2, '';
insert into public.crm_leads (id, name, payload, created_by) values
  ('lead-k4', 'App 1', '{}', '11111111-1111-1111-1111-111111111111'),
  ('lead-k5', 'App 2', '{}', '11111111-1111-1111-1111-111111111111'),
  ('lead-k6', 'App 3', '{"idempotencyKey":""}', '11111111-1111-1111-1111-111111111111'),
  ('lead-k7', 'App 4', '{"idempotencyKey":""}', '11111111-1111-1111-1111-111111111111'),
  ('lead-k8', 'App 5', '{"status":"new"}', '11111111-1111-1111-1111-111111111111');
insert into results select 'leads made in the app (no key, or an empty key) can repeat', (select count(*) from public.crm_leads where id between 'lead-k4' and 'lead-k8') = 5, '';

-- ===== Removed functions (N6) =====
insert into results select 'unused functions are gone',
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('agent_cancel', 'my_full_name')) = 0, '';

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
