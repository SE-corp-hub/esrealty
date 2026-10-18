-- 2026-10-17: personal and sample email addresses replaced with example.com placeholders.
-- This is a one-off script that has already been applied; put the real address back only if you re-run it.
-- Run this whole file in Supabase SQL Editor.
-- Fixes Users & Access pending registrations and is safe to run repeatedly.

begin;

alter table public.profiles
  add column if not exists prc text,
  add column if not exists resa text,
  add column if not exists agency text,
  add column if not exists broker uuid;

-- The previous function has a different OUT row type, so it must be dropped
-- before recreating it with the role-specific columns.
drop function if exists public.admin_list_profiles();

create function public.admin_list_profiles()
returns setof jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access required';
  end if;

  return query
  select jsonb_build_object(
    'id', p.id::text,
    'full_name', p.full_name::text,
    'email', u.email::text,
    'role', p.role::text,
    'registration_status', p.registration_status::text,
    'requested_role', coalesce(u.raw_user_meta_data ->> 'requested_role', '')::text,
    'prc', p.prc::text,
    'resa', p.resa::text,
    'agency', p.agency::text,
    'broker', p.broker::text,
    'created_at', p.created_at::text
  )
  from public.profiles p
  join auth.users u on u.id = p.id
  order by
    case p.registration_status
      when 'pending' then 0
      when 'approved' then 1
      else 2
    end,
    p.created_at desc;
end;
$$;

revoke all on function public.admin_list_profiles() from public;
grant execute on function public.admin_list_profiles() to authenticated;

commit;

-- Verify the account exists and is pending. This query does not require auth.uid().
select
  u.email,
  p.full_name,
  p.role,
  p.registration_status,
  coalesce(u.raw_user_meta_data ->> 'requested_role', '') as requested_role
from auth.users u
left join public.profiles p on p.id = u.id
where lower(u.email) = lower('sample-account@example.com');

-- Verify all pending accounts directly.
select
  u.email,
  p.full_name,
  p.registration_status,
  coalesce(u.raw_user_meta_data ->> 'requested_role', '') as requested_role
from public.profiles p
join auth.users u on u.id = p.id
where p.registration_status = 'pending'
order by p.created_at desc;
