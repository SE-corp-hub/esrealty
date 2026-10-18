-- Run this entire file in Supabase SQL Editor.
-- Lets an authenticated user edit their own profile details from the Settings page.
-- Only their own row, and only the safe profile fields (never role/registration_status).

-- 1) Ensure the editable columns exist (idempotent).
alter table public.profiles
  add column if not exists prc text,
  add column if not exists resa text,
  add column if not exists agency text,
  add column if not exists broker uuid,
  add column if not exists phone text;

-- 2) Direct-column grants: users may update these fields on their OWN row (RLS enforces own-row).
revoke update on public.profiles from authenticated;
grant update (full_name, agency, prc, resa, phone) on public.profiles to authenticated;

-- 3) CRITICAL: reload PostgREST's schema cache so the new columns/grants are recognized.
notify pgrst, 'reload schema';

-- Verify: returns your own profile row with the editable fields.
select p.full_name, p.agency, p.prc, p.resa, p.phone, p.role, p.registration_status
from public.profiles p
where p.id = auth.uid();
