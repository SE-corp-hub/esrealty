-- Adds the reset-password RPC and marks the account for a required password
-- change. On the next login the app sends the user to Settings.
-- Run this ENTIRE file in the Supabase SQL Editor.

create or replace function public.admin_reset_password(target_id uuid)
returns text
language plpgsql security definer set search_path = public, auth, extensions
as $$
declare
  v_password text;
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required'; end if;
  if target_id is null or not exists (select 1 from public.profiles where id = target_id) then
    raise exception 'Account not found';
  end if;
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789',
      (1 + floor(random() * 58))::int, 1), '')
  into v_password from generate_series(1, 12);
  update auth.users
  set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
        || '{"must_change_password":true}'::jsonb,
      updated_at = now()
  where id = target_id;
  update public.password_resets set status = 'done', resolved_at = now()
  where user_id = target_id and status = 'pending';
  insert into public.audit_events (owner_id, event_type, entity_type, entity_id, detail)
  values (auth.uid(), 'reset_password', 'profile', target_id::text, jsonb_build_object('must_change_password', true));
  return v_password;
end;
$$;

revoke all on function public.admin_reset_password(uuid) from public;
grant execute on function public.admin_reset_password(uuid) to authenticated;
notify pgrst, 'reload schema';

select
  p.proname,
  has_function_privilege('authenticated', 'public.admin_reset_password(uuid)', 'execute') as can_call
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'admin_reset_password';
