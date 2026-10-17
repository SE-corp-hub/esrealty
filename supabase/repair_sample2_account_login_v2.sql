-- 2026-10-17: personal and sample email addresses replaced with example.com placeholders.
-- This is a one-off script that has already been applied; put the real address back only if you re-run it.
-- Strong repair for sample-account-2@example.com when Supabase Auth returns
-- "Database error querying schema" during password sign-in.
-- Run this ENTIRE file once in the Supabase SQL Editor.

do $$
declare
  v_user_id uuid;
  v_email text := 'sample-account-2@example.com';
  v_temp_password text := translate(encode(extensions.gen_random_bytes(18), 'base64'), '/+', 'XY');
begin
  select id into v_user_id
  from auth.users
  where lower(email) = v_email;

  if v_user_id is null then
    raise exception 'Account % does not exist in auth.users', v_email;
  end if;

  -- Normalize the core fields GoTrue reads during password sign-in.
  update auth.users
  set instance_id = '00000000-0000-0000-0000-000000000000',
      aud = 'authenticated',
      role = 'authenticated',
      email = v_email,
      encrypted_password = extensions.crypt(v_temp_password, extensions.gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      confirmation_token = '',
      recovery_token = '',
      raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
        || '{"provider":"email","providers":["email"]}'::jsonb,
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"must_change_password":true}'::jsonb,
      updated_at = now()
  where id = v_user_id;

  -- Auth schema versions contain different nullable legacy fields. GoTrue
  -- expects empty strings/false for these when they exist.
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email_change') then
    execute 'update auth.users set email_change = '''' where id = $1' using v_user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email_change_token_new') then
    execute 'update auth.users set email_change_token_new = '''' where id = $1' using v_user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email_change_token_current') then
    execute 'update auth.users set email_change_token_current = '''' where id = $1' using v_user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'phone_change') then
    execute 'update auth.users set phone_change = '''' where id = $1' using v_user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'phone_change_token') then
    execute 'update auth.users set phone_change_token = '''' where id = $1' using v_user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'reauthentication_token') then
    execute 'update auth.users set reauthentication_token = '''' where id = $1' using v_user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email_change_confirm_status') then
    execute 'update auth.users set email_change_confirm_status = 0 where id = $1' using v_user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'is_sso_user') then
    execute 'update auth.users set is_sso_user = false where id = $1' using v_user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'is_anonymous') then
    execute 'update auth.users set is_anonymous = false where id = $1' using v_user_id;
  end if;

  -- Recreate rather than preserve a potentially malformed email identity.
  delete from auth.identities
  where user_id = v_user_id and provider = 'email';

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
         jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true, 'phone_verified', false),
         'email', now(), now(), now())
    $identity$ using v_user_id, v_email;
  else
    execute $identity$
      insert into auth.identities
        (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values
        ($1::text, $1,
         jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true, 'phone_verified', false),
         'email', now(), now(), now())
    $identity$ using v_user_id, v_email;
  end if;

  update public.profiles
  set registration_status = 'approved'
  where id = v_user_id;
  raise notice 'Temporary password (share securely, then change): %', v_temp_password;
end;
$$;

notify pgrst, 'reload schema';

-- Expected: password, confirmation, identity, and status checks are good.
select
  u.email,
  (u.encrypted_password is not null and u.encrypted_password <> '') as has_password,
  (u.email_confirmed_at is not null) as email_confirmed,
  exists (
    select 1 from auth.identities i
    where i.user_id = u.id and i.provider = 'email'
  ) as email_identity,
  p.role,
  p.registration_status
from auth.users u
left join public.profiles p on p.id = u.id
where lower(u.email) = 'sample-account-2@example.com';
