\set ON_ERROR_STOP 1
-- Agent websites, Phase 1 (supabase/migrations/0015): licence checks, pages, counts. Rolls back.
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

-- An agent under Broker Alpha, with a personal phone that must never reach a page.
update public.profiles set full_name = 'Maria Santos', broker = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', phone = '0999 888 7777'
 where id = '11111111-1111-1111-1111-111111111111';
insert into public.shared_listings (id, owner_id, title, status, is_published, published_at, offer_type, price, city) values
  ('as-l1', '11111111-1111-1111-1111-111111111111', 'Corner lot in Sabang', 'available', true, now(), 'sale', 2850000, 'Lipa City'),
  ('as-l2', '11111111-1111-1111-1111-111111111111', 'Draft house', 'available', false, null, 'sale', 1, 'Lipa City'),
  ('as-l3', '11111111-1111-1111-1111-111111111111', 'Sold house', 'sold', true, now(), 'sale', 1, 'Lipa City');

-- Licence checks: Super Admins only -----------------------------------------------------------
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
insert into results select 'an agent cannot record their own licence check',
  pg_temp.fails($q$insert into public.agent_verifications (agent_id, licence_type, licence_no, prc_name, valid_until, broker_accepted) values ('11111111-1111-1111-1111-111111111111', 'salesperson', '0012345', 'Maria Santos', '2030-01-01', true)$q$) = 'refused', '';
reset role;

select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
set local role authenticated;
-- Saved through licence_check_save (0018); since 0019 that is the only way in from the app.
select public.licence_check_save('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  jsonb_build_object('licence_type', 'broker', 'licence_no', ' 0004321 ', 'prc_name', 'Alfredo B. Reyes', 'valid_until', current_date + 300));
select public.licence_check_save('11111111-1111-1111-1111-111111111111',
  jsonb_build_object('licence_type', 'salesperson', 'licence_no', '0012345', 'prc_name', 'Maria Santos Dela Cruz', 'valid_until', current_date + 200, 'broker_accepted', true));
reset role;
insert into results select 'a Super Admin records a check; who and when are stamped',
  (select checked_by = '77777777-7777-7777-7777-777777777777' and licence_no = '0004321' from public.agent_verifications where agent_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '';

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
insert into results select 'an agent reads only their own licence check',
  (select count(*) = 1 and bool_and(agent_id = '11111111-1111-1111-1111-111111111111') from public.agent_verifications), '';
insert into results select 'an agent cannot change their licence check',
  (select count(*) from (select 1 from public.agent_verifications) q) = 1
  and pg_temp.fails($q$update public.agent_verifications set valid_until = '2040-01-01' where agent_id = '11111111-1111-1111-1111-111111111111'$q$) = 'refused'
  and (select valid_until < '2040-01-01' from public.agent_verifications), '';
insert into results select 'visitors and signed-in users cannot call public_agent', pg_temp.fails($q$select public.public_agent('x')$q$) = 'refused', '';
insert into results select 'nor count page views', pg_temp.fails($q$select public.agent_page_count('11111111-1111-1111-1111-111111111111', 'view')$q$) = 'refused', '';

-- My website: open, save (cleaned), publish ---------------------------------------------------
insert into x select public.agent_site_open();
insert into results select 'opening My website makes the page, with nothing in the way',
  (select v -> 'blockers' = '[]'::jsonb and v ->> 'slug' is null and v ->> 'published_at' is null from x), (select v::text from x);
insert into results select 'the preview uses the name on the licence check and the role label',
  (select v -> 'preview' ->> 'name' = 'Maria Santos Dela Cruz' and v -> 'preview' ->> 'role_label' = 'PRC-accredited real estate salesperson'
      and v -> 'preview' -> 'broker' ->> 'name' = 'Alfredo B. Reyes' and v -> 'preview' -> 'broker' ->> 'licence_no' = '0004321' from x), (select (v -> 'preview')::text from x);
delete from x;

insert into x select public.agent_site_save('{"pitch":"Lots and homes in Lipa and Malvar, with clean papers. Extra words to go past the limit, and then some more words to make sure this is longer than one hundred and sixty characters.",
  "bio":"Born in Lipa.", "towns":["lipa-city","malvar","Manila"], "needs":["buy","fly"], "languages":["filipino","klingon"],
  "contacts":{"call":"0917 123 4567","viber":"+63 917 123 4567","whatsapp":"12","messenger":"maria.santos.realty","email":"x@y.z"},
  "photo":"http://evil.example/a.jpg", "accent":"neon", "sections":["listings","about","reviews"], "featured":["as-l1","bad id!"], "phone":"0999 888 7777"}');
insert into results select 'saving keeps only known fields and values',
  (select v -> 'draft' -> 'towns' = '["lipa-city","malvar"]'::jsonb and v -> 'draft' -> 'needs' = '["buy"]'::jsonb
      and v -> 'draft' -> 'languages' = '["filipino"]'::jsonb and v -> 'draft' -> 'sections' = '["about","listings"]'::jsonb
      and v -> 'draft' -> 'featured' = '["as-l1"]'::jsonb and not (v -> 'draft' ? 'phone') from x), (select (v -> 'draft')::text from x);
insert into results select 'phone numbers become +63, bad ones are dropped, and only safe photo addresses are kept',
  (select v -> 'draft' -> 'contacts' = '{"call":"+639171234567","viber":"+639171234567","messenger":"maria.santos.realty"}'::jsonb
      and v -> 'draft' ->> 'photo' = '' and v -> 'draft' ->> 'accent' = 'rust' and length(v -> 'draft' ->> 'pitch') = 160 from x), (select (v -> 'draft' -> 'contacts')::text from x);
delete from x;

insert into results select 'an agent cannot publish by writing the table directly',
  pg_temp.fails($q$update public.agent_sites set published_at = now(), data = draft$q$) = 'ran'
  and (select published_at is null from public.agent_sites where agent_id = '11111111-1111-1111-1111-111111111111'), '';

select public.agent_site_save('{"pitch":"Hi"}');
insert into results select 'a page with no way to contact the agent cannot be published',
  pg_temp.fails($q$select public.agent_site_publish()$q$) like 'error: %Add at least one way to contact you.%', '';
select public.agent_site_save('{"pitch":"Lots and homes in Lipa","towns":["lipa-city"],"contacts":{"call":"0917 123 4567"},"sections":["listings","about"],"featured":["as-l1"]}');
insert into x select public.agent_site_publish();
insert into results select 'publishing makes the address from the name on the licence check',
  (select v ->> 'slug' = 'maria-santos-dela-cruz' and v ->> 'published_at' is not null and (v ->> 'unpublished_changes')::boolean = false from x), (select v::text from x);
delete from x;
reset role;

-- What visitors get ----------------------------------------------------------------------------
select pg_temp.as_service();
set local role service_role;
insert into x select public.public_agent('Maria-Santos-Dela-Cruz ');
reset role;
insert into results select 'the public page has the licence, the chosen contact and the available listings only',
  (select v ->> 'name' = 'Maria Santos Dela Cruz' and v -> 'licence' ->> 'no' = '0012345' and v -> 'contacts' ->> 'call' = '+639171234567'
      and jsonb_array_length(v -> 'listings') = 1 and v -> 'listings' -> 0 ->> 'id' = 'as-l1' and (v ->> 'listing_count')::int = 1 from x), (select v::text from x);
insert into results select 'nothing private reaches the public page',
  (select v::text not like '%0999%' and v::text not like '%agent@x.ph%' and not (v ? 'featured') and not (v ? 'published_at')
      and not (v -> 'listings' -> 0 ? 'pos') from x), (select v::text from x);
insert into results select 'no reply time before 5 measured leads', (select v -> 'reply' = 'null'::jsonb from x), '';
delete from x;

-- Draft changes wait for Publish.
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
insert into x select public.agent_site_save('{"pitch":"New words","contacts":{"call":"0917 123 4567"}}');
reset role;
insert into results select 'a saved change is a draft until published', (select (v ->> 'unpublished_changes')::boolean from x), '';
delete from x;
set local role service_role;
insert into results select 'visitors still see the published words', (select public.public_agent('maria-santos-dela-cruz') ->> 'pitch') = 'Lots and homes in Lipa', '';
insert into results select 'an unknown address finds nothing', public.public_agent('nobody') is null, '';
reset role;

-- The page disappears when a condition stops holding.
update public.agent_verifications set valid_until = current_date - 1 where agent_id = '11111111-1111-1111-1111-111111111111';
set local role service_role;
insert into results select 'an expired licence takes the page down', public.public_agent('maria-santos-dela-cruz') is null, '';
reset role;
insert into results select 'and tells the agent why', 'Your licence has expired. Ask our office to record the renewal.' = any(public.agent_page_blockers('11111111-1111-1111-1111-111111111111')), '';
update public.agent_verifications set valid_until = current_date + 200 where agent_id = '11111111-1111-1111-1111-111111111111';
update public.agent_verifications set valid_until = current_date - 1 where agent_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set local role service_role;
insert into results select 'an expired supervising broker takes the page down too', public.public_agent('maria-santos-dela-cruz') is null, '';
reset role;
update public.agent_verifications set valid_until = current_date + 300 where agent_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.agent_verifications set broker_accepted = false where agent_id = '11111111-1111-1111-1111-111111111111';
insert into results select 'a salesperson needs the broker''s acceptance on record',
  'Our office has not recorded that your supervising broker accepted you.' = any(public.agent_page_blockers('11111111-1111-1111-1111-111111111111')), '';
update public.agent_verifications set broker_accepted = true where agent_id = '11111111-1111-1111-1111-111111111111';
update public.profiles set registration_status = 'rejected' where id = '11111111-1111-1111-1111-111111111111';
set local role service_role;
insert into results select 'revoked access takes the page down', public.public_agent('maria-santos-dela-cruz') is null, '';
reset role;
update public.profiles set registration_status = 'approved' where id = '11111111-1111-1111-1111-111111111111';
set local role service_role;
insert into results select 'and it comes back when everything holds again', public.public_agent('maria-santos-dela-cruz') is not null, '';
reset role;

-- The same name gets its own address; a broker's page uses the broker label.
insert into public.agent_sites (agent_id, slug) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', null);
insert into public.agent_verifications (agent_id, licence_type, licence_no, prc_name, valid_until) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'broker', '0007777', 'Maria Santos Dela Cruz', current_date + 100);
select pg_temp.as_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
set local role authenticated;
select public.agent_site_save('{"contacts":{"viber":"09181112222"}}');
insert into x select public.agent_site_publish();
reset role;
insert into results select 'the same name gets its own address',
  (select v ->> 'slug' = 'maria-santos-dela-cruz-2' and v -> 'preview' ->> 'role_label' = 'Real estate broker' and v -> 'preview' -> 'broker' = 'null'::jsonb from x), (select v::text from x);
delete from x;

-- Others cannot have a page.
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
set local role authenticated;
insert into results select 'a buyer cannot open My website', pg_temp.fails($q$select public.agent_site_open()$q$) = 'refused', '';
reset role;

-- Counts and reply time -------------------------------------------------------------------------
select pg_temp.as_service();
set local role service_role;
select public.agent_page_count('11111111-1111-1111-1111-111111111111', 'view');
select public.agent_page_count('11111111-1111-1111-1111-111111111111', 'view');
select public.agent_page_count('11111111-1111-1111-1111-111111111111', 'viber');
reset role;
insert into results select 'only known kinds can be counted',
  pg_temp.fails($q$select public.agent_page_count('11111111-1111-1111-1111-111111111111', 'hack')$q$) like 'error:%', '';

insert into public.crm_leads (id, ref, name, payload, created_by, assigned_to_id, created_at)
  select 'as-r' || g, 'R' || g, 'Lead ' || g, '{"status":"new","channel":"agent-page"}', '77777777-7777-7777-7777-777777777777',
         '11111111-1111-1111-1111-111111111111', now() - interval '20 minutes'
    from generate_series(1, 5) g;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
update public.crm_leads set payload = payload || '{"status":"contacted"}' where id in ('as-r1', 'as-r2', 'as-r3', 'as-r4');
insert into results select 'four measured leads are not enough for a reply time', public.agent_reply_bucket('11111111-1111-1111-1111-111111111111') is null, '';
update public.crm_leads set payload = payload || '{"status":"contacted"}' where id = 'as-r5';
insert into results select 'five measured leads give a typical reply time', public.agent_reply_bucket('11111111-1111-1111-1111-111111111111') = 'within 30 minutes', coalesce(public.agent_reply_bucket('11111111-1111-1111-1111-111111111111'), 'null');
insert into public.crm_leads (id, ref, name, payload, created_by, assigned_to_id, created_at)
  select 'as-u' || g, 'U' || g, 'Ignored ' || g, '{"status":"new"}', '77777777-7777-7777-7777-777777777777',
         '11111111-1111-1111-1111-111111111111', now() - interval '3 days'
    from generate_series(1, 6) g;
-- 0016 says this plainly ("in more than a day"); 0015 alone left it out.
insert into results select 'leads left in New for over a day count against the reply time', coalesce(public.agent_reply_bucket('11111111-1111-1111-1111-111111111111'), 'in more than a day') = 'in more than a day', coalesce(public.agent_reply_bucket('11111111-1111-1111-1111-111111111111'), 'null');

set local role authenticated;
insert into x select public.agent_site_open();
reset role;
insert into results select 'My website shows this month''s views, taps and messages',
  (select (v -> 'month' ->> 'view')::int = 2 and (v -> 'month' ->> 'viber')::int = 1 and (v ->> 'month_leads')::int = 5 from x), (select v::text from x);
delete from x;

set local role authenticated;
insert into x select public.agent_site_unpublish();
reset role;
set local role service_role;
insert into results select 'unpublishing takes the page down', public.public_agent('maria-santos-dela-cruz') is null, '';
reset role;

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
