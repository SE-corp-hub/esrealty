-- SEA ESTATES · Phase 1, step 1 (2026-10-16)
-- Stops anonymous visitors reading raw listing rows. The payload column holds
-- title numbers, tax declaration numbers, who created the listing and exact
-- coordinates, and a 2026 policy let anyone with the public site key read it.
--
-- The public website is not affected: listing-api reads listings with the
-- service role, which ignores these rules. Signed-in APPROVED users keep read
-- access to published listings (the buyer portal's saved-listings list needs
-- it). Pending or rejected accounts lose it. Safe to run more than once: if
-- any line fails, nothing changes.
begin;

drop policy if exists "shared_listings public published read" on public.shared_listings;
drop policy if exists "shared_listings approved published read" on public.shared_listings;

create policy "shared_listings approved published read"
  on public.shared_listings
  for select
  to authenticated
  using (is_published = true and public.listing_current_user_is_approved());

commit;

-- Check: every read rule left on the table. Copy this result back to Claude.
select policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'shared_listings'
order by policyname;
