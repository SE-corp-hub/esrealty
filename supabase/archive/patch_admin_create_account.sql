-- Run once in Supabase Dashboard -> SQL Editor after patch_requested_role.sql.
-- Adds role-specific profile fields and lets a Super Admin manually create an account.
-- pgcrypto provides crypt()/gen_salt() for password hashing.
-- Supabase keeps it in the extensions schema, but older projects may have it in public:
-- create/alter force it into extensions so the qualified calls below always resolve.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
alter extension pgcrypto set schema extensions;

alter table public.profiles
  add column if not exists prc text,
  add column if not exists resa text,
  add column if not exists agency text,
  add column if not exists broker uuid;

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
language plpgsql security definer set search_path = public, auth, extensions
as $$
declare
  new_id uuid := gen_random_uuid();
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required'; end if;
  if p_role = 'broker' and (p_prc is null or length(btrim(p_prc)) = 0) then raise exception 'Broker PRC license is required'; end if;
  if p_role = 'agent' and p_broker is null then raise exception 'Agents must be linked to a supervising broker'; end if;
  if exists (select 1 from auth.users where email = p_email) then raise exception 'Email already registered'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'requested_role', p_role, 'must_change_password', true),
    now(), now(), '', '');
  -- Supabase Auth also requires an email identity. A user row without this can
  -- appear approved in profiles while signInWithPassword still cannot load it.
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
  values (new_id, p_full_name, p_role, 'pending', p_prc, p_resa, p_agency, p_broker)
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
      'prc', p.prc::text,
      'resa', p.resa::text,
      'agency', p.agency::text,
      'broker', p.broker::text,
      'created_at', p.created_at::text)
    from public.profiles p join auth.users u on u.id = p.id
    order by case p.registration_status when 'pending' then 0 when 'approved' then 1 else 2 end, p.created_at desc;
end;
$$;

revoke all on function public.admin_create_account(text, text, text, public.app_role, text, text, text, uuid) from public;
-- Account creation now uses the admin-create-account Edge Function. Direct
-- writes to Supabase's private auth tables are intentionally disabled.
revoke execute on function public.admin_create_account(text, text, text, public.app_role, text, text, text, uuid) from authenticated;
revoke all on function public.admin_list_profiles() from public;
grant execute on function public.admin_list_profiles() to authenticated;

-- Lets a Super Admin assign/change the supervising broker of an agent account
-- directly from the Users & Access Approved tab.
create or replace function public.admin_assign_broker(target_id uuid, broker_id uuid)
returns void
language plpgsql security definer set search_path = public, auth, extensions
as $$
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required'; end if;
  if target_id is null or not exists (select 1 from public.profiles where id = target_id) then raise exception 'Account not found'; end if;
  if broker_id is not null and not exists (select 1 from public.profiles where id = broker_id and role = 'broker' and registration_status = 'approved') then
    raise exception 'Broker not found or not approved';
  end if;
  update public.profiles set broker = broker_id where id = target_id;
  if not found then raise exception 'Profile not found'; end if;
  insert into public.audit_events (owner_id, event_type, entity_type, entity_id, detail)
  values (auth.uid(), 'assign_broker', 'profile', target_id::text, jsonb_build_object('broker', broker_id));
end;
$$;
revoke all on function public.admin_assign_broker(uuid, uuid) from public;
grant execute on function public.admin_assign_broker(uuid, uuid) to authenticated;

-- ============================================================
-- Password reset: users request via the Forgot Password tab;
-- the Super Admin generates a new temporary password per account.
-- ============================================================
create table if not exists public.password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.password_resets enable row level security;
drop policy if exists "password_resets insert pending" on public.password_resets;
drop policy if exists "password_resets super admin select" on public.password_resets;
drop policy if exists "password_resets super admin update" on public.password_resets;
create policy "password_resets insert pending" on public.password_resets for insert with check (status = 'pending');
create policy "password_resets super admin select" on public.password_resets for select using (public.is_super_admin());
create policy "password_resets super admin update" on public.password_resets for update using (public.is_super_admin());

create or replace function public.admin_request_password_reset(p_email text)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_user_id uuid;
begin
  if p_email is null or btrim(p_email) = '' then return; end if;
  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then return; end if;
  if not exists (select 1 from public.password_resets where user_id = v_user_id and status = 'pending') then
    insert into public.password_resets (user_id, email, status) values (v_user_id, lower(btrim(p_email)), 'pending');
  end if;
end;
$$;
grant execute on function public.admin_request_password_reset(text) to anon, authenticated;

create or replace function public.admin_list_password_resets()
returns setof jsonb
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required'; end if;
  return query select jsonb_build_object(
      'id', r.id::text,
      'user_id', r.user_id::text,
      'email', r.email::text,
      'full_name', coalesce(p.full_name, '')::text,
      'created_at', r.created_at::text)
    from public.password_resets r
    left join public.profiles p on p.id = r.user_id
    where r.status = 'pending'
    order by r.created_at desc;
end;
$$;
revoke all on function public.admin_list_password_resets() from public;
grant execute on function public.admin_list_password_resets() to authenticated;

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
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"must_change_password":true}'::jsonb,
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

-- Super Admin deletes an account (auth.users cascade removes identities,
-- profile, app_state, audit_events, and password_resets rows).
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

-- Reload PostgREST's schema cache so admin_create_account becomes callable
-- without re-running the dashboard or waiting for the automatic refresh.
notify pgrst, 'reload schema';

-- Verify. The function body must contain "extensions.gen_salt" (prints 1) and
-- pgcrypto must report schema "extensions".
select (prosrc like '%extensions.gen_salt%') as function_uses_extensions
from pg_proc where proname = 'admin_create_account';
select e.extname, n.nspname as pgcrypto_schema
from pg_extension e join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pgcrypto';
