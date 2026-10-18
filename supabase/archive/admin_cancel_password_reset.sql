-- Adds the cancel-reset-request RPC. A Super Admin can dismiss a pending
-- password reset request without generating a temporary password.
-- Run this ENTIRE file in the Supabase SQL Editor.

create or replace function public.admin_cancel_password_reset(target_id uuid)
returns integer
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_cancelled integer;
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required'; end if;
  if target_id is null or not exists (select 1 from public.password_resets where user_id = target_id and status = 'pending') then
    raise exception 'No pending reset request for this account';
  end if;
  update public.password_resets
  set status = 'cancelled', resolved_at = now()
  where user_id = target_id and status = 'pending';
  get diagnostics v_cancelled = row_count;
  insert into public.audit_events (owner_id, event_type, entity_type, entity_id, detail)
  values (auth.uid(), 'cancel_password_reset', 'profile', target_id::text, jsonb_build_object('status', 'cancelled'));
  return v_cancelled;
end;
$$;

revoke all on function public.admin_cancel_password_reset(uuid) from public;
grant execute on function public.admin_cancel_password_reset(uuid) to authenticated;
notify pgrst, 'reload schema';

select
  p.proname,
  has_function_privilege('authenticated', 'public.admin_cancel_password_reset(uuid)', 'execute') as can_call
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'admin_cancel_password_reset';
