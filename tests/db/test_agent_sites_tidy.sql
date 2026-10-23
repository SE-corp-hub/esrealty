\set ON_ERROR_STOP 1
-- Agent websites tidy-up (supabase/migrations/0018): typed deal columns and credit fixed at
-- closing, the one closed-deal rule, the reply wording and saving a licence check in one call.
-- Rolls back.
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
grant all on results to authenticated, anon, service_role;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

update public.profiles set broker = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' where id = '11111111-1111-1111-1111-111111111111';

-- Typed deal columns ----------------------------------------------------------------------------------
insert into public.broker_transactions (id, ref, title, payload, broker_id, created_by) values
  ('td-1', 'TX-1', 'Lot sale', '{"stage":"done","doasDate":"2026-03-10","buyerAgentId":"11111111-1111-1111-1111-111111111111","sellerAgentId":"not-an-id","showDeal":true,"showPrice":true,"dealKind":"rental"}',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('td-2', 'TX-2', 'Open deal', '{"stage":"cts","sellerAgentId":"11111111-1111-1111-1111-111111111111","showPrice":true,"doasDate":"2026-02-30"}',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into results select 'the deal''s agents, consent, kind and closing date are kept as typed columns',
  (select buyer_agent_id = '11111111-1111-1111-1111-111111111111' and seller_agent_id is null and show_deal and show_price
          and deal_kind = 'rental' and closed_on = '2026-03-10' from public.broker_transactions where id = 'td-1'), '';
insert into results select 'an open deal has no closing date, and the price needs the deal shown first',
  (select closed_on is null and not show_price and seller_agent_id = '11111111-1111-1111-1111-111111111111' from public.broker_transactions where id = 'td-2'), '';
update public.broker_transactions set payload = payload || '{"stage":"done"}' where id = 'td-2';
insert into results select 'a mistyped Deed of Sale date cannot break a save; the deal closes on the day it is saved',
  (select closed_on = (now() at time zone 'Asia/Manila')::date from public.broker_transactions where id = 'td-2'), '';
-- (Setting up a deal closed earlier: the column is written directly, past the trigger.)
alter table public.broker_transactions disable trigger broker_transactions_typed;
update public.broker_transactions set closed_on = '2025-01-01' where id = 'td-2';
alter table public.broker_transactions enable trigger broker_transactions_typed;
update public.broker_transactions set payload = payload || '{"notes":"later edit"}' where id = 'td-2';
insert into results select 'a later save does not move the closing date of a closed deal',
  (select closed_on = '2025-01-01' from public.broker_transactions where id = 'td-2'), '';

-- Credit is fixed at closing ----------------------------------------------------------------------------
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into results select 'the broker cannot change the agents on a closed deal',
  pg_temp.fails($q$update public.broker_transactions set payload = payload || '{"buyerAgentId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}' where id = 'td-1'$q$) = 'refused', '';
insert into results select 'but can still edit the rest of it',
  pg_temp.fails($q$update public.broker_transactions set payload = payload || '{"notes":"keys handed over"}' where id = 'td-1'$q$) = 'ran', '';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
update public.broker_transactions set payload = payload || '{"sellerAgentId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}' where id = 'td-1';
insert into results select 'a Super Admin can correct them',
  (select seller_agent_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' from public.broker_transactions where id = 'td-1'), '';
select pg_temp.as_service();

-- One closed-deal rule ----------------------------------------------------------------------------------
insert into results select 'the closed deals that credit an agent, by side',
  (select count(*) = 2 and bool_and(as_buyer or as_seller) from public.agent_closed_deals('11111111-1111-1111-1111-111111111111')), '';
insert into results select 'the track record reads them in one pass',
  (select v ->> 'deals' = '2' and v ->> 'rentals' = '1' from (select public.agent_record('11111111-1111-1111-1111-111111111111') v) y),
  public.agent_record('11111111-1111-1111-1111-111111111111')::text;
insert into public.broker_transactions (id, ref, title, payload, broker_id, created_by) values
  ('td-3', 'TX-3', 'Old sale', jsonb_build_object('stage', 'done', 'doasDate', to_char(current_date - interval '50 months', 'YYYY-MM-DD'), 'buyerAgentId', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
insert into results select 'only deals older than 3 years: the record says "in 3 years" and counts none',
  (select v ->> 'deals' = '0' and v ->> 'window' = '3y' from (select public.agent_record('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') v) y),
  public.agent_record('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')::text;

-- Reply wording -----------------------------------------------------------------------------------------
insert into results select 'the reply wording comes from minutes',
  public.agent_reply_label(null) is null and public.agent_reply_label(20) = 'within 30 minutes' and public.agent_reply_label(200) = 'within 4 hours'
  and public.agent_reply_label(5000) = 'in more than a day', '';

-- Saving a licence check in one call --------------------------------------------------------------------
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
insert into results select 'only a Super Admin saves a licence check',
  pg_temp.fails($q$select public.licence_check_save('11111111-1111-1111-1111-111111111111', '{"licence_type":"salesperson","licence_no":"0012345","prc_name":"Maria Santos","valid_until":"2030-01-01"}')$q$) = 'refused', '';
reset role;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
set local role authenticated;
select public.licence_check_save('11111111-1111-1111-1111-111111111111',
  '{"licence_type":"salesperson","licence_no":" 0012345 ","prc_name":"Maria Santos","valid_until":"2030-01-01","broker_accepted":true,"id_seen":true}');
reset role;
insert into results select 'the first save records the check, by whom, and the ID tick',
  (select licence_no = '0012345' and checked_by = '77777777-7777-7777-7777-777777777777' and id_seen and id_seen_at is not null and not phone_confirmed
     from public.agent_verifications where agent_id = '11111111-1111-1111-1111-111111111111'), '';
-- (Setting up a check made a month ago: written directly, past the trigger.)
alter table public.agent_verifications disable trigger agent_verifications_stamp;
update public.agent_verifications set checked_at = now() - interval '30 days', id_seen_at = now() - interval '30 days' where agent_id = '11111111-1111-1111-1111-111111111111';
alter table public.agent_verifications enable trigger agent_verifications_stamp;
set local role authenticated;
select public.licence_check_save('11111111-1111-1111-1111-111111111111',
  '{"licence_type":"salesperson","licence_no":"0012345","prc_name":"Maria Santos","valid_until":"2030-01-01","broker_accepted":true,"id_seen":true,"phone_confirmed":true}');
reset role;
insert into results select 'saving the same details keeps the check date and the ID date, and stamps the phone check',
  (select checked_at < now() - interval '29 days' and id_seen_at < now() - interval '29 days' and phone_confirmed_at > now() - interval '1 minute'
     from public.agent_verifications where agent_id = '11111111-1111-1111-1111-111111111111'), '';
set local role authenticated;
select public.licence_check_save('11111111-1111-1111-1111-111111111111',
  '{"licence_type":"salesperson","licence_no":"0012345","prc_name":"Maria Santos","valid_until":"2030-01-01","broker_accepted":true,"id_seen":true,"phone_confirmed":true}', true);
reset role;
insert into results select '"checked again today" moves the check date only',
  (select checked_at > now() - interval '1 minute' and id_seen_at < now() - interval '29 days'
     from public.agent_verifications where agent_id = '11111111-1111-1111-1111-111111111111'), '';
alter table public.agent_verifications disable trigger agent_verifications_stamp;
update public.agent_verifications set id_seen_at = now() - interval '30 days' where agent_id = '11111111-1111-1111-1111-111111111111';
alter table public.agent_verifications enable trigger agent_verifications_stamp;
set local role authenticated;
select public.licence_check_save('11111111-1111-1111-1111-111111111111',
  '{"licence_type":"salesperson","licence_no":"0012345","prc_name":"Maria Santos Dela Cruz","valid_until":"2030-01-01","broker_accepted":true,"id_seen":true,"phone_confirmed":false}');
reset role;
insert into results select 'a new PRC name with the ID ticked counts as a fresh ID check of the new identity',
  (select id_seen and id_seen_at > now() - interval '1 minute' and not phone_confirmed and phone_confirmed_at is null
     from public.agent_verifications where agent_id = '11111111-1111-1111-1111-111111111111'), '';

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
