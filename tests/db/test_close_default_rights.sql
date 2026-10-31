\set ON_ERROR_STOP 1
-- Rights a new Supabase project hands out on its own (supabase/migrations/0021). The test database
-- gets the same defaults as a new project (00_supabase_stub.sql), so these check the live setup.
-- Rolls back.
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

set local role authenticated;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');  -- pending sign-up
insert into results select 'new sign-up: cannot make themselves Super Admin',
  pg_temp.fails($q$update public.profiles set role = 'super-admin', registration_status = 'approved' where id = auth.uid()$q$) like 'refused%', '';
insert into results select 'new sign-up: cannot approve themselves',
  pg_temp.fails($q$update public.profiles set registration_status = 'approved' where id = auth.uid()$q$) like 'refused%', '';
insert into results select 'new sign-up: still saves their name and phone',
  pg_temp.fails($q$update public.profiles set full_name = 'New Person', phone = '0917 123 4567' where id = auth.uid()$q$) = 'ran', '';
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');  -- approved agent
insert into results select 'agent: cannot pick a broker for themselves',
  pg_temp.fails($q$update public.profiles set broker = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id = auth.uid()$q$) like 'refused%', '';
insert into results select 'agent: cannot save a listing directly',
  pg_temp.fails($q$insert into public.shared_listings (id, title, owner_id, payload) values ('lst-direct', 'Direct', auth.uid(), '{}')$q$) like 'refused: permission denied%', '';
insert into results select 'agent: cannot change listings directly',
  pg_temp.fails($q$update public.shared_listings set featured = true where owner_id = auth.uid()$q$) like 'refused: permission denied%', '';
insert into results select 'signed-in user: cannot truncate tables',
  pg_temp.fails($q$truncate public.crm_leads$q$) like 'refused: permission denied%', '';
reset role;

set local role anon;
select pg_temp.as_user('');
insert into results select 'visitor: no write rights on tables',
  pg_temp.fails($q$insert into public.crm_leads (id, name) values ('x', 'x')$q$) like 'refused: permission denied%', '';
insert into results select 'visitor: cannot query the property management books',
  pg_temp.fails($q$select 1 from public.pms_payments limit 1$q$) like 'refused: permission denied%', '';
reset role;

set local role authenticated;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');  -- super-admin
insert into results select 'super-admin: still approves accounts',
  pg_temp.fails($q$select public.admin_set_profile_access('33333333-3333-3333-3333-333333333333', 'agent', 'approved')$q$) = 'ran', '';
insert into results select 'super-admin: still assigns a broker',
  pg_temp.fails($q$select public.admin_assign_broker('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$q$) = 'ran', '';
reset role;

select set_config('request.jwt.claims', '', true);
insert into results select 'SQL editor / service role: can still set a role (first Super Admin)',
  pg_temp.fails($q$update public.profiles set role = 'broker' where id = '22222222-2222-2222-2222-222222222222'$q$) = 'ran', '';
update auth.users set email = 'changed@x.ph' where id = '22222222-2222-2222-2222-222222222222';
insert into results select 'Auth: an email change still reaches the profile',
  (select email from public.profiles where id = '22222222-2222-2222-2222-222222222222') = 'changed@x.ph', '';

select (case when ok then 'PASS ' else 'FAIL ' end) || name || case when ok then '' else '  ' || coalesce(detail, '') end from results;
select (select count(*) filter (where ok) from results) || '/' || (select count(*) from results) || ' passed';
rollback;
