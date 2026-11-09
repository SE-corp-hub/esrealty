\set ON_ERROR_STOP 1
-- Website upgrades (supabase/migrations/0022): price-change history, the office-checked flag, the two
-- new catalog columns and saved searches with their daily job. Rolls back.
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

-- Two published listings by the approved agent, one week old.
insert into public.shared_listings (id, title, owner_id, payload, is_published, offer_type, price, rent, city, province, property_type, bedrooms, status)
values ('lst-up-1', 'Corner house near school', '11111111-1111-1111-1111-111111111111', '{}', true, 'sale', 5000000, 0, 'Lipa City', 'Batangas', 'house-and-lot', 3, 'available'),
       ('lst-up-2', 'Studio for rent', '11111111-1111-1111-1111-111111111111', '{"officeChecked": true}', true, 'rent', 0, 12000, 'Batangas City', 'Batangas', 'condominium', 1, 'available');
update public.shared_listings set published_at = now() - interval '7 days' where id in ('lst-up-1', 'lst-up-2');

-- 1. Price changes
update public.shared_listings set price = 4500000 where id = 'lst-up-1';
insert into results select 'a price cut is kept with the old and new price',
  exists (select 1 from public.listing_price_changes where listing_id = 'lst-up-1' and old_price = 5000000 and new_price = 4500000), '';
update public.shared_listings set title = 'Corner house near the school' where id = 'lst-up-1';
insert into results select 'a change that is not the price adds nothing',
  (select count(*) from public.listing_price_changes where listing_id = 'lst-up-1') = 1, '';
update public.shared_listings set rent = 11000 where id = 'lst-up-2';
insert into results select 'a rent change on a rental is kept',
  exists (select 1 from public.listing_price_changes where listing_id = 'lst-up-2' and old_price = 12000 and new_price = 11000 and offer_type = 'rent'), '';
insert into results select 'catalog: previous_price shows the higher price before the cut',
  (select previous_price from public.public_listing_catalog where id = 'lst-up-1') = 5000000, '';
update public.shared_listings set price = 5200000 where id = 'lst-up-1';
insert into results select 'catalog: no previous_price after the price goes up again',
  (select previous_price from public.public_listing_catalog where id = 'lst-up-1') is null, '';
insert into results select 'catalog: office_checked reads the payload flag',
  (select office_checked from public.public_listing_catalog where id = 'lst-up-2') = true
  and (select office_checked from public.public_listing_catalog where id = 'lst-up-1') = false, '';

set local role anon;
select pg_temp.as_user('');
insert into results select 'visitor: cannot read the price-change table directly',
  pg_temp.fails($q$select 1 from public.listing_price_changes limit 1$q$) like 'refused: permission denied%', '';
insert into results select 'visitor: the catalog still reads with the new columns',
  pg_temp.fails($q$select office_checked, previous_price from public.public_listing_catalog limit 1$q$) = 'ran', '';
insert into results select 'visitor: no saved searches',
  pg_temp.fails($q$select 1 from public.saved_searches limit 1$q$) like 'refused: permission denied%', '';
insert into results select 'visitor: cannot run the daily job',
  pg_temp.fails($q$select * from public.saved_search_sweep(false)$q$) like 'refused: permission denied%', '';
reset role;

-- 4. Saved searches (saved by the listing function with the server key)
insert into public.saved_searches (id, user_id, label, filters, last_checked_at) values
  ('d0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Lipa house & lot', '{"city":"Lipa","property_type":"house-and-lot","max_price":"6000000"}', now() - interval '8 days'),
  ('d0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Lipa under 3M', '{"city":"Lipa","max_price":"3000000"}', now() - interval '8 days'),
  ('d0000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555555', 'Checked rentals', '{"offer_type":"rent","checked":"true","q":"studio"}', now() - interval '8 days');

set local role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
insert into results select 'buyer: sees only their own saved searches',
  (select count(*) from public.saved_searches) = 2, '';
insert into results select 'buyer: cannot add a saved search directly',
  pg_temp.fails($q$insert into public.saved_searches (user_id, filters) values (auth.uid(), '{}')$q$) like 'refused: permission denied%', '';
insert into results select 'buyer: cannot delete someone else''s',
  (select count(*) from (select 1) x where pg_temp.fails($q$delete from public.saved_searches where id = 'd0000000-0000-0000-0000-000000000003'$q$) = 'ran') = 1, '';
reset role;
insert into results select 'buyer''s delete of another person''s search changed nothing',
  exists (select 1 from public.saved_searches where id = 'd0000000-0000-0000-0000-000000000003'), '';

insert into results select 'dry run: counts matches and changes nothing',
  (select string_agg(search_id::text || '=' || matches, ',' order by search_id) from public.saved_search_sweep(true))
    = 'd0000000-0000-0000-0000-000000000001=1,d0000000-0000-0000-0000-000000000002=0,d0000000-0000-0000-0000-000000000003=1'
  and not exists (select 1 from public.notifications where title like '%saved search%' or title like 'New listing%'),
  (select string_agg(search_id::text || '=' || matches, ',') from public.saved_search_sweep(true));

create temp table sweep as select * from public.saved_search_sweep(false);
insert into results select 'send: one bell notification per matching search',
  (select count(*) from public.notifications where user_id = '22222222-2222-2222-2222-222222222222' and title = 'New listing for Lipa house & lot') = 1
  and (select count(*) from public.notifications where user_id = '55555555-5555-5555-5555-555555555555' and title = 'New listing for Checked rentals') = 1, '';
insert into results select 'send: the body names the newest listing and its price',
  exists (select 1 from public.notifications where title = 'New listing for Lipa house & lot' and body like 'Newest: Corner house near the school in Lipa City, P5,200,000.%'), '';
insert into results select 'send: a search with no match gets nothing',
  not exists (select 1 from public.notifications where title like '%Lipa under 3M%'), '';
insert into results select 'send: a second run the same day sends nothing new',
  (select count(*) from public.saved_search_sweep(false) where alerted) = 0, '';

delete from auth.users where id = '55555555-5555-5555-5555-555555555555';
insert into results select 'a deleted account takes its saved searches with it',
  not exists (select 1 from public.saved_searches where id = 'd0000000-0000-0000-0000-000000000003'), '';

select (case when ok then 'PASS ' else 'FAIL ' end) || name || case when ok then '' else '  ' || coalesce(detail, '') end from results;
select (select count(*) filter (where ok) from results) || '/' || (select count(*) from results) || ' passed';
rollback;
