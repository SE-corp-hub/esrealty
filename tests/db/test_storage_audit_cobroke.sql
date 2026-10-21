\set ON_ERROR_STOP 1
-- Storage rules, more of the change log, one open co-broke per listing and partner (supabase/migrations/0006). Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when insufficient_privilege then return 'refused'; when others then return 'error: ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(uid text, em text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', em)::text, true); $$;
create or replace function pg_temp.nobody() returns void language sql as $$
  select set_config('request.jwt.claims', '', true); $$;
create or replace function pg_temp.ev(t text, e text) returns int language sql as $$
  select count(*)::int from public.audit_events where event_type = t and entity_id = e; $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
create temp table results(name text, ok boolean, detail text);
grant all on results to authenticated, anon;

-- ===== Storage (B9) =====
insert into results select 'listing photos: 3 MB limit, image types only',
  (select file_size_limit = 3145728 and allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/avif'] from storage.buckets where id = 'listing-photos'), '';
insert into results select 'private documents: 3 MB limit, types left open',
  (select file_size_limit = 3145728 and allowed_mime_types is null from storage.buckets where id = 'private-documents'), '';
insert into results select 'receipts: PDF accepted, 5 MB limit kept',
  (select 'application/pdf' = any(allowed_mime_types) and file_size_limit = 5242880 from storage.buckets where id = 'pms-receipts'), '';
insert into results select 'the public "list everything" rule is gone',
  (select count(*) from pg_policies where schemaname = 'storage' and policyname = 'listing photos public read') = 0, '';

insert into storage.objects (bucket_id, name) values
  ('listing-photos', '11111111-1111-1111-1111-111111111111/a.jpg'),
  ('listing-photos', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/b.jpg'),
  ('private-documents', '11111111-1111-1111-1111-111111111111/vault/doc-1__id.pdf');

set local role anon;
select pg_temp.nobody();
insert into results select 'visitor: cannot list listing photos', (select count(*) from storage.objects where bucket_id = 'listing-photos') = 0, '';
reset role;
set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
insert into results select 'agent: sees their own photo only', (select string_agg(name, ',') from storage.objects where bucket_id = 'listing-photos') = '11111111-1111-1111-1111-111111111111/a.jpg', '';
insert into results select 'agent: still sees their own document', (select count(*) from storage.objects where bucket_id = 'private-documents') = 1, '';
insert into results select 'agent: cannot delete another person''s photo',
  pg_temp.fails($q$delete from storage.objects where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/b.jpg'$q$) = 'ran'
  and (select count(*) from storage.objects where bucket_id = 'listing-photos') = 1, '';
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'buyer@x.ph');
insert into results select 'buyer: sees no one else''s photos or documents', (select count(*) from storage.objects) = 0, '';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into results select 'super-admin: sees every photo', (select count(*) from storage.objects where bucket_id = 'listing-photos') = 2, '';
insert into results select 'super-admin: can read private documents (data requests)', (select count(*) from storage.objects where bucket_id = 'private-documents') = 1, '';
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
with d as (delete from storage.objects where name = '11111111-1111-1111-1111-111111111111/a.jpg' returning 1)
insert into results select 'agent: can still delete their own photo', (select count(*) from d) = 1, '';
reset role;
select pg_temp.nobody();

-- ===== Deals (B6) =====
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
insert into public.broker_transactions (id, title, payload, broker_id, created_by)
  values ('tx-a1', 'Deal', '{"stage":"reservation","price":"5000000"}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');
insert into results select 'deal opened is logged with stage and price', pg_temp.ev('deal_created', 'tx-a1') = 1
  and (select detail ->> 'stage' = 'reservation' and detail ->> 'price' = '5000000' and owner_id = '11111111-1111-1111-1111-111111111111' from public.audit_events where event_type = 'deal_created' and entity_id = 'tx-a1'), '';
update public.broker_transactions set payload = payload || '{"stage":"cts"}' where id = 'tx-a1';
insert into results select 'stage change is logged from and to', (select detail ->> 'from' = 'reservation' and detail ->> 'to' = 'cts' from public.audit_events where event_type = 'deal_stage' and entity_id = 'tx-a1'), '';
update public.broker_transactions set title = 'Renamed' where id = 'tx-a1';
insert into results select 'a rename is not a stage change', pg_temp.ev('deal_stage', 'tx-a1') = 1, '';
delete from public.broker_transactions where id = 'tx-a1';
insert into results select 'deal deleted is logged', pg_temp.ev('deal_deleted', 'tx-a1') = 1, '';
select pg_temp.nobody();
insert into public.broker_transactions (id, title, payload, broker_id, created_by)
  values ('tx-a2', 'Server deal', '{"stage":"reservation"}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');
insert into results select 'server changes (nobody signed in) are not logged', pg_temp.ev('deal_created', 'tx-a2') = 0, '';

-- ===== Property management payments (B6) =====
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
update public.pms_payments set data = data || '{"notes":"called"}' where id = 'pay-1';
insert into results select 'a note on a payment is not logged', pg_temp.ev('pms_payment_changed', 'pay-1') = 0, '';
update public.pms_payments set data = data || '{"amount": 12345, "status": "paid"}' where id = 'pay-1';
insert into results select 'amount or status change is logged', pg_temp.ev('pms_payment_changed', 'pay-1') = 1
  and (select detail ->> 'to_amount' = '12345' and detail ->> 'to_status' = 'paid' from public.audit_events where event_type = 'pms_payment_changed' and entity_id = 'pay-1'), '';
update public.pms_payments set archived = true where id = 'pay-1';
insert into results select 'archiving a payment is logged as archived', (select count(*) from public.audit_events where event_type = 'pms_payment_changed' and entity_id = 'pay-1' and detail ->> 'to_status' = 'archived') = 1, '';
insert into public.pms_payments (id, data, lease_id, property_id, tenant_id, book_id)
  values ('pay-a9', '{"id":"pay-a9","amount":500,"status":"submitted","month":"Nov 2026"}', 'l-1', 'p-1', 't-1', '00000000-0000-0000-0000-000000000000');
insert into results select 'a new payment is logged', (select detail ->> 'amount' = '500' and detail ->> 'status' = 'submitted' from public.audit_events where event_type = 'pms_payment_added' and entity_id = 'pay-a9'), '';
select pg_temp.nobody();

-- ===== Co-broke (J6) =====
insert into public.shared_listings (id, owner_id, title) values ('lst-cb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Co-broke House');
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'brokera@x.ph');
insert into public.cobroke_agreements (id, listing_id, listing_broker_id, partner_email)
  values ('c0000000-0000-0000-0000-000000000001', 'lst-cb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Partner@P.ph');
insert into results select 'co-broke proposal is logged without the email',
  (select count(*) from public.audit_events where event_type = 'cobroke_proposed' and entity_id = 'c0000000-0000-0000-0000-000000000001' and detail::text not ilike '%partner@%') = 1, '';
insert into results select 'a second open proposal to the same partner is refused',
  pg_temp.fails($q$insert into public.cobroke_agreements (listing_id, listing_broker_id, partner_email) values ('lst-cb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'partner@p.ph')$q$) like 'error: duplicate key%', '';
insert into results select 'another partner on the same listing is fine',
  pg_temp.fails($q$insert into public.cobroke_agreements (listing_id, listing_broker_id, partner_email) values ('lst-cb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'other@p.ph')$q$) = 'ran', '';
update public.cobroke_agreements set status = 'declined' where id = 'c0000000-0000-0000-0000-000000000001';
insert into results select 'decision is logged from and to',
  (select detail ->> 'from' = 'proposed' and detail ->> 'to' = 'declined' from public.audit_events where event_type = 'cobroke_status' and entity_id = 'c0000000-0000-0000-0000-000000000001'), '';
insert into results select 'after a decline the partner can be asked again',
  pg_temp.fails($q$insert into public.cobroke_agreements (listing_id, listing_broker_id, partner_email) values ('lst-cb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'partner@p.ph')$q$) = 'ran', '';
select pg_temp.nobody();

-- Live data with duplicates: the index is skipped (warning), nothing is changed, and a re-run after cleaning creates it.
drop index public.cobroke_one_open_idx;
insert into public.cobroke_agreements (listing_id, listing_broker_id, partner_email, status) values
  ('lst-cb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dup@p.ph', 'proposed'),
  ('lst-cb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'DUP@p.ph', 'accepted');
\o /dev/null
\i supabase/migrations/0006_storage_rules_more_audit_cobroke.sql
\o
insert into results select 'with duplicates the file still runs and skips the index',
  (select count(*) from pg_indexes where indexname = 'cobroke_one_open_idx') = 0
  and (select count(*) from public.cobroke_agreements where lower(partner_email) = 'dup@p.ph') = 2, '';
update public.cobroke_agreements set status = 'cancelled' where partner_email = 'dup@p.ph';
\o /dev/null
\i supabase/migrations/0006_storage_rules_more_audit_cobroke.sql
\o
insert into results select 'after cleaning, running it again creates the index', (select count(*) from pg_indexes where indexname = 'cobroke_one_open_idx') = 1, '';

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
