\set ON_ERROR_STOP 1
-- Agent websites, follow-up to the tidy-up (supabase/migrations/0019): the Super Admin's review
-- list, licence checks written only through licence_check_save, and one "next in turn" for lead
-- routing. Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true); $$;
create or replace function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '', true); $$;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when insufficient_privilege then return 'refused'; when others then return 'error: ' || sqlerrm; end $$;
create temp table results(name text, ok boolean, detail text);
create temp table x(v jsonb);
grant all on results, x to authenticated, anon, service_role;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

update public.profiles set full_name = 'Maria Santos', broker = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' where id = '11111111-1111-1111-1111-111111111111';

-- Licence checks: one way in --------------------------------------------------------------------------
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
set local role authenticated;
insert into results select 'a Super Admin can no longer write the licence table directly',
  pg_temp.fails($q$insert into public.agent_verifications (agent_id, licence_type, licence_no, prc_name, valid_until) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'broker', '0004321', 'Alfredo B. Reyes', '2030-01-01')$q$) = 'refused', '';
insert into x select to_jsonb(public.licence_check_save('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '{"licence_type":"broker","licence_no":" 0004321 ","prc_name":"Alfredo B. Reyes","valid_until":"2030-01-01"}'));
insert into results select 'saving through licence_check_save still works and is stamped with who checked',
  (select v ->> 'licence_no' = '0004321' and v ->> 'checked_by' = '77777777-7777-7777-7777-777777777777' from x), (select v::text from x);
delete from x;
insert into results select 'and a Super Admin still reads every check', (select count(*) = 1 from public.agent_verifications), '';
insert into results select 'nor delete one directly',
  pg_temp.fails($q$delete from public.agent_verifications where agent_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$) = 'refused', '';
reset role;
select pg_temp.as_service();

-- Reviews for the Super Admin --------------------------------------------------------------------------
insert into public.broker_transactions (id, ref, title, payload, broker_id, created_by) values
  ('fu-d1', 'TX-1', 'Lot sale', '{"stage":"done","doasDate":"2026-03-10","buyerAgentId":"11111111-1111-1111-1111-111111111111"}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777');
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select public.review_invite('fu-d1', '11111111-1111-1111-1111-111111111111');
set local role authenticated;
insert into x select public.agent_reviews_admin();
insert into results select 'the Super Admin''s review list has the review, without the link''s hash',
  (select jsonb_array_length(v) = 1 and v -> 0 ->> 'deal_id' = 'fu-d1' and v -> 0 ->> 'status' = 'invited' and not (v -> 0 ? 'token_hash') from x), (select v::text from x);
delete from x;
insert into results select 'the reviews table itself cannot be read from the app, even by a Super Admin',
  pg_temp.fails($q$select id from public.agent_reviews$q$) = 'refused', '';
reset role;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
insert into results select 'an agent cannot list reviews for moderation', pg_temp.fails($q$select public.agent_reviews_admin()$q$) = 'refused', '';
insert into results select 'the routing helper is not callable from the app', pg_temp.fails($q$select public.routing_people('[]', true)$q$) = 'refused', '';
reset role;
select pg_temp.as_service();

-- Lead routing: one "next in turn" -----------------------------------------------------------------------
-- No townNext yet; Lipa lists an agent, a broker who is not approved, and a broker; one broker for the rest.
insert into public.site_settings (key, value, is_public) values ('leadRouting',
  '{"enabled":true,"brokers":["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"],"next":5,
    "towns":{"lipa-city":["11111111-1111-1111-1111-111111111111","cccccccc-cccc-cccc-cccc-cccccccccccc","aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]}}', false)
  on conflict (key) do update set value = excluded.value;
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('fu-r1', 'R1', 'Lipa one', '{"status":"new","phone":"0911 100 0001","fullReport":{"inputs":{"municipality":"LIPA CITY"}}}', '77777777-7777-7777-7777-777777777777');
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('fu-r2', 'R2', 'Lipa two', '{"status":"new","phone":"0911 100 0002","fullReport":{"inputs":{"municipality":"LIPA CITY"}}}', '77777777-7777-7777-7777-777777777777');
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('fu-r3', 'R3', 'Lipa appraisal', '{"status":"new","phone":"0911 100 0003","channel":"professional-appraisal-request","fullReport":{"inputs":{"municipality":"LIPA CITY"}}}', '77777777-7777-7777-7777-777777777777');
insert into results select 'the town rule takes turns in list order, skipping accounts that are not approved',
  (select assigned_to_id = '11111111-1111-1111-1111-111111111111' from public.crm_leads where id = 'fu-r1')
  and (select assigned_to_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' from public.crm_leads where id = 'fu-r2'), '';
insert into results select 'an appraisal request goes to the town''s brokers only', (select assigned_to_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and payload::text like '%town rule%' from public.crm_leads where id = 'fu-r3'), '';
insert into results select 'the town''s turn is kept under townNext and the brokers'' turn is left alone',
  (select (value -> 'townNext' ->> 'lipa-city')::int = 1 and (value ->> 'next')::int = 5 from public.site_settings where key = 'leadRouting'), (select value::text from public.site_settings where key = 'leadRouting');
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('fu-r4', 'R4', 'Plain lead', '{"status":"new","phone":"0911 100 0004"}', '77777777-7777-7777-7777-777777777777');
insert into results select 'other leads go to the brokers in turn, and that turn moves',
  (select assigned_to_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and payload::text like '%in turn%' from public.crm_leads where id = 'fu-r4')
  and (select (value ->> 'next')::int = 1 from public.site_settings where key = 'leadRouting'), '';
update public.site_settings set value = value || '{"brokers":{"not":"a list"}}' where key = 'leadRouting';
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('fu-r5', 'R5', 'Bad settings', '{"status":"new","phone":"0911 100 0005"}', '77777777-7777-7777-7777-777777777777');
insert into results select 'broken routing settings never stop a lead from saving', (select assigned_to_id is null from public.crm_leads where id = 'fu-r5'), '';

-- A closed deal's agents stay fixed after it is reopened ----------------------------------------------
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
set local role authenticated;
insert into public.broker_transactions (id, ref, title, payload, broker_id, created_by) values
  ('fu-ro', 'TX-R', 'Reopened deal', '{"stage":"done","buyerAgentId":"11111111-1111-1111-1111-111111111111"}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into results select 'a broker may move a closed deal back a stage',
  pg_temp.fails($q$update public.broker_transactions set payload = payload || '{"stage":"cts"}' where id = 'fu-ro'$q$) = 'ran', '';
insert into results select 'but its agents stay fixed, in a later save too',
  pg_temp.fails($q$update public.broker_transactions set payload = payload || '{"buyerAgentId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}' where id = 'fu-ro'$q$) = 'refused'
  and pg_temp.fails($q$update public.broker_transactions set payload = payload || '{"buyerAgentId":""}' where id = 'fu-ro'$q$) = 'refused', '';
insert into results select 'the rest of the deal can still be edited, and an open deal''s agents still change freely',
  pg_temp.fails($q$update public.broker_transactions set payload = payload || '{"notes":"reopened for a correction"}' where id = 'fu-ro'$q$) = 'ran'
  and pg_temp.fails($q$insert into public.broker_transactions (id, ref, title, payload, broker_id, created_by) values ('fu-open', 'TX-O', 'Open deal', '{"stage":"cts"}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$q$) = 'ran'
  and pg_temp.fails($q$update public.broker_transactions set payload = payload || '{"buyerAgentId":"11111111-1111-1111-1111-111111111111"}' where id = 'fu-open'$q$) = 'ran', '';
reset role;
insert into results select 'the deal remembers that it closed', (select agents_fixed and closed_on is null and buyer_agent_id = '11111111-1111-1111-1111-111111111111' from public.broker_transactions where id = 'fu-ro'), '';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
update public.broker_transactions set payload = payload || '{"buyerAgentId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}' where id = 'fu-ro';
insert into results select 'a Super Admin can still correct them', (select buyer_agent_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' from public.broker_transactions where id = 'fu-ro'), '';
select pg_temp.as_service();

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
