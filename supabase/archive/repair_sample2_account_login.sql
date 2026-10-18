-- 2026-10-17: personal and sample email addresses replaced with example.com placeholders.
-- This is a one-off script that has already been applied; put the real address back only if you re-run it.
-- Repairs sample-account-2@example.com so it can log in.
-- Run this ENTIRE file in the Supabase SQL Editor, then look at the result at the bottom.
-- It (1) prints the current login state, (2) fixes the common blockers:
--   - missing auth.identities email row  -> inserted
--   - email_confirmed_at null            -> set to now()
--   - confirmation_token stale           -> cleared
--   - password issue                     -> reset to a generated temporary password
--   - profile not approved               -> set to approved (role stays as-is)

do $$
declare
  v_user_id uuid;
  v_email text;
  v_has_pw boolean;
  v_temp_password text := translate(encode(extensions.gen_random_bytes(18), 'base64'), '/+', 'XY');
begin
  select id, lower(email)
  into v_user_id, v_email
  from auth.users
  where lower(email) = lower('sample-account-2@example.com');

  if v_user_id is null then
    raise exception 'Account sample-account-2@example.com does not exist in auth.users. Create it first via Users & Access > Add Account, then run this file again.';
  end if;

  -- Diagnose before repair.
  select (u.encrypted_password is not null and u.encrypted_password <> '')
  into v_has_pw
  from auth.users u where u.id = v_user_id;

  raise notice 'sample2.1 state -> has_password=%', v_has_pw;

  -- Repair 1: confirmed + clean tokens + email provider metadata.
  update auth.users
  set email_confirmed_at = coalesce(email_confirmed_at, now()),
      confirmation_token = '',
      recovery_token = coalesce(recovery_token, ''),
      raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
        || '{"provider":"email","providers":["email"]}'::jsonb,
      updated_at = now()
  where id = v_user_id;

  -- Repair 2: ensure the email-provider identity row exists (GoTrue requires it for password sign-in).
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

  -- Repair 3: reset to a unique temporary password and require replacement.
  update auth.users
  set encrypted_password = extensions.crypt(v_temp_password, extensions.gen_salt('bf')),
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"must_change_password":true}'::jsonb,
      updated_at = now()
  where id = v_user_id;
  raise notice 'Temporary password (share securely, then change): %', v_temp_password;

  -- Repair 4: make sure the profile exists and is approved (keeps current role).
  insert into public.profiles (id, full_name, role, registration_status)
  values (
    v_user_id,
    coalesce((select raw_user_meta_data ->> 'full_name' from auth.users where id = v_user_id), ''),
    'buyer'::public.app_role,
    'approved'
  )
  on conflict (id) do update
  set registration_status = 'approved';
end;
$$;

notify pgrst, 'reload schema';

-- Expected after repair: has_password=t, email_identity=t, status=approved.
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
where lower(u.email) = lower('sample-account-2@example.com');
