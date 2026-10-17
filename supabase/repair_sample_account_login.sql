-- 2026-10-17: personal and sample email addresses replaced with example.com placeholders.
-- This is a one-off script that has already been applied; put the real address back only if you re-run it.
-- Run this ENTIRE file once in Supabase SQL Editor.
-- Repairs an account created by the old Super Admin flow, which inserted into
-- auth.users but omitted the auth.identities email-provider row.

do $$
declare
  v_user_id uuid;
  v_email text;
begin
  select id, lower(email)
  into v_user_id, v_email
  from auth.users
  where lower(email) = lower('sample-account-1@example.com');

  if v_user_id is null then
    raise exception 'Account sample-account-1@example.com does not exist in auth.users';
  end if;

  if not exists (
    select 1 from auth.users
    where id = v_user_id and encrypted_password is not null and encrypted_password <> ''
  ) then
    raise exception 'Account exists but has no password. Use the Super Admin Reset button after this repair.';
  end if;

  update auth.users
  set email_confirmed_at = coalesce(email_confirmed_at, now()),
      confirmation_token = '',
      raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
        || '{"provider":"email","providers":["email"]}'::jsonb,
      updated_at = now()
  where id = v_user_id;

  if not exists (
    select 1 from auth.identities
    where user_id = v_user_id and provider = 'email'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
    ) then
      execute $identity$
        insert into auth.identities
          (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values
          ($1::text, $1,
           jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true, 'phone_verified', false),
           'email', now(), now(), now())
      $identity$ using v_user_id, v_email;
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'identities' and column_name = 'id' and data_type = 'uuid'
    ) then
      execute $identity$
        insert into auth.identities
          (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values
          (gen_random_uuid(), $1,
           jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
           'email', now(), now(), now())
      $identity$ using v_user_id, v_email;
    else
      execute $identity$
        insert into auth.identities
          (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values
          ($1::text, $1,
           jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
           'email', now(), now(), now())
      $identity$ using v_user_id, v_email;
    end if;
  end if;

  insert into public.profiles (id, full_name, role, registration_status)
  select
    id,
    coalesce(raw_user_meta_data ->> 'full_name', ''),
    'buyer'::public.app_role,
    'approved'
  from auth.users
  where id = v_user_id
  on conflict (id) do update
  set registration_status = 'approved';
end;
$$;

notify pgrst, 'reload schema';

-- Expected: has_password=true, email_identity=true, status=approved.
select
  u.email,
  u.email_confirmed_at,
  (u.encrypted_password is not null and u.encrypted_password <> '') as has_password,
  exists (
    select 1 from auth.identities i
    where i.user_id = u.id and i.provider = 'email'
  ) as email_identity,
  p.role,
  p.registration_status
from auth.users u
left join public.profiles p on p.id = u.id
where lower(u.email) = lower('sample-account-1@example.com');
