\set ON_ERROR_STOP 1
-- Find a person: export and erase (supabase/migrations/0013). Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.as_user(uid text, em text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', em)::text, true); $$;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when insufficient_privilege then return 'refused'; when others then return 'error: ' || sqlerrm; end $$;
create temp table results(name text, ok boolean, detail text);
create temp table f(source text, record_id text, name text, email text, phone text, created_at timestamptz, note text);
create temp table e(what text, rows_found integer, deleted boolean);
grant all on results, f, e to authenticated, anon;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- The same person in several places, written differently; and someone else.
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('fp-l1', 'L-1', 'Carmen Diaz', '{"phone":"0917 222 3333","email":"carmen@x.ph","status":"contacted"}', '77777777-7777-7777-7777-777777777777'),
  ('fp-l2', 'L-2', 'C. Diaz', '{"phone":"+63 917 222 3333"}', '77777777-7777-7777-7777-777777777777'),
  ('fp-l3', 'L-3', 'Other Person', '{"phone":"0918 999 0000","email":"other@x.ph"}', '77777777-7777-7777-7777-777777777777');
insert into public.shared_listings (id, owner_id, title) values ('fp-lst', '11111111-1111-1111-1111-111111111111', 'Test House');
insert into public.listing_inquiries (listing_id, full_name, email, phone, consent_at) values ('fp-lst', 'Carmen Diaz', 'CARMEN@x.ph', '09172223333', now());
insert into public.storefront_inquiries (full_name, email, phone) values ('Carmen', '', '917-222-3333');
insert into public.pms_tenants (id, data, book_id) values ('fp-t1', '{"name":"Carmen Diaz","phone":"0917 222 3333","email":"carmen@x.ph"}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
set local role authenticated;
insert into f select * from public.admin_person_find('0917-222-3333');
reset role;
insert into results select 'by phone: every place this person appears',
  (select string_agg(source, ',' order by source) from f) = 'PMS tenant,lead,lead,listing inquiry,website inquiry', (select string_agg(source, ',' order by source) from f);
insert into results select 'someone else is not included', not exists (select 1 from f where record_id = 'fp-l3'), '';
delete from f;
set local role authenticated;
insert into f select * from public.admin_person_find('Carmen@X.ph ');
reset role;
insert into results select 'by email, in any case', (select count(*) from f) = 3, (select string_agg(source, ',') from f);
delete from f;
set local role authenticated;
insert into f select * from public.admin_person_find('diaz');
reset role;
insert into results select 'by part of a name', (select count(*) from f where name ilike '%diaz%') >= 3 and not exists (select 1 from f where record_id = 'fp-l3'), '';
set local role authenticated;
insert into results select 'too short to search', pg_temp.fails($q$select * from public.admin_person_find('ab')$q$) like 'error: Enter a phone number%', '';
reset role;

-- Export: full records, phone or email only, logged without personal data.
create temp table x(v jsonb); grant all on x to authenticated;
set local role authenticated;
insert into x select public.admin_person_export('09172223333');
insert into results select 'export by name alone is refused', pg_temp.fails($q$select public.admin_person_export('Carmen')$q$) like 'error: Export needs a phone number or an email%', '';
reset role;
insert into results select 'the export has their leads, inquiries and PMS record',
  (select jsonb_array_length(v -> 'records' -> 'leads') = 2 and jsonb_array_length(v -> 'records' -> 'listing_inquiries') = 1 and jsonb_array_length(v -> 'records' -> 'website_inquiries') = 1 and jsonb_array_length(v -> 'records' -> 'pms_tenants') = 1 from x), (select v::text from x);
insert into results select 'internal ids of staff are left out of the export', (select not (v -> 'records' -> 'leads' -> 0 ? 'created_by') from x), '';
insert into results select 'the export is in the change log, with no personal data', (select count(*) from public.audit_events where event_type = 'person_exported' and detail::text not ilike '%carmen%' and detail::text not like '%0917%') = 1, '';

-- Erase: dry run first, then for real; PMS records stay.
set local role authenticated;
insert into e select * from public.admin_person_erase('carmen@x.ph', true);
reset role;
insert into results select 'a dry run only counts', (select sum(rows_found) from e) = 2 and (select bool_and(not deleted) from e) and (select count(*) from public.crm_leads where id = 'fp-l1') = 1, (select string_agg(what || ':' || rows_found, ',') from e);
delete from e;
set local role authenticated;
insert into e select * from public.admin_person_erase('0917 222 3333', false);
insert into results select 'erase by name alone is refused', pg_temp.fails($q$select * from public.admin_person_erase('Carmen Diaz', false)$q$) like 'error: Erase needs%', '';
reset role;
insert into results select 'erase deletes their leads and inquiries', (select count(*) from public.crm_leads where id in ('fp-l1', 'fp-l2')) = 0
  and (select count(*) from public.listing_inquiries where phone = '09172223333') = 0 and (select count(*) from public.storefront_inquiries where full_name = 'Carmen') = 0, (select string_agg(what || ':' || rows_found, ',') from e);
insert into results select 'someone else is untouched', (select count(*) from public.crm_leads where id = 'fp-l3') = 1, '';
insert into results select 'Property Management records are kept', (select count(*) from public.pms_tenants where id = 'fp-t1') = 1, '';
insert into results select 'the erase is in the change log, with no personal data', (select count(*) from public.audit_events where event_type = 'person_erased' and detail::text not ilike '%carmen%' and detail::text not like '%0917%') = 1, '';

-- Only a Super Admin.
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'brokera@x.ph');
set local role authenticated;
insert into results select 'a broker cannot search', pg_temp.fails($q$select * from public.admin_person_find('0918 999 0000')$q$) = 'refused', '';
insert into results select 'or erase', pg_temp.fails($q$select * from public.admin_person_erase('0918 999 0000', false)$q$) = 'refused', '';
reset role;
set local role anon;
insert into results select 'visitors cannot either', pg_temp.fails($q$select * from public.admin_person_find('0918 999 0000')$q$) = 'refused', '';
reset role;

-- K4: last sign-in is listed.
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
set local role authenticated;
insert into x select v from public.admin_list_profiles() v limit 1;
reset role;
insert into results select 'the account list includes last sign-in', (select bool_and(v ? 'last_sign_in_at' or v ? 'records') from x), '';

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
