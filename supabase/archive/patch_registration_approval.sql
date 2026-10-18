-- Run once in Supabase Dashboard -> SQL Editor after schema.sql is installed.
alter table public.profiles add column if not exists registration_status text not null default 'pending'
  check (registration_status in ('pending', 'approved', 'rejected'));
update public.profiles set registration_status = 'approved' where role = 'super-admin';

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'super-admin' and registration_status = 'approved'); $$;

create or replace function public.admin_list_profiles()
returns setof jsonb
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required'; end if;
  return query select jsonb_build_object(
      'id', p.id::text,
      'full_name', p.full_name::text,
      'email', u.email::text,
      'role', p.role::text,
      'registration_status', p.registration_status::text,
      'created_at', p.created_at::text)
    from public.profiles p join auth.users u on u.id = p.id
    order by case p.registration_status when 'pending' then 0 when 'approved' then 1 else 2 end, p.created_at desc;
end;
$$;

create or replace function public.admin_set_profile_access(target_id uuid, next_role public.app_role, next_status text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required'; end if;
  if target_id = auth.uid() then raise exception 'You cannot change your own access'; end if;
  if next_status not in ('approved', 'rejected') then raise exception 'Invalid registration status'; end if;
  update public.profiles set role = next_role, registration_status = next_status where id = target_id;
  if not found then raise exception 'Profile not found'; end if;
  insert into public.audit_events (owner_id, event_type, entity_type, entity_id, detail)
  values (auth.uid(), 'registration_' || next_status, 'profile', target_id::text, jsonb_build_object('role', next_role));
end;
$$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;
revoke all on function public.admin_list_profiles() from public;
grant execute on function public.admin_list_profiles() to authenticated;
revoke all on function public.admin_set_profile_access(uuid, public.app_role, text) from public;
grant execute on function public.admin_set_profile_access(uuid, public.app_role, text) to authenticated;
