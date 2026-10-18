-- Fix Security Advisor finding: public_listing_catalog defined with SECURITY DEFINER.
--
-- BEFORE: the view ran with owner privileges to let anon read published listings,
--         because shared_listings RLS allowed only owner/admin.
-- AFTER:  anon + authenticated get a narrow SELECT grant (published rows only),
--         the view becomes security_invoker = true, so the querying user's own
--         RLS applies. Column filtering still comes from the view definition.
--
-- Safe to re-run. Run AFTER listing_platform_schema.sql / shared_listings.sql.

begin;

-- 1) Public read of PUBLISHED listings only (columns stay limited by the view)
drop policy if exists "shared_listings public published read" on public.shared_listings;
create policy "shared_listings public published read"
  on public.shared_listings
  for select
  to anon, authenticated
  using (is_published = true);

-- 2) Flip the view to invoker rights
alter view public.public_listing_catalog set (security_invoker = true);

commit;

-- Verify: as anon you should see exactly the published count, nothing more.
-- select count(*) from public.public_listing_catalog;
