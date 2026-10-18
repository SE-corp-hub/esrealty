-- Diagnostic for: account created via Users & Access > Add Account cannot log in.
-- Run this ENTIRE file in the Supabase SQL Editor. It only reads data.
-- Look at the bottom result: each row shows the login-relevant state of one account.

-- 1) Which Supabase auth schema / GoTrue version is in use.
select
  (select count(*) from information_schema.columns where table_schema = 'auth' and table_name = 'users')  as users_cols,
  (select count(*) from information_schema.columns where table_schema = 'auth' and table_name = 'identities') as identities_cols;

-- 2) Login-relevant state for every account (most recently created first).
--    A working account needs: has_password = t, email_confirmed_at not null,
--    email_identity = t, and registration_status = 'approved'.
select
  u.email,
  u.email_confirmed_at,
  u.confirmation_token,
  (u.encrypted_password is not null and u.encrypted_password <> '') as has_password,
  left(coalesce(u.encrypted_password, ''), 4) as pw_hash_prefix,
  exists (
    select 1 from auth.identities i
    where i.user_id = u.id and i.provider = 'email'
  ) as email_identity,
  p.role,
  p.registration_status,
  u.created_at
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at desc;

-- 3) Detect legacy accounts that still use the old insecure temporary password.
--    Reset every row that prints t; current account creation uses unique passwords.
select
  u.email,
  (u.encrypted_password = extensions.crypt('123456', u.encrypted_password)) as matches_123456
from auth.users u
where u.encrypted_password is not null and u.encrypted_password <> '';
