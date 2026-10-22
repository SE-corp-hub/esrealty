\set ON_ERROR_STOP 1
-- Automatic lead routing (supabase/migrations/0009). Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.as_user(uid text, em text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', em)::text, true); $$;
create or replace function pg_temp.nobody() returns void language sql as $$ select set_config('request.jwt.claims', '', true); $$;
create temp table results(name text, ok boolean, detail text);

-- Each lead is its own statement, as when the website saves one. Off (no setting): nobody is assigned, Super Admins are told as before.
select pg_temp.nobody();
insert into public.crm_leads (id, name, payload, created_by) values ('rt-0', 'Web rt-0', '{"source":"website","activity":[{"text":"Lead created"}]}', '77777777-7777-7777-7777-777777777777');
insert into results select 'without the setting nothing changes', (select assigned_to_id is null from public.crm_leads where id = 'rt-0'), '';

-- On, with brokers A, B and the pending broker C (skipped).
insert into public.site_settings (key, value, is_public) values ('leadRouting',
  '{"enabled": true, "brokers": ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "cccccccc-cccc-cccc-cccc-cccccccccccc", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"], "next": 0}', false);
insert into public.crm_leads (id, name, payload, created_by) values ('rt-1', 'Web rt-1', '{"source":"website","activity":[{"text":"Lead created"}]}', '77777777-7777-7777-7777-777777777777'); insert into public.crm_leads (id, name, payload, created_by) values ('rt-2', 'Web rt-2', '{"source":"website","activity":[{"text":"Lead created"}]}', '77777777-7777-7777-7777-777777777777'); insert into public.crm_leads (id, name, payload, created_by) values ('rt-3', 'Web rt-3', '{"source":"website","activity":[{"text":"Lead created"}]}', '77777777-7777-7777-7777-777777777777');
insert into results select 'website leads go to the brokers in turn, skipping one not approved',
  (select string_agg(assigned_to_id::text, ',' order by id) from public.crm_leads where id in ('rt-1', 'rt-2', 'rt-3'))
  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb,aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (select string_agg(assigned_to_id::text, ',' order by id) from public.crm_leads where id in ('rt-1', 'rt-2', 'rt-3'));
insert into results select 'the name and an activity line are written into the lead',
  (select assigned_to = 'Broker Alpha' and payload ->> 'assignedTo' = 'Broker Alpha' and payload -> 'activity' -> 1 ->> 'text' like 'Assigned to Broker Alpha automatically%'
     and payload -> 'activity' -> 0 ->> 'text' = 'Lead created' from public.crm_leads where id = 'rt-1'), '';
insert into results select 'the broker gets the usual "New lead for you" alert',
  (select count(*) from public.notifications where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and title = 'New lead for you: Web rt-2') = 1, '';
insert into results select 'the turn is remembered (Broker Beta is next)', (select (value ->> 'next')::int from public.site_settings where key = 'leadRouting') = 1, (select value::text from public.site_settings where key = 'leadRouting');

-- A lead with an assignee, and a lead typed in the app, are left alone.
insert into public.crm_leads (id, name, created_by, assigned_to_id) values ('rt-own', 'Owned', '77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111');
insert into results select 'an assigned lead keeps its assignee', (select assigned_to_id = '11111111-1111-1111-1111-111111111111' from public.crm_leads where id = 'rt-own'), '';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into public.crm_leads (id, name, created_by) values ('rt-app', 'Typed', '77777777-7777-7777-7777-777777777777');
insert into results select 'a lead typed in the app by a person is not routed', (select assigned_to_id is null from public.crm_leads where id = 'rt-app'), '';
select pg_temp.nobody();

-- Demoted broker drops out; switched off stops it.
update public.profiles set role = 'agent' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
insert into public.crm_leads (id, name, payload, created_by) values ('rt-4', 'Web rt-4', '{"source":"website","activity":[{"text":"Lead created"}]}', '77777777-7777-7777-7777-777777777777'); insert into public.crm_leads (id, name, payload, created_by) values ('rt-5', 'Web rt-5', '{"source":"website","activity":[{"text":"Lead created"}]}', '77777777-7777-7777-7777-777777777777');
insert into results select 'a broker who is no longer a broker is skipped', (select bool_and(assigned_to_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') from public.crm_leads where id in ('rt-4', 'rt-5')), '';
update public.site_settings set value = jsonb_set(value, '{enabled}', 'false') where key = 'leadRouting';
insert into public.crm_leads (id, name, payload, created_by) values ('rt-6', 'Web rt-6', '{"source":"website","activity":[{"text":"Lead created"}]}', '77777777-7777-7777-7777-777777777777');
insert into results select 'turned off: nobody is assigned', (select assigned_to_id is null from public.crm_leads where id = 'rt-6'), '';
update public.site_settings set value = '{"enabled": true, "brokers": ["not-a-uuid"], "next": "x"}' where key = 'leadRouting';
insert into public.crm_leads (id, name, payload, created_by) values ('rt-7', 'Web rt-7', '{"source":"website","activity":[{"text":"Lead created"}]}', '77777777-7777-7777-7777-777777777777');
insert into results select 'a broken setting never stops a lead from saving', (select count(*) from public.crm_leads where id = 'rt-7') = 1, '';
insert into results select 'the setting is not public', (select not is_public from public.site_settings where key = 'leadRouting'), '';

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
