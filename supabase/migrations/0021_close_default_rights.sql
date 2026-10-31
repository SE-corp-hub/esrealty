-- Rights a brand-new Supabase project hands out on its own, closed (2026-10-31). Safe to run twice.
-- Apply with GitHub > Actions > Apply database migration (test, then apply), AFTER 0020.
--
-- A new Supabase project gives visitors and signed-in users every right on every new table before
-- any migration runs. The baseline only adds rights, so on the project built on 2026-10-27 those
-- defaults stayed. Row rules still decide which rows anyone sees, but two side doors were open:
--
--   profiles         a signed-in user could change their own role and approval (one request made
--                    any new sign-up a Super Admin). Back to the five columns the app edits, and a
--                    trigger that refuses role, approval, broker or email changes made straight from
--                    the app, whatever the rights say (the Super Admin's functions still make them).
--   shared_listings  agents and brokers could save listings directly, skipping the listing
--                    function's checks (licence to sell, HTTPS photos) and its change log.
--
-- The rest brings the new project back to what the old one had: no table writes for visitors, and
-- no truncate, references or trigger rights for anyone but the server. Nothing the app does changes.

-- 1. Profiles: only the five columns the Settings form saves ---------------------------------------
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone, agency, prc, resa) on public.profiles to authenticated;

-- Refuses the change when it comes straight from the app (anon / authenticated). Database functions
-- that change access check the caller themselves (admin_set_profile_access, admin_assign_broker,
-- the handover), and Auth, the server and the SQL editor are not the app, so they still can.
create or replace function public.profiles_protect_access() returns trigger
language plpgsql set search_path to '' as $function$
begin
  if current_user in ('anon', 'authenticated')
     and (new.role is distinct from old.role
          or new.registration_status is distinct from old.registration_status
          or new.broker is distinct from old.broker
          or new.email is distinct from old.email) then
    raise exception 'Only a Super Admin can change a role, approval, broker or email.'
      using errcode = '42501';
  end if;
  return new;
end $function$;
revoke all on function public.profiles_protect_access() from public, anon, authenticated;
grant execute on function public.profiles_protect_access() to service_role;

drop trigger if exists profiles_protect_access on public.profiles;
create trigger profiles_protect_access before update of role, registration_status, broker, email
  on public.profiles for each row execute function public.profiles_protect_access();

-- 2. Listings: saved through the listing function only ---------------------------------------------
revoke insert, update, delete on public.shared_listings from anon, authenticated;

-- 3. Everything else back to the old project's rights ----------------------------------------------
-- Visitors write nothing directly: every public form goes through a function.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
-- Visitors never read the property management books, playbooks or the rate-limit counters.
revoke select on public.pms_documents, public.pms_expenses, public.pms_leases, public.pms_maintenance,
  public.pms_owners, public.pms_payments, public.pms_properties, public.pms_tenants, public.pms_units,
  public.sales_playbooks, public.listing_inquiry_rate_limits from anon;
-- The rate-limit counters are the listing function's alone.
revoke all on public.listing_inquiry_rate_limits from authenticated;

select
  not has_column_privilege('authenticated', 'public.profiles', 'role', 'update') as role_closed,
  not has_column_privilege('authenticated', 'public.profiles', 'registration_status', 'update') as approval_closed,
  has_column_privilege('authenticated', 'public.profiles', 'full_name', 'update') as name_still_editable,
  not has_table_privilege('authenticated', 'public.shared_listings', 'insert,update,delete') as listings_closed;
