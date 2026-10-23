\set ON_ERROR_STOP 1
-- Agent websites, Phase 0 (supabase/migrations/0014): reply-time stamp and name lock. Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.as_user(uid text, em text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', em)::text, true); $$;
create or replace function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '', true); $$;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when insufficient_privilege then return 'refused'; when others then return 'error: ' || sqlerrm; end $$;
create temp table results(name text, ok boolean, detail text);

-- Reply time ---------------------------------------------------------------
insert into public.crm_leads (id, ref, name, payload, created_by, assigned_to_id) values
  ('rt-1', 'L-1', 'New lead', '{"status":"new"}', '77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111'),
  ('rt-2', 'L-2', 'Typed in as contacted', '{"status":"contacted"}', '77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111'),
  ('rt-4', 'L-4', 'No status yet', '{}', '77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111');

insert into results select 'a new lead has no first contact yet',
  (select first_contacted_at is null and first_contacted_by is null from public.crm_leads where id = 'rt-1'), '';

-- A time sent by the browser on insert is ignored.
insert into public.crm_leads (id, ref, name, payload, created_by, first_contacted_at, first_contacted_by)
  values ('rt-5', 'L-5', 'Forged', '{"status":"new"}', '77777777-7777-7777-7777-777777777777', now() - interval '3 days', '11111111-1111-1111-1111-111111111111');
insert into results select 'a first-contact time sent on insert is ignored',
  (select first_contacted_at is null and first_contacted_by is null from public.crm_leads where id = 'rt-5'), '';

-- A note without a status change does not count.
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
update public.crm_leads set payload = payload || '{"notes":"left a message"}' where id = 'rt-1';
insert into results select 'a note alone does not stamp first contact',
  (select first_contacted_at is null from public.crm_leads where id = 'rt-1'), '';

-- Moving out of New stamps the time and the person, once.
update public.crm_leads set payload = payload || '{"status":"contacted"}' where id = 'rt-1';
insert into results select 'moving out of New stamps the time and who did it',
  (select first_contacted_at is not null and first_contacted_at > now() - interval '1 minute'
      and first_contacted_by = '11111111-1111-1111-1111-111111111111' from public.crm_leads where id = 'rt-1'), '';
create temp table stamp as select first_contacted_at as t from public.crm_leads where id = 'rt-1';

select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
update public.crm_leads set payload = payload || '{"status":"new"}' where id = 'rt-1';
update public.crm_leads set payload = payload || '{"status":"qualified"}' where id = 'rt-1';
insert into results select 'later status changes keep the first stamp',
  (select l.first_contacted_at = s.t and l.first_contacted_by = '11111111-1111-1111-1111-111111111111' from public.crm_leads l, stamp s where l.id = 'rt-1'), '';

update public.crm_leads set first_contacted_at = now() - interval '30 days', first_contacted_by = null where id = 'rt-1';
insert into results select 'the stamp cannot be rewritten or cleared',
  (select l.first_contacted_at = s.t and l.first_contacted_by is not null from public.crm_leads l, stamp s where l.id = 'rt-1'), '';

-- The app saves leads with an upsert; that path stamps too.
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('rt-6', 'L-6', 'Saved by upsert', '{"status":"new"}', '77777777-7777-7777-7777-777777777777');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('rt-6', 'L-6', 'Saved by upsert', '{"status":"contacted"}', '77777777-7777-7777-7777-777777777777')
  on conflict (id) do update set payload = excluded.payload;
insert into results select 'the app''s upsert stamps first contact',
  (select first_contacted_at is not null and first_contacted_by = '11111111-1111-1111-1111-111111111111' from public.crm_leads where id = 'rt-6'), '';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');

-- A lead typed in already past New is never measured.
update public.crm_leads set payload = payload || '{"status":"viewing"}' where id = 'rt-2';
insert into results select 'a lead created past New is not measured',
  (select first_contacted_at is null from public.crm_leads where id = 'rt-2'), '';

-- No status counts as New; the background jobs (no user) still stamp the time.
select pg_temp.as_service();
update public.crm_leads set payload = payload || '{"status":"contacted"}' where id = 'rt-4';
insert into results select 'a lead with no status counts as New; a job without a user stamps the time only',
  (select first_contacted_at is not null and first_contacted_by is null from public.crm_leads where id = 'rt-4'), '';

-- Name lock -----------------------------------------------------------------
update public.profiles set full_name = 'Maria Santos' where id = '11111111-1111-1111-1111-111111111111';

select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
insert into results select 'an approved agent cannot change their own name',
  pg_temp.fails($q$update public.profiles set full_name = 'Jose Ramirez' where id = '11111111-1111-1111-1111-111111111111'$q$) = 'refused', '';
insert into results select 'saving the same name again still works',
  pg_temp.fails($q$update public.profiles set full_name = 'Maria Santos', phone = '0917 123 4567' where id = '11111111-1111-1111-1111-111111111111'$q$) = 'ran', '';

select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'brokera@x.ph');
insert into results select 'an approved broker cannot change their own name',
  pg_temp.fails($q$update public.profiles set full_name = 'Someone Else' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$) = 'refused', '';

select pg_temp.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc', 'brokerc@x.ph');
insert into results select 'a broker still waiting for approval can fix their name',
  pg_temp.fails($q$update public.profiles set full_name = 'Broker Corrected' where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$q$) = 'ran', '';

select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'buyer@x.ph');
insert into results select 'a buyer can change their own name',
  pg_temp.fails($q$update public.profiles set full_name = 'Buyer Name' where id = '22222222-2222-2222-2222-222222222222'$q$) = 'ran', '';

select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into results select 'a super-admin can correct an agent''s name',
  pg_temp.fails($q$update public.profiles set full_name = 'Maria L. Santos' where id = '11111111-1111-1111-1111-111111111111'$q$) = 'ran', '';

select pg_temp.as_service();
insert into results select 'the service role (no user) can change a name',
  pg_temp.fails($q$update public.profiles set full_name = 'Maria Santos' where id = '11111111-1111-1111-1111-111111111111'$q$) = 'ran', '';

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
