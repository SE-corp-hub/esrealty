\set ON_ERROR_STOP 1
-- Staff announcements (supabase/migrations/0007). Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when insufficient_privilege then return 'refused'; when others then return 'error: ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(uid text, em text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', em)::text, true); $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
create temp table results(name text, ok boolean, detail text);
grant all on results to authenticated, anon;
create temp table got(n int);
grant all on got to authenticated;

set local role authenticated;
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'brokera@x.ph');
insert into results select 'a broker cannot send announcements',
  pg_temp.fails($q$select public.admin_announce('Hi', 'x', array['agent'])$q$) like 'error: Super Admin access required%', '';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into results select 'a title is required', pg_temp.fails($q$select public.admin_announce('  ', 'x', array['agent'])$q$) like 'error: Title must be%', '';
insert into results select 'someone must receive it', pg_temp.fails($q$select public.admin_announce('Hi', 'x', array[]::text[])$q$) like 'error: Choose who%', '';
insert into results select 'an unknown role is refused', pg_temp.fails($q$select public.admin_announce('Hi', 'x', array['agent','hacker'])$q$) like 'error: Choose who%', '';
insert into got select public.admin_announce('Office closed Friday', 'Holiday. Leads still come to the app.', array['broker', 'agent']);
reset role;
insert into results select 'approved brokers and agents get it, pending ones do not, the sender gets a copy',
  (select string_agg(user_id::text, ',' order by user_id) from public.notifications where title = 'Announcement: Office closed Friday')
  = '11111111-1111-1111-1111-111111111111,77777777-7777-7777-7777-777777777777,aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  (select string_agg(user_id::text, ',' order by user_id) from public.notifications where title = 'Announcement: Office closed Friday');
insert into results select 'the function returns the count', (select n from got) = 4, (select n::text from got);
insert into results select 'buyers and tenants were not chosen and got nothing',
  (select count(*) from public.notifications where title like 'Announcement:%' and user_id in ('22222222-2222-2222-2222-222222222222', '66666666-6666-6666-6666-666666666666')) = 0, '';
insert into results select 'the change log has the roles and count, not the text',
  (select detail ->> 'recipients' = '4' and detail -> 'roles' = '["broker","agent"]'::jsonb and detail::text not like '%Holiday%' from public.audit_events where event_type = 'announcement_sent'), '';
set local role authenticated;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into results select 'one announcement a minute', pg_temp.fails($q$select public.admin_announce('Again', 'x', array['agent'])$q$) like 'error: One announcement a minute%', '';
reset role;
set local role anon;
insert into results select 'visitors cannot call it', pg_temp.fails($q$select public.admin_announce('Hi', 'x', array['agent'])$q$) in ('refused') or pg_temp.fails($q$select public.admin_announce('Hi', 'x', array['agent'])$q$) like 'error: permission denied%', pg_temp.fails($q$select public.admin_announce('Hi', 'x', array['agent'])$q$);
reset role;

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
