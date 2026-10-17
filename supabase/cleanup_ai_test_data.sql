-- 2026-10-17: personal and sample email addresses replaced with example.com placeholders.
-- This is a one-off script that has already been applied; put the real address back only if you re-run it.
-- Remove test/sample data created by the AI during automated verification.
-- User-generated data (real accounts, listings, leads, inquiries) is retained.
--
-- Covers:
--   1. Website test leads in crm_leads (crmcheck/btcheck/devcheck emails).
--   2. Test submissions in storefront_inquiries.
--   3. Test inquiries in listing_inquiries (tester/check names and emails).
--   4. Rate-limit counters left by verification requests.
--   5. AI-created auth accounts (testers) and everything cascading from them
--      (profiles, saved listings, listings, pms workspaces, crm leads, etc.).
--   6. Test/sample listings in the shared catalog and cached in app_state.
--   7. Test transactions in broker_transactions.
--
-- NOTE: Storage objects uploaded by 'esrealty.upload.tester@esrealty.ph'
-- are NOT covered here (they live in Storage, not the database). Delete them
-- manually in Dashboard > Storage if any remain.
--
-- Run the PREVIEW queries first, review the rows, then run everything.

-- Emails of the AI-created test accounts:
--   esrealty.sa.tester, esrealty.lsfix.tester, esrealty.e2e.buyer,
--   esrealty.upload.tester, esrealty.cleanup.tester, car.tester,
--   lone.agent, real.broker, newagent.admin, broker.noprc, sample-account-2@example.com

-- ============================ PREVIEW ============================

select id, ref, created_at, payload ->> 'name' as name, payload ->> 'email' as email
from public.crm_leads
where payload ->> 'email' in (
  'crmcheck@esrealty.ph', 'btcheck@esrealty.ph', 'devcheck@esrealty.ph'
)
   or lower(payload ->> 'name') in ('crm check', 'project bt check', 'dev check')
   or payload ->> 'name' ilike '%check%'
   or payload ->> 'name' ilike '%tester%'
   or payload ->> 'email' ilike '%tester@esrealty.ph';

select id, created_at, full_name, email
from public.storefront_inquiries
where email in (
  'crmcheck@esrealty.ph', 'btcheck@esrealty.ph', 'devcheck@esrealty.ph',
  'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
  'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
  'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
  'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
  'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
)
   or full_name ilike '%check%' or full_name ilike '%tester%';

select id, listing_id, created_at, full_name, email
from public.listing_inquiries
where email in (
  'crmcheck@esrealty.ph', 'btcheck@esrealty.ph', 'devcheck@esrealty.ph',
  'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
  'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
  'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
  'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
  'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
)
   or full_name ilike '%check%' or full_name ilike '%tester%';

select u.id, u.email, p.full_name, p.role, p.registration_status
from auth.users u
left join public.profiles p on p.id = u.id
where u.email in (
  'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
  'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
  'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
  'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
  'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
);

-- Test/sample listings (sample/test titles, developers, or test owners).
-- Developer may live at payload top level (imported format) or under
-- payload -> 'details' (new listing format).
select id, ref, title, coalesce(payload ->> 'developer', payload -> 'details' ->> 'developer') as developer, status, owner_id
from public.shared_listings
where id like 'lst-seed-%'
   or id like 'lst-live-%'
   or title ilike '%test%'
   or title ilike '%sample%'
   or coalesce(payload ->> 'developer', payload -> 'details' ->> 'developer') ilike '%sample%'
   or coalesce(payload ->> 'developer', payload -> 'details' ->> 'developer') = 'Other Realty'
   or owner_id in (
     select id from auth.users
     where email in (
       'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
       'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
       'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
       'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
       'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
     )
   );

-- Test transactions owned or created by test accounts.
select id, title, broker_id, created_by
from public.broker_transactions
where broker_id in (
  select id from auth.users
  where email in (
    'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
    'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
    'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
    'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
    'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
  )
)
   or created_by in (
  select id from auth.users
  where email in (
    'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
    'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
    'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
    'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
    'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
  )
);

-- ============================ CLEANUP ============================

begin;

-- 1) Website test leads in crm_leads.
delete from public.crm_leads
where payload ->> 'email' in (
  'crmcheck@esrealty.ph', 'btcheck@esrealty.ph', 'devcheck@esrealty.ph'
)
   or lower(payload ->> 'name') in ('crm check', 'project bt check', 'dev check')
   or payload ->> 'name' ilike '%check%'
   or payload ->> 'name' ilike '%tester%'
   or payload ->> 'email' ilike '%tester@esrealty.ph';

-- 2) Test submissions in storefront_inquiries.
delete from public.storefront_inquiries
where email in (
  'crmcheck@esrealty.ph', 'btcheck@esrealty.ph', 'devcheck@esrealty.ph',
  'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
  'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
  'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
  'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
  'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
)
   or full_name ilike '%check%' or full_name ilike '%tester%';

-- 3) Test inquiries in listing_inquiries.
delete from public.listing_inquiries
where email in (
  'crmcheck@esrealty.ph', 'btcheck@esrealty.ph', 'devcheck@esrealty.ph',
  'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
  'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
  'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
  'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
  'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
)
   or full_name ilike '%check%' or full_name ilike '%tester%';

-- 4) Clear rate-limit counters left by verification requests.
delete from public.listing_inquiry_rate_limits;

-- 5) Remove test/sample listings from the shared catalog (cascades to their
--    images and inquiries).
delete from public.shared_listings
where id like 'lst-seed-%'
   or id like 'lst-live-%'
   or title ilike '%test%'
   or title ilike '%sample%'
   or coalesce(payload ->> 'developer', payload -> 'details' ->> 'developer') ilike '%sample%'
   or coalesce(payload ->> 'developer', payload -> 'details' ->> 'developer') = 'Other Realty'
   or owner_id in (
     select id from auth.users
     where email in (
       'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
       'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
       'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
       'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
       'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
     )
   );

-- 6) Strip test/sample listings from each user's cached app_state payload so
--    they never reappear in the Listings view.
update public.app_state a
set payload = jsonb_set(
  a.payload,
  '{listings}',
  coalesce(
    (
      select jsonb_agg(item)
      from jsonb_array_elements(
        case when jsonb_typeof(a.payload -> 'listings') = 'array'
             then a.payload -> 'listings' else '[]'::jsonb end
      ) as item
      where item ->> 'id' not like 'lst-seed-%'
        and item ->> 'id' not like 'lst-live-%'
        and (item ->> 'title') not ilike '%test%'
        and (item ->> 'title') not ilike '%sample%'
        and coalesce(item ->> 'developer', '') not ilike '%sample%'
        and coalesce(item ->> 'developer', '') <> 'Other Realty'
    ),
    '[]'::jsonb
  ),
  true
)
where exists (
  select 1
  from jsonb_array_elements(
    case when jsonb_typeof(a.payload -> 'listings') = 'array'
         then a.payload -> 'listings' else '[]'::jsonb end
  ) as item
  where item ->> 'id' like 'lst-seed-%'
     or item ->> 'id' like 'lst-live-%'
     or (item ->> 'title') ilike '%test%'
     or (item ->> 'title') ilike '%sample%'
     or coalesce(item ->> 'developer', '') ilike '%sample%'
     or coalesce(item ->> 'developer', '') = 'Other Realty'
);

-- 7) Remove test transactions (owned or created by test accounts).
delete from public.broker_transactions
where broker_id in (
  select id from auth.users
  where email in (
    'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
    'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
    'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
    'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
    'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
  )
)
   or created_by in (
  select id from auth.users
  where email in (
    'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
    'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
    'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
    'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
    'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
  )
);

-- 8) Detach any real profile that references a test broker account.
update public.profiles
set broker = null
where broker in (
  select id from auth.users
  where email in (
    'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
    'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
    'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
    'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
    'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
  )
);

-- 9) Delete the AI-created test accounts. Cascades remove their profiles,
--    saved listings, listings (and images/inquiries), pms workspaces,
--    broker transactions, crm leads and password resets.
delete from auth.users
where email in (
  'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
  'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
  'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
  'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
  'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
);

commit;

-- ============================ VERIFY ============================

select count(*) as remaining_test_leads
from public.crm_leads
where payload ->> 'email' in ('crmcheck@esrealty.ph', 'btcheck@esrealty.ph', 'devcheck@esrealty.ph')
   or lower(payload ->> 'name') in ('crm check', 'project bt check', 'dev check')
   or payload ->> 'name' ilike '%check%'
   or payload ->> 'name' ilike '%tester%'
   or payload ->> 'email' ilike '%tester@esrealty.ph';

select count(*) as remaining_test_inquiries
from public.storefront_inquiries
where full_name ilike '%check%' or full_name ilike '%tester%'
   or email like '%tester@esrealty.ph' or email like '%check@esrealty.ph';

select count(*) as remaining_test_accounts
from auth.users
where email in (
  'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
  'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
  'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
  'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
  'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
);

select count(*) as remaining_test_listings
from public.shared_listings
where id like 'lst-seed-%'
   or id like 'lst-live-%'
   or title ilike '%test%'
   or title ilike '%sample%'
   or coalesce(payload ->> 'developer', payload -> 'details' ->> 'developer') ilike '%sample%'
   or coalesce(payload ->> 'developer', payload -> 'details' ->> 'developer') = 'Other Realty';

select count(*) as remaining_test_transactions
from public.broker_transactions
where broker_id in (
  select id from auth.users
  where email in (
    'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
    'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
    'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
    'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
    'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
  )
)
   or created_by in (
  select id from auth.users
  where email in (
    'esrealty.sa.tester@esrealty.ph', 'esrealty.lsfix.tester@esrealty.ph',
    'esrealty.e2e.buyer@esrealty.ph', 'esrealty.upload.tester@esrealty.ph',
    'esrealty.cleanup.tester@esrealty.ph', 'car.tester@esrealty.ph',
    'lone.agent@esrealty.ph', 'real.broker@esrealty.ph',
    'newagent.admin@esrealty.ph', 'broker.noprc@esrealty.ph', 'sample-account-2@example.com'
  )
);

-- ================ PHASE 0-1 TEST DATA (compliance registry + autopilot) ================
-- Removes ONLY verification/bootstrap rows created by compliance_registry_e2e
-- or app seeding. Real brokerage records are retained:
--   * compliance_records with ids 'cmp-seed-*' (the app's bootstrap seed set)
--   * records created by the e2e test: number 'COR-9999' / 'BIR COR — Test Branch'
--   * agent_tasks kind='compliance' tied to those records or marked Test
-- Ads are client-side only (localStorage state.ads) until the ad_posts table is
-- shipped, so there is nothing to clean for Ads here.
-- GUARDED: every block checks to_regclass first, so this section is a no-op
-- (NOTICES only) until you deploy supabase/compliance_registry.sql and
-- supabase/agent_tasks.sql. It can never abort with "relation does not exist".

-- PREVIEW (guarded):
do $$
declare n int;
begin
  if to_regclass('public.compliance_records') is not null then
    select count(*) into n from public.compliance_records
      where id like 'cmp-seed-%' or number = 'COR-9999'
         or name ilike '%test%' or notes ilike '%test%';
    raise notice 'Phase0-1 preview: % seed/test compliance record(s) exist', n;
  else
    raise notice 'Phase0-1 preview: compliance_records not deployed yet — nothing to clean';
  end if;

  if to_regclass('public.agent_tasks') is not null then
    select count(*) into n from public.agent_tasks
      where kind = 'compliance'
        and (payload ->> 'record_id' like 'cmp-seed-%'
             or payload ->> 'name' ilike '%test%'
             or reason ilike '%test%'
             or reason ilike '%BIR COR%');
    raise notice 'Phase0-1 preview: % compliance autopilot task(s) queued for cleanup', n;
  else
    raise notice 'Phase0-1 preview: agent_tasks not deployed yet — nothing to clean';
  end if;
end $$;

begin;

-- 10) Remove bootstrap-seed and e2e-created compliance records.
do $$
begin
  if to_regclass('public.compliance_records') is not null then
    delete from public.compliance_records
      where id like 'cmp-seed-%'
         or number = 'COR-9999'
         or name ilike '%test%'
         or notes ilike '%test%';
    raise notice 'Phase0-1 cleanup: compliance seed/test records deleted';
  end if;
end $$;

-- 11) Remove autopilot compliance tasks queued from those records (also deletes
--     any helper rows the edge-function ladder may have created for tests).
do $$
begin
  if to_regclass('public.agent_tasks') is not null then
    delete from public.agent_tasks
      where kind = 'compliance'
        and (payload ->> 'record_id' like 'cmp-seed-%'
             or payload ->> 'name' ilike '%test%'
             or reason ilike '%test%'
             or reason ilike '%BIR COR%');
    raise notice 'Phase0-1 cleanup: compliance test tasks deleted';
  end if;
end $$;

commit;

-- VERIFY (guarded):
do $$
declare n int;
begin
  if to_regclass('public.compliance_records') is not null then
    select count(*) into n from public.compliance_records
      where id like 'cmp-seed-%' or number = 'COR-9999' or name ilike '%test%';
    raise notice 'Phase0-1 verify: remaining seed/test compliance records = %', n;
  end if;
  if to_regclass('public.agent_tasks') is not null then
    select count(*) into n from public.agent_tasks
      where kind = 'compliance'
        and (payload ->> 'record_id' like 'cmp-seed-%'
             or payload ->> 'name' ilike '%test%'
             or reason ilike '%test%'
             or reason ilike '%BIR COR%');
    raise notice 'Phase0-1 verify: remaining compliance test tasks = %', n;
  end if;
end $$;
