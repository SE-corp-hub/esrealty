-- Run once in Supabase Dashboard -> SQL Editor after patch_registration_approval.sql.
-- Adds the registrant's "requested role" (from auth user metadata) to the Super Admin
-- registration list so the admin can honor the user's preference when assigning the role.
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
      'requested_role', coalesce(u.raw_user_meta_data ->> 'requested_role', '')::text,
      'created_at', p.created_at::text)
    from public.profiles p join auth.users u on u.id = p.id
    order by case p.registration_status when 'pending' then 0 when 'approved' then 1 else 2 end, p.created_at desc;
end;
$$;

revoke all on function public.admin_list_profiles() from public;
grant execute on function public.admin_list_profiles() to authenticated;
