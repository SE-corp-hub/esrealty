\set ON_ERROR_STOP 1
-- Agent websites, finishing work (supabase/migrations/0017): rentals and the 3-year window on the
-- track record, agents reading the deals that credit them, Viber on directory cards, the page's
-- preview image, sign-up details in Users & Access, expired pre-selling listings. Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true); $$;
create or replace function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '', true); $$;
create temp table results(name text, ok boolean, detail text);
create temp table x(v jsonb);
grant all on results, x to authenticated, anon, service_role;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- Maria (agent under Broker Alpha) with a public page that shows a Viber number.
update public.profiles set full_name = 'Maria Santos', broker = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' where id = '11111111-1111-1111-1111-111111111111';
insert into public.agent_verifications (agent_id, licence_type, licence_no, prc_name, valid_until, broker_accepted) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'broker', '0004321', 'Alfredo B. Reyes', current_date + 300, false),
  ('11111111-1111-1111-1111-111111111111', 'salesperson', '0012345', 'Maria Santos Dela Cruz', current_date + 200, true);
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select public.agent_site_save('{"pitch":"Lots in Lipa","towns":["lipa-city"],"contacts":{"viber":"0917 123 4567"},
  "og_image":"https://abc123.supabase.co/storage/v1/object/public/listing-photos/u1/agent-card-1.png"}');
select public.agent_site_publish();
select pg_temp.as_service();

-- Preview image and Viber ---------------------------------------------------------------------------
insert into results select 'the page keeps its preview image', (select data ->> 'og_image' from public.agent_sites where agent_id = '11111111-1111-1111-1111-111111111111') like 'https://abc123.supabase.co/%agent-card-1.png', '';
insert into results select 'an image from anywhere else is dropped',
  public.agent_site_clean('{"og_image":"https://evil.example/x.png"}') ->> 'og_image' = ''
  and public.agent_site_clean('{"og_image":"https://abc123.supabase.co/storage/v1/object/public/listing-photos/u/x.svg"}') ->> 'og_image' = '', '';
set local role service_role;
insert into x select public.public_agents();
reset role;
insert into results select 'directory cards carry the Viber number the agent published, and no other number',
  (select v -> 'agents' -> 0 ->> 'viber' = '+639171234567' and not (v -> 'agents' -> 0 ? 'call') from x), (select v::text from x);
delete from x;

-- Track record: rentals apart ------------------------------------------------------------------------
insert into public.broker_transactions (id, ref, title, payload, broker_id, created_by) values
  ('fn-d1', 'TX-1', 'Lot sale', '{"stage":"done","doasDate":"2026-03-10","buyerAgentId":"11111111-1111-1111-1111-111111111111"}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('fn-d2', 'TX-2', 'House lease', '{"stage":"done","dealKind":"rental","doasDate":"2026-05-02","sellerAgentId":"11111111-1111-1111-1111-111111111111","showDeal":true}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into x select public.agent_record('11111111-1111-1111-1111-111111111111');
insert into results select 'a rental is counted as a rental, not as a sale side',
  (select v ->> 'deals' = '2' and v ->> 'buyer' = '1' and v ->> 'seller' = '0' and v ->> 'rentals' = '1' and v -> 'window' = 'null'::jsonb from x), (select v::text from x);
insert into results select 'and listed as a rental', (select v -> 'rows' -> 0 ->> 'side' = 'rental' from x), (select v::text from x);
delete from x;

-- Track record: the last 3 years once there are 36 months of records ---------------------------------
insert into public.broker_transactions (id, ref, title, payload, broker_id, created_by) values
  ('fn-d3', 'TX-3', 'Old sale', jsonb_build_object('stage', 'done', 'doasDate', to_char(current_date - interval '40 months', 'YYYY-MM-DD'), 'buyerAgentId', '11111111-1111-1111-1111-111111111111'),
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into x select public.agent_record('11111111-1111-1111-1111-111111111111');
insert into results select 'with 36 months of records the record covers the last 3 years',
  (select v ->> 'window' = '3y' and v ->> 'deals' = '2' and v ->> 'since' = '2026-03' from x), (select v::text from x);
delete from x;
delete from public.broker_transactions where id = 'fn-d3';

-- Agents read the deals that credit them ------------------------------------------------------------
insert into public.broker_transactions (id, ref, title, payload, broker_id, created_by) values
  ('fn-d4', 'TX-4', 'Office deal', '{"stage":"cts","buyerAgentId":"11111111-1111-1111-1111-111111111111"}', '77777777-7777-7777-7777-777777777777', '77777777-7777-7777-7777-777777777777'),
  ('fn-d5', 'TX-5', 'Other team', '{"stage":"cts","buyerAgentId":"11111111-1111-1111-1111-111111111111"}', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('fn-d6', 'TX-6', 'Office deal, someone else', '{"stage":"cts"}', '77777777-7777-7777-7777-777777777777', '77777777-7777-7777-7777-777777777777');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
insert into results select 'an agent reads a Super Admin''s deal that credits them', exists (select 1 from public.broker_transactions where id = 'fn-d4'), '';
insert into results select 'but not another team''s deal that names them, nor deals that do not', not exists (select 1 from public.broker_transactions where id in ('fn-d5', 'fn-d6')), '';
update public.broker_transactions set title = 'Changed by the agent' where id = 'fn-d4';
reset role;
select pg_temp.as_service();
insert into results select 'and cannot change a deal that credits them', (select title = 'Office deal' from public.broker_transactions where id = 'fn-d4'), '';

-- Sign-up details in Users & Access -----------------------------------------------------------------
update auth.users set raw_user_meta_data = '{"requested_role":"agent","requested_prc":"0099887","requested_broker":"Alfredo B. Reyes"}' where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
insert into results select 'Users & Access shows the licence number and broker typed at sign-up',
  (select p ->> 'requested_prc' = '0099887' and p ->> 'requested_broker' = 'Alfredo B. Reyes' from public.admin_list_profiles() p where p ->> 'id' = '11111111-1111-1111-1111-111111111111'), '';
select pg_temp.as_service();

-- Pre-selling listings with an expired licence to sell ----------------------------------------------
insert into public.shared_listings (id, owner_id, title, status, is_published, published_at, payload) values
  ('fn-l1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Expired LTS', 'pre-selling', true, now(), jsonb_build_object('licenseToSell', 'LTS 1', 'licenseToSellUntil', to_char(current_date - 1, 'YYYY-MM-DD'))),
  ('fn-l2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Current LTS', 'pre-selling', true, now(), jsonb_build_object('licenseToSell', 'LTS 2', 'licenseToSellUntil', to_char(current_date + 30, 'YYYY-MM-DD'))),
  ('fn-l3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Not pre-selling', 'available', true, now(), jsonb_build_object('licenseToSellUntil', to_char(current_date - 1, 'YYYY-MM-DD')));
insert into results select 'a pre-selling listing leaves the public catalog when its licence to sell has expired',
  (select array_agg(id order by id) from public.public_listing_catalog where id like 'fn-l%') = array['fn-l2', 'fn-l3'], (select string_agg(id, ',') from public.public_listing_catalog where id like 'fn-l%');

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
