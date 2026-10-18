-- SUPERSEDED (2026-10-17). Accounts are made by the admin-create-account edge
-- function. This old version let any signed-in user call the function directly,
-- so running it again would re-open that. The block below stops the script.
-- phase1_security_rest.sql removes everyone's right to call the old function.
do $$ begin
  raise exception 'admin_create_account.sql is superseded: accounts are made by the admin-create-account edge function. Nothing was changed.';
end $$;

-- Adds/re-enables ONLY the admin_create_account function used by Users & Access > Add Account.
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query), then press Run.
-- Afterwards click "Add Account" again in the app.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
alter extension pgcrypto set schema extensions;

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
  if exists (select 1 from auth.users where lower(email) = lower(btrim(p_email))) then raise exception 'Email already registered'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated', lower(btrim(p_email)),
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'requested_role', p_role, 'must_change_password', true),
     now(), now(), '', '');

  -- Normalize nullable legacy auth fields used by different GoTrue versions.
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email_change') then
    execute 'update auth.users set email_change = '''' where id = $1' using new_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email_change_token_new') then
    execute 'update auth.users set email_change_token_new = '''' where id = $1' using new_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email_change_token_current') then
    execute 'update auth.users set email_change_token_current = '''' where id = $1' using new_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'phone_change') then
    execute 'update auth.users set phone_change = '''' where id = $1' using new_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'phone_change_token') then
    execute 'update auth.users set phone_change_token = '''' where id = $1' using new_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'reauthentication_token') then
    execute 'update auth.users set reauthentication_token = '''' where id = $1' using new_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email_change_confirm_status') then
    execute 'update auth.users set email_change_confirm_status = 0 where id = $1' using new_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'is_sso_user') then
    execute 'update auth.users set is_sso_user = false where id = $1' using new_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'is_anonymous') then
    execute 'update auth.users set is_anonymous = false where id = $1' using new_id;
  end if;
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

revoke all on function public.admin_create_account(text, text, text, public.app_role, text, text, text, uuid) from public;
grant execute on function public.admin_create_account(text, text, text, public.app_role, text, text, text, uuid) to authenticated;

-- Reload PostgREST's schema cache so the app can call it immediately.
notify pgrst, 'reload schema';

-- Verify it is callable by authenticated users (should print t).
select
  p.proname,
  has_function_privilege('authenticated', 'public.admin_create_account(text,text,text,public.app_role,text,text,text,uuid)', 'execute') as can_call
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'admin_create_account';
