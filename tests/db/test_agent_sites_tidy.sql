\set ON_ERROR_STOP 1
-- Agent websites, tidy-up (supabase/migrations/0018): the licence check save function, the Super
-- Admin's review list, reply-time words, the shared "public pages" and "credited deals" helpers, and
-- one "next in turn" for lead routing. Rolls back.
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

-- Licence check save ----------------------------------------------------------------------------------
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
set local role authenticated;
insert into results select 'a Super Admin cannot write the licence table directly any more',
  pg_temp.fails($q$insert into public.agent_verifications (agent_id, licence_type, licence_no, prc_name, valid_until) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'broker', '0004321', 'Alfredo B. Reyes', '2030-01-01')$q$) = 'refused', '';
insert into results select 'licence checks are for brokers and agents only',
  pg_temp.fails($q$select public.licence_check_save('22222222-2222-2222-2222-222222222222', '0004321', 'Buyer Person', '2030-01-01', false, false, false)$q$) like 'error: Licence checks are for brokers and agents%', '';
insert into results select 'the number, the PRC name and the date are required',
  pg_temp.fails($q$select public.licence_check_save('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ' 1 ', 'Alfredo B. Reyes', '2030-01-01', false, false, false)$q$) like 'error: Enter the licence%'
  and pg_temp.fails($q$select public.licence_check_save('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '0004321', 'Al', '2030-01-01', false, false, false)$q$) like 'error: Enter the name%'
  and pg_temp.fails($q$select public.licence_check_save('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '0004321', 'Alfredo B. Reyes', null, false, false, false)$q$) like 'error: Enter the date%', '';
insert into x select to_jsonb(public.licence_check_save('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ' 0004321 ', ' Alfredo B. Reyes ', current_date + 300, true, true, false));
insert into results select 'saving returns the row: trimmed, typed from the account''s role, stamped with who and when',
  (select v ->> 'licence_no' = '0004321' and v ->> 'prc_name' = 'Alfredo B. Reyes' and v ->> 'licence_type' = 'broker'
          and v ->> 'checked_by' = '77777777-7777-7777-7777-777777777777' and v ->> 'id_seen_by' = '77777777-7777-7777-7777-777777777777'
          and v -> 'phone_confirmed_at' = 'null'::jsonb from x), (select v::text from x);
delete from x;
reset role;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
insert into results select 'an agent can still read their own check, and only that',
  (select count(*) = 0 from public.agent_verifications) and pg_temp.fails($q$select public.licence_check_save('11111111-1111-1111-1111-111111111111', '0012345', 'Maria Santos', '2030-01-01', true, true, true)$q$) = 'refused', '';
reset role;
select pg_temp.as_service();

-- Reviews for the Super Admin --------------------------------------------------------------------------
insert into public.broker_transactions (id, ref, title, payload, broker_id, created_by) values
  ('td-d1', 'TX-1', 'Lot sale', '{"stage":"done","doasDate":"2026-03-10","buyerAgentId":"11111111-1111-1111-1111-111111111111"}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777'),
  ('td-d2', 'TX-2', 'House lease', '{"stage":"doas","dealKind":"rental","sellerAgentId":"11111111-1111-1111-1111-111111111111","buyerAgentId":"11111111-1111-1111-1111-111111111111"}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777'),
  ('td-d3', 'TX-3', 'Open deal', '{"stage":"cts","sellerAgentId":"11111111-1111-1111-1111-111111111111"}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777'),
  ('td-d4', 'TX-4', 'Other team', '{"stage":"done","buyerAgentId":"11111111-1111-1111-1111-111111111111"}', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select public.review_invite('td-d1', '11111111-1111-1111-1111-111111111111');
set local role authenticated;
insert into x select public.agent_reviews_admin();
insert into results select 'the Super Admin''s review list has the review, without the link''s hash',
  (select jsonb_array_length(v) = 1 and v -> 0 ->> 'deal_id' = 'td-d1' and v -> 0 ->> 'status' = 'invited' and not (v -> 0 ? 'token_hash') from x), (select v::text from x);
delete from x;
reset role;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
insert into results select 'an agent cannot list reviews for moderation', pg_temp.fails($q$select public.agent_reviews_admin()$q$) = 'refused', '';
reset role;
select pg_temp.as_service();

-- Credited deals, in one place ---------------------------------------------------------------------------
create temp table d as select * from public.agent_deals('11111111-1111-1111-1111-111111111111');
insert into results select 'credited deals stay inside the deal''s own team', (select array_agg(id order by id) from d) = array['td-d1', 'td-d2', 'td-d3'], (select string_agg(id, ',') from d);
insert into results select 'each carries closed, its closing date, side and rental',
  (select closed and closed_on = '2026-03-10' and as_buyer and not as_seller and not rental from d where id = 'td-d1')
  and (select closed and as_buyer and as_seller and rental from d where id = 'td-d2')
  and (select not closed from d where id = 'td-d3'), '';

-- Reply time in words ----------------------------------------------------------------------------------
insert into results select 'reply-time words keep their boundaries',
  public.reply_label(30) = 'within 30 minutes' and public.reply_label(31) = 'within an hour' and public.reply_label(60) = 'within an hour'
  and public.reply_label(240) = 'within 4 hours' and public.reply_label(1440) = 'within a day' and public.reply_label(1441) = 'in more than a day'
  and public.reply_label(null) is null, '';

-- Helpers are for the server's own functions -----------------------------------------------------------
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
set local role authenticated;
insert into results select 'the shared helpers cannot be called from the app, even by a Super Admin',
  pg_temp.fails($q$select * from public.public_agent_sites()$q$) = 'refused'
  and pg_temp.fails($q$select * from public.agent_deals('11111111-1111-1111-1111-111111111111')$q$) = 'refused'
  and pg_temp.fails($q$select public.routing_people('[]', true)$q$) = 'refused', '';
reset role;
select pg_temp.as_service();

-- Lead routing: one "next in turn" -----------------------------------------------------------------------
-- No townNext yet, two people for Lipa (an agent and a broker), one broker for everyone else.
insert into public.site_settings (key, value, is_public) values ('leadRouting',
  '{"enabled":true,"brokers":["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"],"next":5,
    "towns":{"lipa-city":["11111111-1111-1111-1111-111111111111","cccccccc-cccc-cccc-cccc-cccccccccccc","aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]}}', false)
  on conflict (key) do update set value = excluded.value;
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('td-r1', 'R1', 'Lipa one', '{"status":"new","phone":"0911 100 0001","fullReport":{"inputs":{"municipality":"LIPA CITY"}}}', '77777777-7777-7777-7777-777777777777');
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('td-r2', 'R2', 'Lipa two', '{"status":"new","phone":"0911 100 0002","fullReport":{"inputs":{"municipality":"LIPA CITY"}}}', '77777777-7777-7777-7777-777777777777');
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('td-r3', 'R3', 'Lipa appraisal', '{"status":"new","phone":"0911 100 0003","channel":"professional-appraisal-request","fullReport":{"inputs":{"municipality":"LIPA CITY"}}}', '77777777-7777-7777-7777-777777777777');
insert into results select 'the town rule takes turns in list order, skipping accounts that are not approved',
  (select assigned_to_id = '11111111-1111-1111-1111-111111111111' from public.crm_leads where id = 'td-r1')
  and (select assigned_to_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' from public.crm_leads where id = 'td-r2'), '';
insert into results select 'an appraisal request goes to the town''s brokers only', (select assigned_to_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and payload::text like '%town rule%' from public.crm_leads where id = 'td-r3'), '';
insert into results select 'the town''s turn is kept under townNext and the brokers'' turn is left alone',
  (select (value -> 'townNext' ->> 'lipa-city')::int = 1 and (value ->> 'next')::int = 5 from public.site_settings where key = 'leadRouting'), (select value::text from public.site_settings where key = 'leadRouting');
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('td-r4', 'R4', 'Plain lead', '{"status":"new","phone":"0911 100 0004"}', '77777777-7777-7777-7777-777777777777');
insert into results select 'other leads go to the brokers in turn, and that turn moves',
  (select assigned_to_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and payload::text like '%in turn%' from public.crm_leads where id = 'td-r4')
  and (select (value ->> 'next')::int = 1 from public.site_settings where key = 'leadRouting'), '';
update public.site_settings set value = value || '{"brokers":{"not":"a list"}}' where key = 'leadRouting';
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('td-r5', 'R5', 'Bad settings', '{"status":"new","phone":"0911 100 0005"}', '77777777-7777-7777-7777-777777777777');
insert into results select 'broken routing settings never stop a lead from saving', (select assigned_to_id is null from public.crm_leads where id = 'td-r5'), '';

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
