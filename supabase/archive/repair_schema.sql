-- ES Realty schema repair — run this ENTIRE file in the Supabase SQL Editor.
-- Fixes "Database error querying schema" on the login page by making sure every
-- type, column, function, and trigger PostgREST needs exists with a valid signature.
-- Safe to re-run any number of times.

-- 1) Make sure the app_role enum exists BEFORE any function references it.
--    A missing enum in a function signature is the #1 cause of the schema error.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'app_role' and n.nspname = 'public'
  ) then
    create type public.app_role as enum ('super-admin', 'broker', 'agent', 'buyer', 'seller', 'owner', 'tenant');
  end if;
end $$;

-- 2) Make sure every profile column the app uses exists.
alter table public.profiles
  add column if not exists prc text,
  add column if not exists resa text,
  add column if not exists agency text,
  add column if not exists broker uuid,
  add column if not exists phone text;

-- 3) pgcrypto in the extensions schema (crypt/gen_salt must resolve).
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
alter extension pgcrypto set schema extensions;

-- 4) Recreate every function PostgREST exposes with a valid signature.
--    is_super_admin must exist first because RLS policies depend on it.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super-admin' and registration_status = 'approved'
  );
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
    jsonb_build_object('full_name', btrim(p_full_name), 'requested_role', p_role, 'must_change_password', true),
    now(), now(), '', '');
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

create or replace function public.admin_set_profile_access(target_id uuid, next_role public.app_role, next_status text)
returns void
language plpgsql security definer set search_path = public
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

-- 5) Grants PostgREST needs to expose the functions to the app roles.
revoke all on function public.admin_create_account(text, text, text, public.app_role, text, text, text, uuid) from public;
revoke execute on function public.admin_create_account(text, text, text, public.app_role, text, text, text, uuid) from authenticated;
revoke all on function public.admin_list_profiles() from public;
grant execute on function public.admin_list_profiles() to authenticated;
revoke all on function public.admin_set_profile_access(uuid, public.app_role, text) from public;
grant execute on function public.admin_set_profile_access(uuid, public.app_role, text) to authenticated;
revoke all on function public.admin_assign_broker(uuid, uuid) from public;
grant execute on function public.admin_assign_broker(uuid, uuid) to authenticated;
revoke all on function public.admin_list_password_resets() from public;
grant execute on function public.admin_list_password_resets() to authenticated;
revoke all on function public.admin_reset_password(uuid) from public;
grant execute on function public.admin_reset_password(uuid) to authenticated;
revoke all on function public.admin_cancel_password_reset(uuid) from public;
grant execute on function public.admin_cancel_password_reset(uuid) to authenticated;
revoke all on function public.admin_request_password_reset(text) from public;
grant execute on function public.admin_request_password_reset(text) to anon, authenticated;

-- 6) Shared CRM leads table + RLS so agents' leads are visible to their
--    supervising broker (and the Super Admin).
create table if not exists public.crm_leads (
  id text primary key,
  ref text not null default '',
  name text not null default '',
  assigned_to text not null default '',
  assigned_to_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_leads_payload_object check (jsonb_typeof(payload) = 'object')
);
alter table public.crm_leads
  add column if not exists assigned_to_id uuid references auth.users(id) on delete set null;
update public.crm_leads l
set assigned_to_id = (
  select p.id from public.profiles p where p.full_name = l.assigned_to limit 1
)
where l.assigned_to_id is null
  and l.assigned_to <> ''
  and (select count(*) from public.profiles p where p.full_name = l.assigned_to) = 1;
create index if not exists crm_leads_created_by_idx on public.crm_leads (created_by);
create index if not exists crm_leads_assigned_to_idx on public.crm_leads (assigned_to);
create index if not exists crm_leads_assigned_to_id_idx on public.crm_leads (assigned_to_id);
create index if not exists crm_leads_updated_at_idx on public.crm_leads (updated_at desc);
alter table public.crm_leads enable row level security;

drop policy if exists "crm_leads select own or team" on public.crm_leads;
drop policy if exists "crm_leads insert own" on public.crm_leads;
drop policy if exists "crm_leads update own or team" on public.crm_leads;
drop policy if exists "crm_leads delete own or team" on public.crm_leads;

drop function if exists public.crm_lead_broker_of(public.crm_leads);
drop function if exists public.crm_lead_broker_of(uuid);
drop function if exists public.crm_lead_assigned_to_my_team(public.crm_leads);
drop function if exists public.crm_lead_assigned_to_my_team(text);
drop function if exists public.crm_lead_assigned_to_my_team(uuid);

create or replace function public.my_full_name()
returns text
language sql
stable
security definer set search_path = public
as $$
  select full_name from public.profiles where id = auth.uid();
$$;

create or replace function public.crm_lead_broker_of(p_created_by uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_created_by and p.broker = auth.uid()
  );
$$;

create or replace function public.crm_lead_assigned_to_my_team(p_assigned_to_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_assigned_to_id
      and p.role = 'agent'
      and p.registration_status = 'approved'
      and p.broker = auth.uid()
  );
$$;

create or replace function public.crm_current_user_is_approved()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and registration_status = 'approved'
  );
$$;

create policy "crm_leads select own or team"
  on public.crm_leads for select
  using (
    public.is_super_admin()
    or (public.crm_current_user_is_approved() and (
      created_by = auth.uid()
      or assigned_to_id = auth.uid()
      or public.crm_lead_broker_of(created_by)
      or public.crm_lead_assigned_to_my_team(assigned_to_id)
    ))
  );
create policy "crm_leads insert own"
  on public.crm_leads for insert
  with check (public.is_super_admin() or (
    public.crm_current_user_is_approved() and created_by = auth.uid()
  ));
create policy "crm_leads update own or team"
  on public.crm_leads for update
  using (
    public.is_super_admin()
    or (public.crm_current_user_is_approved() and (
      created_by = auth.uid()
      or assigned_to_id = auth.uid()
      or public.crm_lead_broker_of(created_by)
      or public.crm_lead_assigned_to_my_team(assigned_to_id)
    ))
  )
  with check (
    public.is_super_admin()
    or (public.crm_current_user_is_approved() and (
      created_by = auth.uid()
      or assigned_to_id = auth.uid()
      or public.crm_lead_broker_of(created_by)
      or public.crm_lead_assigned_to_my_team(assigned_to_id)
    ))
  );
create policy "crm_leads delete own or team"
  on public.crm_leads for delete
  using (
    public.is_super_admin()
    or (public.crm_current_user_is_approved() and (
      created_by = auth.uid()
      or public.crm_lead_broker_of(created_by)
      or public.crm_lead_assigned_to_my_team(assigned_to_id)
    ))
  );

revoke all on function public.my_full_name() from public;
grant execute on function public.my_full_name() to authenticated;
revoke all on function public.crm_lead_broker_of(uuid) from public;
grant execute on function public.crm_lead_broker_of(uuid) to authenticated;
revoke all on function public.crm_lead_assigned_to_my_team(uuid) from public;
grant execute on function public.crm_lead_assigned_to_my_team(uuid) to authenticated;
revoke all on function public.crm_current_user_is_approved() from public;
grant execute on function public.crm_current_user_is_approved() to authenticated;

create or replace function public.broker_team()
returns setof jsonb
language plpgsql
security definer set search_path = public, auth
as $$
declare
  me_role text;
begin
  select role::text into me_role from public.profiles where id = auth.uid();
  if me_role is distinct from 'broker' and me_role is distinct from 'super-admin' then
    raise exception 'Broker access required';
  end if;
  return query select jsonb_build_object(
      'id', p.id::text,
      'full_name', p.full_name::text,
      'email', u.email::text)
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role = 'agent' and p.registration_status = 'approved' and p.broker = auth.uid()
    order by p.full_name;
end;
$$;
revoke all on function public.broker_team() from public;
grant execute on function public.broker_team() to authenticated;

create or replace function public.my_broker()
returns jsonb
language sql
stable
security definer set search_path = public, auth
as $$
  select jsonb_build_object(
    'id', b.id::text,
    'full_name', b.full_name::text,
    'email', u.email::text,
    'agency', coalesce(b.agency, '')::text,
    'prc', coalesce(b.prc, '')::text
  )
  from public.profiles me
  join public.profiles b on b.id = me.broker
  join auth.users u on u.id = b.id
  where me.id = auth.uid()
    and me.role = 'agent'
    and b.role = 'broker'
    and b.registration_status = 'approved';
$$;
revoke all on function public.my_broker() from public;
grant execute on function public.my_broker() to authenticated;

-- 7) Shared broker transactions: broker-owned, linked-agent read-only.
create table if not exists public.broker_transactions (
  id text primary key,
  ref text not null default '',
  title text not null default '',
  payload jsonb not null default '{}'::jsonb,
  broker_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint broker_transactions_payload_object check (jsonb_typeof(payload) = 'object')
);
create index if not exists broker_transactions_broker_id_idx on public.broker_transactions (broker_id);
create index if not exists broker_transactions_created_by_idx on public.broker_transactions (created_by);
create index if not exists broker_transactions_updated_at_idx on public.broker_transactions (updated_at desc);

insert into public.broker_transactions (id, ref, title, payload, broker_id, created_by)
select 'migrated-' || a.owner_id::text || '-' || (tx.item ->> 'id'), coalesce(tx.item ->> 'ref', ''), coalesce(tx.item ->> 'title', ''),
  tx.item || jsonb_build_object(
    'id', 'migrated-' || a.owner_id::text || '-' || (tx.item ->> 'id'),
    'brokerId', a.owner_id::text,
    'createdBy', a.owner_id::text,
    'documents', coalesce(
      (select jsonb_agg(doc.item)
       from jsonb_array_elements(case when jsonb_typeof(a.payload -> 'docVault') = 'array' then a.payload -> 'docVault' else '[]'::jsonb end) as doc(item)
       where doc.item ->> 'ownerType' = 'tx' and doc.item ->> 'ownerId' = tx.item ->> 'id'),
      tx.item -> 'documents', '[]'::jsonb)) as payload,
  a.owner_id, a.owner_id
from public.app_state a
join public.profiles p on p.id = a.owner_id and p.role in ('broker', 'super-admin')
cross join lateral jsonb_array_elements(case when jsonb_typeof(a.payload -> 'transactions') = 'array' then a.payload -> 'transactions' else '[]'::jsonb end) as tx(item)
where coalesce(tx.item ->> 'id', '') <> ''
on conflict (id) do nothing;

alter table public.broker_transactions enable row level security;
drop policy if exists "broker_transactions select permitted" on public.broker_transactions;
drop policy if exists "broker_transactions insert broker own" on public.broker_transactions;
drop policy if exists "broker_transactions update broker own" on public.broker_transactions;
drop policy if exists "broker_transactions delete broker own" on public.broker_transactions;
drop function if exists public.transaction_for_my_broker(uuid);
drop function if exists public.transaction_current_user_is_broker();

create or replace function public.transaction_for_my_broker(p_broker_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles me where me.id = auth.uid() and me.role = 'agent' and me.registration_status = 'approved' and me.broker = p_broker_id);
$$;
create or replace function public.transaction_current_user_is_broker()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles me where me.id = auth.uid() and me.role = 'broker' and me.registration_status = 'approved');
$$;

create policy "broker_transactions select permitted" on public.broker_transactions for select
  using (public.is_super_admin() or broker_id = auth.uid() or public.transaction_for_my_broker(broker_id));
create policy "broker_transactions insert broker own" on public.broker_transactions for insert
  with check (public.is_super_admin() or (broker_id = auth.uid() and created_by = auth.uid() and public.transaction_current_user_is_broker()));
create policy "broker_transactions update broker own" on public.broker_transactions for update
  using (public.is_super_admin() or (broker_id = auth.uid() and created_by = auth.uid() and public.transaction_current_user_is_broker()))
  with check (public.is_super_admin() or (broker_id = auth.uid() and created_by = auth.uid() and public.transaction_current_user_is_broker()));
create policy "broker_transactions delete broker own" on public.broker_transactions for delete
  using (public.is_super_admin() or (broker_id = auth.uid() and created_by = auth.uid() and public.transaction_current_user_is_broker()));
revoke all on function public.transaction_for_my_broker(uuid) from public;
grant execute on function public.transaction_for_my_broker(uuid) to authenticated;
revoke all on function public.transaction_current_user_is_broker() from public;
grant execute on function public.transaction_current_user_is_broker() to authenticated;
grant select, insert, update, delete on public.broker_transactions to authenticated;

-- 8) Shared listing catalog for all authenticated roles.
create table if not exists public.shared_listings (
  id text primary key,
  ref text not null default '',
  title text not null default '',
  status text not null default 'available',
  payload jsonb not null default '{}'::jsonb,
  owner_id uuid not null references auth.users(id) on delete cascade,
  views bigint not null default 0,
  inquiries bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_listings_payload_object check (jsonb_typeof(payload) = 'object')
);
create index if not exists shared_listings_owner_id_idx on public.shared_listings (owner_id);
create index if not exists shared_listings_status_idx on public.shared_listings (status);
create index if not exists shared_listings_updated_at_idx on public.shared_listings (updated_at desc);

with existing as (
  select distinct on (listing.item ->> 'id') listing.item, a.owner_id,
    coalesce((a.payload -> 'listingStats' -> (listing.item ->> 'id') ->> 'views')::bigint, 0) as views,
    coalesce((a.payload -> 'listingStats' -> (listing.item ->> 'id') ->> 'inquiries')::bigint, 0) as inquiries
  from public.app_state a
  join public.profiles p on p.id = a.owner_id and p.role in ('super-admin', 'broker', 'agent')
  cross join lateral jsonb_array_elements(case when jsonb_typeof(a.payload -> 'listings') = 'array' then a.payload -> 'listings' else '[]'::jsonb end) as listing(item)
  where coalesce(listing.item ->> 'id', '') <> ''
  order by listing.item ->> 'id', case p.role when 'broker' then 1 when 'agent' then 2 else 3 end, a.owner_id
)
insert into public.shared_listings (id, ref, title, status, payload, owner_id, views, inquiries)
select item ->> 'id', coalesce(item ->> 'ref', ''), coalesce(item ->> 'title', ''), coalesce(item ->> 'status', 'available'),
  item || jsonb_build_object('createdBy', owner_id::text), owner_id, views, inquiries
from existing on conflict (id) do nothing;

alter table public.shared_listings enable row level security;
drop policy if exists "shared_listings authenticated read" on public.shared_listings;
drop policy if exists "shared_listings owner internal read" on public.shared_listings;
drop policy if exists "shared_listings publisher insert" on public.shared_listings;
drop policy if exists "shared_listings owner update" on public.shared_listings;
drop policy if exists "shared_listings owner delete" on public.shared_listings;
create or replace function public.listing_current_user_can_publish()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles me where me.id = auth.uid() and me.role in ('broker', 'agent') and me.registration_status = 'approved');
$$;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shared_listings'
      and column_name = 'is_published'
  ) then
    create policy "shared_listings owner internal read" on public.shared_listings for select
      using (public.is_super_admin() or (
        owner_id = auth.uid() and public.listing_current_user_can_publish()
      ));
  else
    create policy "shared_listings authenticated read" on public.shared_listings for select
      using (auth.uid() is not null);
  end if;
end;
$$;
create policy "shared_listings publisher insert" on public.shared_listings for insert
  with check (public.is_super_admin() or (owner_id = auth.uid() and public.listing_current_user_can_publish()));
create policy "shared_listings owner update" on public.shared_listings for update
  using (public.is_super_admin() or (owner_id = auth.uid() and public.listing_current_user_can_publish()))
  with check (public.is_super_admin() or (owner_id = auth.uid() and public.listing_current_user_can_publish()));
create policy "shared_listings owner delete" on public.shared_listings for delete
  using (public.is_super_admin() or (owner_id = auth.uid() and public.listing_current_user_can_publish()));

create or replace function public.increment_shared_listing_stat(p_listing_id text, p_stat text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_stat = 'views' then update public.shared_listings set views = views + 1 where id = p_listing_id;
  elsif p_stat = 'inquiries' then update public.shared_listings set inquiries = inquiries + 1 where id = p_listing_id;
  else raise exception 'Unsupported listing statistic'; end if;
end;
$$;
revoke all on function public.listing_current_user_can_publish() from public;
grant execute on function public.listing_current_user_can_publish() to authenticated;
revoke all on function public.increment_shared_listing_stat(text, text) from public;
do $$
begin
  grant select, insert, update, delete on public.shared_listings to authenticated;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shared_listings'
      and column_name = 'is_published'
  ) then
    revoke insert, update, delete on public.shared_listings from authenticated;
    revoke execute on function public.increment_shared_listing_stat(text, text) from authenticated;
  else
    grant execute on function public.increment_shared_listing_stat(text, text) to authenticated;
  end if;
end;
$$;

-- 9) Shared Property Management workspace for Super Admin, Owner, and Tenant flows.
create table if not exists public.pms_workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pms_workspaces_payload_object check (jsonb_typeof(payload) = 'object')
);
create or replace function public.pms_workspace_can_read(workspace_payload jsonb)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_super_admin() or exists (
    select 1 from public.profiles me
    where me.id = auth.uid() and me.registration_status = 'approved' and me.role in ('owner', 'tenant')
      and exists (
        select 1 from jsonb_array_elements(case
          when me.role = 'owner' and jsonb_typeof(workspace_payload -> 'owners') = 'array' then workspace_payload -> 'owners'
          when me.role = 'tenant' and jsonb_typeof(workspace_payload -> 'tenants') = 'array' then workspace_payload -> 'tenants'
          else '[]'::jsonb end) linked(record)
        where coalesce(linked.record ->> 'archived', 'false') <> 'true'
          and (linked.record ->> 'authUserId' = auth.uid()::text
            or lower(coalesce(linked.record ->> 'email', '')) = lower(coalesce(auth.jwt() ->> 'email', '')))
      )
  );
$$;
insert into public.pms_workspaces (owner_id, payload)
select a.owner_id, a.payload -> 'pms' from public.app_state a
join public.profiles p on p.id = a.owner_id
where p.role = 'super-admin' and jsonb_typeof(a.payload -> 'pms') = 'object'
on conflict (owner_id) do nothing;
alter table public.pms_workspaces enable row level security;
drop policy if exists "pms workspace linked read" on public.pms_workspaces;
drop policy if exists "pms workspace admin insert" on public.pms_workspaces;
drop policy if exists "pms workspace admin update" on public.pms_workspaces;
drop policy if exists "pms workspace admin delete" on public.pms_workspaces;
create policy "pms workspace linked read" on public.pms_workspaces for select using (public.pms_workspace_can_read(payload));
create policy "pms workspace admin insert" on public.pms_workspaces for insert with check (owner_id = auth.uid() and public.is_super_admin());
create policy "pms workspace admin update" on public.pms_workspaces for update
  using (owner_id = auth.uid() and public.is_super_admin()) with check (owner_id = auth.uid() and public.is_super_admin());
create policy "pms workspace admin delete" on public.pms_workspaces for delete using (owner_id = auth.uid() and public.is_super_admin());
revoke all on function public.pms_workspace_can_read(jsonb) from public;
grant execute on function public.pms_workspace_can_read(jsonb) to authenticated;
grant select, insert, update, delete on public.pms_workspaces to authenticated;
drop trigger if exists pms_workspaces_set_updated_at on public.pms_workspaces;
create trigger pms_workspaces_set_updated_at before update on public.pms_workspaces
  for each row execute procedure public.set_updated_at();

-- 10) Reload PostgREST's schema cache.
notify pgrst, 'reload schema';

-- 11) Diagnostics — read these results.
select (prosrc like '%extensions.gen_salt%') as admin_create_uses_extensions
from pg_proc where proname = 'admin_create_account' limit 1;
select e.extname, n.nspname as pgcrypto_schema
from pg_extension e join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pgcrypto';
