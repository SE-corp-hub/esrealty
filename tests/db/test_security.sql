\set ON_ERROR_STOP 1
-- Phase 1 security, items 3-13 (phase1_security_rest.sql).
-- Runs inside one transaction and rolls back, so it leaves the test data as it was.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when others then return 'refused: ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', case when uid = '' then '{"role":"anon"}' else json_build_object('sub', uid, 'role', 'authenticated')::text end, true); $$;
grant execute on all functions in schema pg_temp to anon, authenticated;
create temp table results(name text, ok boolean, detail text);
grant all on results to anon, authenticated;
insert into storage.buckets (id, name, public) values ('listing-photos','listing-photos',true) on conflict do nothing;

set local role anon;
select pg_temp.as_user('');
insert into results select 'visitor: cannot add compliance records', pg_temp.fails($q$insert into public.compliance_records (id, type, name) values ('c-x','prc','x')$q$) like 'refused%', '';
insert into results select 'visitor: cannot add password reset rows directly', pg_temp.fails($q$insert into public.password_resets (user_id, email, status) values ('22222222-2222-2222-2222-222222222222','buyer@x.ph','pending')$q$) like 'refused%', '';
insert into results select 'visitor: forgot-password still works', pg_temp.fails($q$select public.admin_request_password_reset('buyer@x.ph')$q$) = 'ran', '';
insert into results select 'visitor: cannot schedule compliance renewals', pg_temp.fails($q$select public.compliance_schedule_renewals(60)$q$) like 'refused%', '';
insert into results select 'visitor: no write rights on tables', pg_temp.fails($q$insert into public.crm_leads (id, name) values ('x','x')$q$) like 'refused: permission denied%', pg_temp.fails($q$insert into public.crm_leads (id, name) values ('x','x')$q$);
reset role;

set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');  -- approved agent
insert into results select 'approved user: adds their own compliance record', pg_temp.fails($q$insert into public.compliance_records (id, type, name) values ('c-1','prc','Mine')$q$) = 'ran', pg_temp.fails($q$select 1$q$);
insert into results select 'approved user: cannot add one for someone else', pg_temp.fails($q$insert into public.compliance_records (id, type, name, owner) values ('c-2','prc','Theirs','22222222-2222-2222-2222-222222222222')$q$) like 'refused%', '';
insert into results select 'approved user: cannot write audit rows', pg_temp.fails($q$insert into public.audit_events (owner_id, event_type, entity_type) values ('11111111-1111-1111-1111-111111111111','x','x')$q$) like 'refused%', '';
insert into results select 'approved publisher: can upload a listing photo', pg_temp.fails($q$insert into storage.objects (bucket_id, name) values ('listing-photos', '11111111-1111-1111-1111-111111111111/a.jpg')$q$) = 'ran', '';
insert into results select 'approved agent: cannot schedule compliance renewals', pg_temp.fails($q$select public.compliance_schedule_renewals(60)$q$) like 'refused%', '';
insert into results select 'signed-in user: cannot truncate tables', pg_temp.fails($q$truncate public.crm_leads$q$) like 'refused: permission denied%', '';
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');  -- pending account
insert into results select 'pending account: cannot add compliance records', pg_temp.fails($q$insert into public.compliance_records (id, type, name) values ('c-3','prc','x')$q$) like 'refused%', '';
insert into results select 'pending account: can still fill in PRC while waiting for approval', pg_temp.fails($q$update public.profiles set prc = '7777' where id = '33333333-3333-3333-3333-333333333333'$q$) = 'ran', '';
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');  -- approved buyer
insert into results select 'buyer: cannot upload into the public photo bucket', pg_temp.fails($q$insert into storage.objects (bucket_id, name) values ('listing-photos', '22222222-2222-2222-2222-222222222222/b.jpg')$q$) like 'refused%', '';
reset role;
select set_config('request.jwt.claims', '', true);
update public.profiles set prc = '1234', resa = 'R-1' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set local role authenticated;
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');  -- approved broker
insert into results select 'approved broker: cannot change their verified PRC', pg_temp.fails($q$update public.profiles set prc = '9999' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$) like 'refused%verified%', '';
insert into results select 'approved broker: can still change their name and phone', pg_temp.fails($q$update public.profiles set full_name = 'Broker Alpha Jr', phone = '0917' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$) = 'ran', '';
insert into results select 'approved broker: can schedule compliance renewals', pg_temp.fails($q$select public.compliance_schedule_renewals(60)$q$) = 'ran', '';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');  -- super-admin
insert into results select 'super-admin: can upload a listing photo', pg_temp.fails($q$insert into storage.objects (bucket_id, name) values ('listing-photos', '77777777-7777-7777-7777-777777777777/s.jpg')$q$) = 'ran', '';
reset role;
select set_config('request.jwt.claims', '', true);
insert into results select 'SQL editor / service role can still correct a PRC', pg_temp.fails($q$update public.profiles set prc = '5555' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$) = 'ran', '';
insert into results select 'forgot-password created its request', (select count(*) from public.password_resets where email = 'buyer@x.ph' and status = 'pending') >= 1, '';
select (case when ok then 'PASS ' else 'FAIL ' end) || name || case when ok then '' else '  ' || coalesce(detail, '') end from results;
select (select count(*) filter (where ok) from results) || '/' || (select count(*) from results) || ' passed';
rollback;
