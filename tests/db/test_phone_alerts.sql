\set ON_ERROR_STOP 1
-- Phone alerts and lead alerts (supabase/migrations/0003). Rolls back.
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
delete from public.notifications;

-- subscriptions: each person only their own
set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
insert into results select 'agent: turns alerts on', pg_temp.fails($q$select public.push_subscribe('https://push.example/agent-phone', 'BPx' || repeat('a', 80), 'auth1234abcd', 'Android')$q$) = 'ran', '';
insert into results select 'agent: sees their own phone', (select count(*) from public.push_subscriptions) = 1, '';
insert into results select 'a bad subscription is refused', pg_temp.fails($q$select public.push_subscribe('http://insecure.example/x', 'k', 'a')$q$) like 'error: Not a push subscription%', '';
insert into results select 'nobody writes the table directly', pg_temp.fails($q$insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://x', auth.uid(), 'k', 'a')$q$) = 'refused', '';
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'buyer@x.ph');
insert into results select 'someone else does not see the agent''s phone', (select count(*) from public.push_subscriptions) = 0, '';
insert into results select 'someone else cannot remove it', (select count(*) from (select 1) x where pg_temp.fails($q$delete from public.push_subscriptions where endpoint = 'https://push.example/agent-phone'$q$) = 'ran') = 1
  and (select count(*) from public.push_subscriptions where endpoint = 'https://push.example/agent-phone') = 0, '';
create temp table moved as select pg_temp.fails($q$select public.push_subscribe('https://push.example/agent-phone', 'BPx' || repeat('b', 80), 'auth5678abcd', 'Android')$q$) as r;
insert into results select 'a phone that changes hands moves to the new person', (select r from moved) = 'ran' and (select count(*) from public.push_subscriptions) = 1, (select r from moved) || ' / ' || (select count(*) from public.push_subscriptions);
reset role;
insert into results select '... and is no longer the agent''s', (select user_id::text from public.push_subscriptions where endpoint = 'https://push.example/agent-phone') = '22222222-2222-2222-2222-222222222222', '';
set local role anon;
select set_config('request.jwt.claims', '', true);
insert into results select 'visitors cannot turn alerts on', pg_temp.fails($q$select public.push_subscribe('https://push.example/v', 'BPx' || repeat('c', 80), 'auth1234abcd')$q$) <> 'ran', '';
reset role;

-- the public key: super-admin only; new keys clear old subscriptions
set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
insert into results select 'agent cannot set the key', pg_temp.fails($q$select public.push_set_public_key(repeat('A', 87))$q$) = 'refused', '';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into results select 'super-admin rejects something that is not a key', pg_temp.fails($q$select public.push_set_public_key('not a key')$q$) like 'error: Not a public key%', '';
insert into results select 'super-admin sets the key', pg_temp.fails($q$select public.push_set_public_key(repeat('A', 87))$q$) = 'ran', '';
insert into results select 'signed-in people can read the public key', (select count(*) from public.push_config where public_key = repeat('A', 87)) = 1, '';
reset role;
insert into results select 'new keys clear the old subscriptions', (select count(*) from public.push_subscriptions) = 0, '';
set local role anon;
insert into results select 'visitors cannot read the key table', pg_temp.fails($q$select * from public.push_config$q$) = 'refused', '';
reset role;

-- lead alerts
insert into public.crm_leads (id, ref, name, payload, created_by, assigned_to_id)
  values ('lead-a1', 'L-A1', 'Maria Santos', '{"source":"Value Guide"}', '77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111');
insert into results select 'a lead assigned to an agent tells the agent', (select count(*) from public.notifications where user_id = '11111111-1111-1111-1111-111111111111' and type = 'lead' and title = 'New lead for you: Maria Santos' and body like 'From Value Guide.%' and link_view = 'leads') = 1, (select string_agg(title, '; ') from public.notifications);
insert into public.crm_leads (id, ref, name, payload, created_by)
  values ('lead-a2', 'L-A2', 'Juan Cruz', '{}', '11111111-1111-1111-1111-111111111111');
insert into results select 'an unassigned lead tells the super-admins', (select count(*) from public.notifications where user_id = '77777777-7777-7777-7777-777777777777' and title = 'New lead: Juan Cruz') = 1, '';
insert into public.crm_leads (id, ref, name, payload, created_by, assigned_to_id)
  values ('lead-a3', 'L-A3', 'Own Lead', '{}', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111');
insert into results select 'an agent''s own lead does not notify them', (select count(*) from public.notifications where title like '%Own Lead%') = 0, '';
set local role authenticated;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
update public.crm_leads set assigned_to_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' where id = 'lead-a2';
reset role;
insert into results select 'reassigning tells the new person', (select count(*) from public.notifications where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and title = 'Lead assigned to you: Juan Cruz') = 1, '';
update public.crm_leads set payload = '{"note":"x"}' where id = 'lead-a2';
insert into results select 'other edits do not notify again', (select count(*) from public.notifications where title like '%Juan Cruz%') = 2, '';
insert into results select 'notifications can be marked as pushed', (select count(*) from information_schema.columns where table_name = 'notifications' and column_name = 'pushed_at') = 1, '';

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
