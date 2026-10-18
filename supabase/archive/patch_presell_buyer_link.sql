-- Buyer Portal: link reservations to buyer accounts + buyer-scoped reads.
-- Run AFTER preselling.sql. Idempotent.

begin;

-- Link a reserved unit to the reserving platform account (nullable for walk-ins)
alter table public.presell_units add column if not exists reserved_by uuid
  references auth.users(id) on delete set null;

create index if not exists presell_units_reserved_by_idx
  on public.presell_units (reserved_by) where reserved_by is not null;

-- Buyers (and any authenticated user) may read their own reservations; the base
-- "presell units read auth" policy already grants broad read, so this index is
-- the only addition needed for portal queries.

commit;
