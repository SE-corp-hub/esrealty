-- Adds ONLY the admin_delete_account function.
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query), then press Run.
-- Afterwards click the delete (trash) button again in Users & Access > Rejected tab.

create or replace function public.admin_delete_account(target_id uuid)
returns void
language plpgsql security definer set search_path = public, auth, extensions
as $$
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required'; end if;
  if target_id is null or not exists (select 1 from public.profiles where id = target_id) then
    raise exception 'Account not found';
  end if;
  if target_id = auth.uid() then raise exception 'You cannot delete your own account'; end if;
  -- Cascades remove identities, profile, app_state, audit_events, password_resets.
  delete from auth.users where id = target_id;
end;
$$;
revoke all on function public.admin_delete_account(uuid) from public;
grant execute on function public.admin_delete_account(uuid) to authenticated;

-- Reload PostgREST's schema cache so the app can call it immediately.
notify pgrst, 'reload schema';

-- Verify it is callable by authenticated users (should print t).
select
  p.proname,
  has_function_privilege('authenticated', 'public.admin_delete_account(uuid)', 'execute') as can_call
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'admin_delete_account';
