-- 2026-10-17: personal and sample email addresses replaced with example.com placeholders.
-- This is a one-off script that has already been applied; put the real address back only if you re-run it.
-- Run this entire file in Supabase SQL Editor.
-- Repairs profiles, promotes the configured Super Admin, and fixes Users & Access.

begin;

alter table public.profiles
  add column if not exists prc text,
  add column if not exists resa text,
  add column if not exists agency text,
  add column if not exists broker uuid,
  add column if not exists phone text;

-- Create profiles for auth accounts that missed the signup trigger.
insert into public.profiles (id, full_name, registration_status)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', ''),
  'pending'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- Ensure this account can manage the approval queue.
update public.profiles
set role = 'super-admin', registration_status = 'approved'
where id = (
  select id from auth.users
  where lower(email) = lower('admin-email@example.com')
);

-- Allow the profile editor to save these columns for the user's OWN row.
revoke update on public.profiles from authenticated;
grant update (full_name, agency, prc, resa, phone) on public.profiles to authenticated;

-- Force sample1 back into the pending queue so the approval flow can be tested.
-- (Safe to re-run; only touches the sample account.)
update public.profiles
set role = 'buyer', registration_status = 'pending'
where id = (
  select id from auth.users
  where lower(email) = lower('sample-account@example.com')
);

-- pgcrypto provides crypt()/gen_salt() for password hashing.
-- Supabase keeps it in the extensions schema, but older projects may have it in public:
-- create/alter force it into extensions so the qualified calls below always resolve.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
alter extension pgcrypto set schema extensions;

-- Create pending accounts from the Users & Access Add Account modal.
-- The new account cannot sign in until a Super Admin approves it in the Pending tab.
create or replace function public.admin_create_account(
  p_email text,
  p_password text,
  p_full_name text,
  p_role public.app_role,
  p_prc text default null,
  p_resa text default null,
  p_agency text default null,
  p_broker uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  new_id uuid := gen_random_uuid();
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access required';
  end if;
  if p_email is null or btrim(p_email) = '' then
    raise exception 'Email is required';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'Temporary password must be at least 6 characters';
  end if;
  if p_role = 'broker' and (p_prc is null or length(btrim(p_prc)) = 0) then
    raise exception 'Broker PRC license is required';
  end if;
  if p_role = 'agent' and p_broker is null then
    raise exception 'Agents must be linked to a supervising broker';
  end if;
  if exists (select 1 from auth.users where lower(email) = lower(btrim(p_email))) then
    raise exception 'Email already registered';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated', lower(btrim(p_email)),
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', btrim(p_full_name), 'requested_role', p_role, 'must_change_password', true),
    now(), now(), '', ''
  );

  -- Keep Supabase Auth complete: email/password login requires an email identity
  -- in addition to the auth.users row.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) then
    execute $identity$
      insert into auth.identities
        (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values
        ($1::text, $1, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true, 'phone_verified', false),
         'email', now(), now(), now())
    $identity$ using new_id, lower(btrim(p_email));
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'id' and data_type = 'uuid'
  ) then
    execute $identity$
      insert into auth.identities
        (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values
        (gen_random_uuid(), $1, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
         'email', now(), now(), now())
    $identity$ using new_id, lower(btrim(p_email));
  else
    execute $identity$
      insert into auth.identities
        (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values
        ($1::text, $1, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
         'email', now(), now(), now())
    $identity$ using new_id, lower(btrim(p_email));
  end if;

  -- The auth.users insert fires the signup trigger (creating a pending profile),
  -- so attach the chosen role and keep it pending for Super Admin approval.
  insert into public.profiles (id, full_name, role, registration_status, prc, resa, agency, broker)
  values (new_id, btrim(p_full_name), p_role, 'pending', p_prc, p_resa, p_agency, p_broker)
  on conflict (id) do update
  set full_name = excluded.full_name,
      role = excluded.role,
      registration_status = excluded.registration_status,
      prc = excluded.prc,
      resa = excluded.resa,
      agency = excluded.agency,
      broker = excluded.broker;
  insert into public.audit_events (owner_id, event_type, entity_type, entity_id, detail)
  values (auth.uid(), 'manual_create', 'profile', new_id::text, jsonb_build_object('role', p_role));
  return new_id;
end;
$$;

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
revoke all on function public.admin_create_account(text, text, text, public.app_role, text, text, text, uuid) from public;
revoke execute on function public.admin_create_account(text, text, text, public.app_role, text, text, text, uuid) from authenticated;

-- Reload PostgREST's schema cache so the new function/columns are recognized.
notify pgrst, 'reload schema';

commit;

-- ===== DIAGNOSTICS (read these results before closing the editor) =====

-- 1) Does sample-account@example.com exist AT ALL? (0 rows = never registered in this project.)
select u.email, p.full_name, p.role, p.registration_status,
       coalesce(u.raw_user_meta_data ->> 'requested_role', '') as requested_role
from auth.users u
left join public.profiles p on p.id = u.id
where lower(u.email) = lower('sample-account@example.com');

-- 2) The full pending queue the app should show.
select u.email, p.full_name, p.registration_status,
       coalesce(u.raw_user_meta_data ->> 'requested_role', '') as requested_role
from public.profiles p
join auth.users u on u.id = p.id
where p.registration_status = 'pending'
order by p.created_at desc;

-- 3) Every profile the app will list (any status).
select u.email, p.full_name, p.role, p.registration_status
from public.profiles p
join auth.users u on u.id = p.id
order by p.registration_status, p.created_at desc;
