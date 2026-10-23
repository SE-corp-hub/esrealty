\set ON_ERROR_STOP 1
-- Agent websites, Phases 2 and 3 (supabase/migrations/0016): directory, town routing, Verified,
-- check-an-agent, track record and reviews. Rolls back.
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
create temp table tok(t text);
grant all on results, x, tok to authenticated, anon, service_role;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- Two public pages: an agent in Lipa (under Broker Alpha) and Broker Beta in Malvar.
update public.profiles set full_name = 'Maria Santos', broker = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', phone = '0999 888 7777'
 where id = '11111111-1111-1111-1111-111111111111';
insert into public.agent_verifications (agent_id, licence_type, licence_no, prc_name, valid_until, broker_accepted) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'broker', '0004321', 'Alfredo B. Reyes', current_date + 300, false),
  ('11111111-1111-1111-1111-111111111111', 'salesperson', '00-12345', 'Maria Santos Dela Cruz', current_date + 200, true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'broker', '0007777', 'Beatriz Lim', current_date + 100, false);
insert into public.shared_listings (id, owner_id, title, status, is_published, published_at, offer_type, price, city, property_type, lot_size_sqm) values
  ('pf-l1', '11111111-1111-1111-1111-111111111111', 'Corner lot in Sabang', 'available', true, now(), 'sale', 2850000, 'Lipa City', 'lot', 300);
-- The broker's page is built first on purpose: in 0015 that failed ("record bv is not assigned yet").
select pg_temp.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select public.agent_site_save('{"pitch":"Homes in Malvar","towns":["malvar"],"needs":["sell"],"languages":["english"],"contacts":{"viber":"09181112222"}}');
select public.agent_site_publish();
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select public.agent_site_save('{"pitch":"Lots in Lipa","towns":["lipa-city"],"needs":["buy","lots"],"languages":["filipino"],"contacts":{"call":"0917 123 4567"}}');
select public.agent_site_publish();
-- Broker Alpha has a draft page only.
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.agent_site_save('{"pitch":"Draft","contacts":{"call":"09175550000"}}');
select pg_temp.as_service();

-- Rights ----------------------------------------------------------------------------------------
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
set local role authenticated;
insert into results select 'signed-in users cannot call the directory, the lookup or the review functions directly',
  pg_temp.fails($q$select public.public_agents()$q$) = 'refused' and pg_temp.fails($q$select public.agent_check('0012345')$q$) = 'refused'
  and pg_temp.fails($q$select public.review_lookup('x')$q$) = 'refused' and pg_temp.fails($q$select public.review_submit('x','a','b','c')$q$) = 'refused', '';
insert into results select 'only a Super Admin makes review links', pg_temp.fails($q$select public.review_invite('d', '11111111-1111-1111-1111-111111111111')$q$) = 'refused', '';
reset role;

-- Directory -------------------------------------------------------------------------------------
set local role service_role;
insert into x select public.public_agents();
reset role;
insert into results select 'the directory lists the two public pages, not drafts',
  (select (v ->> 'total')::int = 2 and not (v::text like '%Draft%') from x), (select v::text from x);
insert into results select 'directory cards carry what the card shows, and nothing private',
  (select bool_and(e ? 'slug' and e ? 'name' and e ? 'licence_checked_on' and not (e ? 'contacts') and e::text not like '%0999%') from x, jsonb_array_elements(v -> 'agents') e), '';
delete from x;
set local role service_role;
insert into x select public.public_agents('lipa-city', null, null);
insert into x select public.public_agents(null, 'sell', null);
insert into x select public.public_agents(null, null, 'filipino');
insert into x select public.public_agents('lipa-city', 'sell', null);
reset role;
insert into results select 'filters by town, need and language',
  (select array_agg((v ->> 'total')::int || ':' || coalesce(v -> 'agents' -> 0 ->> 'name', '-') order by ctid) from x) = array['1:Maria Santos Dela Cruz', '1:Beatriz Lim', '1:Maria Santos Dela Cruz', '0:-'],
  (select string_agg(v::text, ' | ') from x);
delete from x;

-- Measured reply time sorts first.
insert into public.crm_leads (id, ref, name, payload, created_by, assigned_to_id, created_at)
  select 'pf-r' || g, 'R' || g, 'Lead ' || g, '{"status":"new"}', '77777777-7777-7777-7777-777777777777', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now() - interval '10 minutes'
    from generate_series(1, 5) g;
select pg_temp.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
update public.crm_leads set payload = payload || '{"status":"contacted"}' where id like 'pf-r%';
set local role service_role;
insert into x select public.public_agents();
reset role;
insert into results select 'the menu count matches the directory', public.public_agent_count() = 2, '';
insert into results select 'agents with a measured reply time come first',
  (select v -> 'agents' -> 0 ->> 'name' = 'Beatriz Lim' and v -> 'agents' -> 0 ->> 'reply' = 'within 30 minutes' from x), (select v::text from x);
delete from x;
-- Leads an agent types in for themselves do not make their reply time.
insert into public.crm_leads (id, ref, name, payload, created_by, assigned_to_id, created_at)
  select 'pf-s' || g, 'S' || g, 'Self ' || g, '{"status":"new"}', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', now() - interval '10 minutes'
    from generate_series(1, 5) g;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
update public.crm_leads set payload = payload || '{"status":"contacted"}' where id like 'pf-s%';
select pg_temp.as_service();
insert into results select 'leads an agent made for themselves do not count toward reply time', public.agent_reply_minutes('11111111-1111-1111-1111-111111111111') is null, '';

-- Listed by, and the page behind a message.
set local role service_role;
insert into results select 'a listing''s agent with a public page has its address', public.agent_public_slug('11111111-1111-1111-1111-111111111111') = 'maria-santos-dela-cruz', '';
insert into results select 'a draft page has none', public.agent_public_slug('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') is null, '';
insert into results select 'a page address finds its agent', public.agent_page_lookup('Maria-Santos-Dela-Cruz') = '11111111-1111-1111-1111-111111111111' and public.agent_page_lookup('nobody') is null, '';
reset role;

-- Verified --------------------------------------------------------------------------------------
-- Every save goes through licence_check_save (migration 0018). now() is fixed inside this
-- transaction, so dates are first moved into the past to see which ones a save refreshes.
create or replace function pg_temp.maria(p_id boolean, p_phone boolean, p_recheck boolean default false, p_name text default 'Maria Santos Dela Cruz')
returns void language sql as $$
  select public.licence_check_save('11111111-1111-1111-1111-111111111111', '00-12345', p_name, current_date + 200, true, p_id, p_phone, p_recheck); $$;
update public.agent_verifications set checked_at = now() - interval '10 days', checked_by = null where agent_id = '11111111-1111-1111-1111-111111111111';
create temp table before_check as select checked_at from public.agent_verifications where agent_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select pg_temp.maria(true, false);
insert into results select 'one check is not enough for Verified', public.agent_verified_on('11111111-1111-1111-1111-111111111111') is null, '';
insert into results select 'ticking the ID check stamps its own date and leaves the licence check date alone',
  (select v.id_seen_at is not null and v.id_seen_by = '77777777-7777-7777-7777-777777777777' and v.checked_at = b.checked_at from public.agent_verifications v, before_check b where v.agent_id = '11111111-1111-1111-1111-111111111111'), '';
select pg_temp.maria(true, true);
set local role service_role;
insert into results select 'ID seen and phone confirmed: Verified shows on the page', public.public_agent('maria-santos-dela-cruz') ->> 'verified_on' = to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD'), '';
reset role;
update public.agent_verifications set valid_until = current_date - 1 where agent_id = '11111111-1111-1111-1111-111111111111';
insert into results select 'an expired licence drops Verified', public.agent_verified_on('11111111-1111-1111-1111-111111111111') is null, '';
update public.agent_verifications set valid_until = current_date + 200 where agent_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.maria(false, true);
insert into results select 'unticking a check clears its date and the badge',
  public.agent_verified_on('11111111-1111-1111-1111-111111111111') is null and (select id_seen_at is null from public.agent_verifications where agent_id = '11111111-1111-1111-1111-111111111111'), '';
select pg_temp.maria(true, true);
update public.agent_verifications set checked_at = now() - interval '10 days', checked_by = null,
       id_seen_at = now() - interval '5 days', phone_confirmed_at = now() - interval '5 days' where agent_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.maria(true, true);
insert into results select 'saving again with nothing changed keeps every date',
  (select checked_at < now() - interval '9 days' and id_seen_at < now() - interval '4 days' and phone_confirmed_at < now() - interval '4 days' from public.agent_verifications where agent_id = '11111111-1111-1111-1111-111111111111'), '';
select pg_temp.maria(true, true, true);
insert into results select 'saving a re-check refreshes the licence check date and who checked, and keeps the other two',
  (select checked_at = now() and checked_by = '77777777-7777-7777-7777-777777777777' and id_seen_at < now() - interval '4 days' from public.agent_verifications where agent_id = '11111111-1111-1111-1111-111111111111'), '';
select pg_temp.maria(false, false, false, 'Someone Else');
insert into results select 'a different PRC name or licence number restarts the ID and phone checks',
  public.agent_verified_on('11111111-1111-1111-1111-111111111111') is null
  and (select not id_seen and not phone_confirmed and id_seen_at is null from public.agent_verifications where agent_id = '11111111-1111-1111-1111-111111111111'), '';
update public.agent_verifications set id_seen = true, id_seen_at = now() - interval '5 days', phone_confirmed = true, phone_confirmed_at = now() - interval '5 days'
 where agent_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.maria(true, true);
insert into results select 'checks ticked with a new identity count as fresh checks, dated now',
  (select prc_name = 'Maria Santos Dela Cruz' and id_seen_at = now() and phone_confirmed_at = now() and checked_at = now() from public.agent_verifications where agent_id = '11111111-1111-1111-1111-111111111111'), '';
select pg_temp.as_service();

-- Check an agent --------------------------------------------------------------------------------
set local role service_role;
insert into results select 'the lookup finds a licence number however it is typed', (public.agent_check('0012345') -> 0 ->> 'name') = 'Maria Santos Dela Cruz', public.agent_check('0012345')::text;
insert into results select 'and a contact number shown on a page, with or without +63', (public.agent_check('+63 917 123 4567') -> 0 ->> 'slug') = 'maria-santos-dela-cruz' and (public.agent_check('0917-123-4567') -> 0 ->> 'slug') = 'maria-santos-dela-cruz', '';
insert into results select 'it says when the agent is Verified', (public.agent_check('0012345') -> 0 ->> 'verified_on') is not null, '';
insert into results select 'an account phone that is not on a page finds nothing', public.agent_check('0999 888 7777') = '[]'::jsonb, '';
insert into results select 'a draft page''s numbers and licence find nothing', public.agent_check('09175550000') = '[]'::jsonb and public.agent_check('0004321') = '[]'::jsonb, '';
insert into results select 'too short to search finds nothing', public.agent_check('123') = '[]'::jsonb, '';
reset role;

-- Track record ----------------------------------------------------------------------------------
insert into public.broker_transactions (id, ref, title, payload, broker_id, created_by) values
  ('pf-d1', 'TX-1', 'Lot sale', '{"stage":"done","doasDate":"2025-03-10","buyerAgentId":"11111111-1111-1111-1111-111111111111","showDeal":true,"listingId":"pf-l1","price":2850000,"buyerName":"Rhea Dizon"}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777'),
  ('pf-d2', 'TX-2', 'House sale', '{"stage":"doas","doasDate":"2026-01-05","sellerAgentId":"11111111-1111-1111-1111-111111111111","price":4600000}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777'),
  ('pf-d3', 'TX-3', 'Open deal', '{"stage":"cts","buyerAgentId":"11111111-1111-1111-1111-111111111111"}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777');
insert into x select public.agent_record('11111111-1111-1111-1111-111111111111');
insert into results select 'closed deals are counted by side, from the first closing month',
  (select v ->> 'deals' = '2' and v ->> 'buyer' = '1' and v ->> 'seller' = '1' and v ->> 'since' = '2025-03' from x), (select v::text from x);
insert into results select 'only the deal the client agreed to show is listed, with no price and no names',
  (select jsonb_array_length(v -> 'rows') = 1 and v -> 'rows' -> 0 ->> 'town' = 'Lipa City' and v -> 'rows' -> 0 ->> 'side' = 'buyer' and not (v -> 'rows' -> 0 ? 'price') and v::text not like '%Rhea%' from x), (select v::text from x);
delete from x;
update public.broker_transactions set payload = payload || '{"showPrice":true}' where id = 'pf-d1';
insert into results select 'its price shows only when the client agreed to that too', (public.agent_record('11111111-1111-1111-1111-111111111111') -> 'rows' -> 0 ->> 'price')::numeric = 2850000, '';
set local role service_role;
insert into results select 'the public page carries the record', (public.public_agent('maria-santos-dela-cruz') -> 'record' ->> 'deals') = '2', '';
reset role;
set local role service_role;
insert into x select public.public_agents();
reset role;
insert into results select 'directory cards show deals with their first month, and leave zero counts out',
  (select bool_and(case when e ->> 'slug' = 'maria-santos-dela-cruz' then e ->> 'deals' = '2' and e ->> 'deals_since' = '2025-03' and not (e ? 'review_count')
                        else not (e ? 'deals') and not (e ? 'deals_since') and not (e ? 'review_count') end) from x, jsonb_array_elements(v -> 'agents') e), (select v::text from x);
delete from x;
-- A broker writes their own deals from the app: crediting another team's agent, or using another
-- team's listing, counts for nothing.
insert into public.broker_transactions (id, ref, title, payload, broker_id, created_by) values
  ('pf-d4', 'TX-4', 'Made up', '{"stage":"done","buyerAgentId":"11111111-1111-1111-1111-111111111111","sellerAgentId":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","showDeal":true,"listingId":"pf-l1","price":123,"showPrice":true}', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
insert into results select 'a broker cannot credit another team''s agent', (public.agent_record('11111111-1111-1111-1111-111111111111') ->> 'deals')::int = 2, '';
insert into results select 'nor show another team''s listing on their own record',
  (select v ->> 'deals' = '1' and not (v -> 'rows' -> 0 ? 'town') and not (v -> 'rows' -> 0 ? 'lot_sqm') from (select public.agent_record('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') v) y),
  public.agent_record('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')::text;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
insert into results select 'and no review link comes from such a deal', pg_temp.fails($q$select public.review_invite('pf-d4', '11111111-1111-1111-1111-111111111111')$q$) like 'error: That agent is not%', '';
select pg_temp.as_service();

-- Reviews ---------------------------------------------------------------------------------------
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
insert into results select 'no review link for an open deal', pg_temp.fails($q$select public.review_invite('pf-d3', '11111111-1111-1111-1111-111111111111')$q$) like 'error: Reviews are for closed deals only%', '';
insert into results select 'nor for an agent who was not on the deal', pg_temp.fails($q$select public.review_invite('pf-d1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$q$) like 'error: That agent is not%', '';
insert into tok select public.review_invite('pf-d1', '11111111-1111-1111-1111-111111111111');
insert into results select 'the office gets a long secret link; only its hash is kept',
  (select length(t) = 64 and t ~ '^[0-9a-f]+$' from tok) and (select count(*) = 1 from public.agent_reviews r, tok where r.token_hash = encode(sha256(convert_to(tok.t, 'UTF8')), 'hex') and r.token_hash <> tok.t), '';
select pg_temp.as_service();
set local role service_role;
insert into x select public.review_lookup((select encode(sha256(convert_to(t, 'UTF8')), 'hex') from tok));
insert into results select 'the form knows whose review it is and that the link is open', (select v ->> 'agent' = 'Maria Santos Dela Cruz' and (v ->> 'open')::boolean from x), (select v::text from x);
delete from x;
insert into results select 'a review needs a first name and at least a sentence',
  pg_temp.fails($q$select public.review_submit((select encode(sha256(convert_to(t, 'UTF8')), 'hex') from tok), 'Rhea', 'D', 'Good')$q$) like 'error: Write your first name%', '';
insert into results select 'a proper review is accepted',
  public.review_submit((select encode(sha256(convert_to(t, 'UTF8')), 'hex') from tok), ' Rhea ', 'dizon', 'Maria did the viewing on video and sent the title before we paid anything.'), '';
insert into results select 'the link works once', public.review_submit((select encode(sha256(convert_to(t, 'UTF8')), 'hex') from tok), 'X', 'Y', 'Another review from the same link, long enough.') = false, '';
insert into results select 'nothing shows until a Super Admin approves it', jsonb_array_length(public.public_agent('maria-santos-dela-cruz') -> 'reviews') = 0, '';
reset role;
insert into results select 'the review keeps first name and initial, and the town and month come from the deal',
  (select client_label = 'Rhea D.' and town = 'Lipa City' and month = '2025-03' and status = 'submitted' from public.agent_reviews where deal_id = 'pf-d1'), (select row_to_json(r)::text from public.agent_reviews r where deal_id = 'pf-d1');
create temp table rid as select id from public.agent_reviews where deal_id = 'pf-d1';
grant all on rid to authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
insert into results select 'an agent cannot approve their own review', pg_temp.fails(format($q$select public.review_moderate(%L, 'approved')$q$, (select id from rid))) = 'refused', '';
insert into results select 'nor see it before it is published', jsonb_array_length(public.agent_site_reviews()) = 0, '';
insert into results select 'the reviews table cannot be read from the app at all (so nor the link''s hash)',
  pg_temp.fails($q$select token_hash from public.agent_reviews$q$) = 'refused' and pg_temp.fails($q$select id from public.agent_reviews$q$) = 'refused', '';
reset role;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select public.review_moderate((select id from public.agent_reviews where deal_id = 'pf-d1'), 'approved');
set local role service_role;
insert into x select public.public_agent('maria-santos-dela-cruz');
reset role;
insert into results select 'an approved review shows on the page, with no stars',
  (select jsonb_array_length(v -> 'reviews') = 1 and v -> 'reviews' -> 0 ->> 'label' = 'Rhea D.' and v::text not like '%star%' and v::text not like '%rating%' from x), (select (v -> 'reviews')::text from x);
delete from x;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
insert into results select 'the agent sees their published review to reply', jsonb_array_length(public.agent_site_reviews()) = 1, '';
select public.review_reply((select id from public.agent_reviews where deal_id = 'pf-d1'), 'Thank you, Rhea!');
insert into results select 'and may reply once', pg_temp.fails($q$select public.review_reply((select id from public.agent_reviews where deal_id = 'pf-d1'), 'Again')$q$) like 'error: You can reply once%', '';
insert into results select 'the reply shows under the review', public.agent_reviews_public('11111111-1111-1111-1111-111111111111') -> 0 ->> 'reply' = 'Thank you, Rhea!', '';
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
insert into results select 'a used link cannot be renewed', pg_temp.fails($q$select public.review_invite('pf-d1', '11111111-1111-1111-1111-111111111111')$q$) like 'error: This client has already sent%', '';
delete from tok;
insert into tok select public.review_invite('pf-d2', '11111111-1111-1111-1111-111111111111');
update public.agent_reviews set expires_at = now() - interval '1 minute' where deal_id = 'pf-d2';
select pg_temp.as_service();
set local role service_role;
insert into results select 'an expired link says so and takes no review',
  public.review_lookup((select encode(sha256(convert_to(t, 'UTF8')), 'hex') from tok)) ->> 'status' = 'expired'
  and public.review_submit((select encode(sha256(convert_to(t, 'UTF8')), 'hex') from tok), 'Jun', 'M', 'A review that is long enough to count here.') = false, '';
reset role;
update public.broker_transactions set payload = payload || '{"stage":"cts"}' where id = 'pf-d1';
insert into results select 'a review stops showing when its deal is no longer closed', jsonb_array_length(public.agent_reviews_public('11111111-1111-1111-1111-111111111111')) = 0, '';
update public.broker_transactions set payload = payload || '{"stage":"done"}' where id = 'pf-d1';

-- Town routing ----------------------------------------------------------------------------------
insert into public.site_settings (key, value, is_public) values ('leadRouting',
  '{"enabled":true,"brokers":["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],"next":0,"towns":{"lipa-city":["11111111-1111-1111-1111-111111111111"]}}', false)
  on conflict (key) do update set value = excluded.value;
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('pf-vg1', 'V1', 'Value Guide Lipa', '{"status":"new","phone":"0911 000 0001","fullReport":{"inputs":{"municipality":"LIPA CITY"}}}', '77777777-7777-7777-7777-777777777777'),
  ('pf-vg2', 'V2', 'Value Guide Malvar', '{"status":"new","phone":"0911 000 0002","fullReport":{"inputs":{"municipality":"MALVAR"}}}', '77777777-7777-7777-7777-777777777777');
insert into public.crm_leads (id, ref, name, payload, created_by, assigned_to_id, assigned_to) values
  ('pf-vg3', 'V3', 'From an agent page', '{"status":"new","phone":"0911 000 0003","fullReport":{"inputs":{"municipality":"LIPA CITY"}}}', '77777777-7777-7777-7777-777777777777', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Beatriz Lim');
insert into results select 'a Value Guide lead for a town with a rule goes to that town''s agent',
  (select assigned_to_id = '11111111-1111-1111-1111-111111111111' and payload::text like '%town rule%' from public.crm_leads where id = 'pf-vg1'), (select payload::text from public.crm_leads where id = 'pf-vg1');
insert into results select 'a town without a rule falls back to the brokers taking turns',
  (select assigned_to_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and payload::text like '%in turn%' from public.crm_leads where id = 'pf-vg2'), '';
insert into results select 'a lead sent from an agent''s page stays with that agent', (select assigned_to_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' from public.crm_leads where id = 'pf-vg3'), '';
insert into results select 'the turn is remembered per town', (select (value -> 'townNext' ->> 'lipa-city')::int = 1 and (value ->> 'next')::int = 1 from public.site_settings where key = 'leadRouting'), (select value::text from public.site_settings where key = 'leadRouting');
insert into public.crm_leads (id, ref, name, payload, created_by) values
  ('pf-vg4', 'V4', 'Broker consultation Lipa', '{"status":"new","phone":"0911 000 0004","channel":"broker-consultation","fullReport":{"inputs":{"municipality":"LIPA CITY"}}}', '77777777-7777-7777-7777-777777777777'),
  ('pf-vg5', 'V5', 'Not a Value Guide lead', '{"status":"new","phone":"0911 000 0005","town":"Lipa City"}', '77777777-7777-7777-7777-777777777777');
insert into results select 'a broker consultation never goes to a salesperson by town rule',
  (select assigned_to_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and payload::text like '%in turn%' from public.crm_leads where id = 'pf-vg4'), (select payload::text from public.crm_leads where id = 'pf-vg4');
insert into results select 'town rules apply only to Value Guide requests', (select payload::text like '%in turn%' from public.crm_leads where id = 'pf-vg5'), '';

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
