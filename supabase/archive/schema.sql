-- ES Realty Supabase foundation. Run this entire file in the Supabase SQL Editor.
-- It uses only auth.uid() for access checks. Never use a secret/service-role key in the browser.

create type public.app_role as enum ('super-admin', 'broker', 'agent', 'buyer', 'seller', 'owner', 'tenant');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.app_role not null default 'buyer',
  registration_status text not null default 'pending' check (registration_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint app_state_payload_object check (jsonb_typeof(payload) = 'object')
);

create table public.pms_workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pms_workspaces_payload_object check (jsonb_typeof(payload) = 'object')
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, registration_status)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'pending');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Repairs profiles for accounts created before the trigger was installed.
-- It can create only the currently authenticated user's default buyer profile.
create or replace function public.ensure_my_profile()
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  result public.profiles;
begin
  insert into public.profiles (id, full_name, registration_status)
  values (auth.uid(), coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', ''), 'pending')
  on conflict (id) do nothing;
  select * into result from public.profiles where id = auth.uid();
  return result;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();
create trigger app_state_set_updated_at before update on public.app_state
  for each row execute procedure public.set_updated_at();
create trigger pms_workspaces_set_updated_at before update on public.pms_workspaces
  for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.app_state enable row level security;
alter table public.pms_workspaces enable row level security;
alter table public.audit_events enable row level security;

create policy "profiles read own" on public.profiles for select using (auth.uid() = id);
create policy "profiles update own name" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "state owner access" on public.app_state for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "audit owner read" on public.audit_events for select using (auth.uid() = owner_id);
create policy "audit owner insert" on public.audit_events for insert with check (auth.uid() = owner_id);

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

create or replace function public.pms_workspace_can_read(workspace_payload jsonb)
returns boolean
language sql
stable
security definer set search_path = public
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

create policy "pms workspace linked read" on public.pms_workspaces for select using (public.pms_workspace_can_read(payload));
create policy "pms workspace admin insert" on public.pms_workspaces for insert with check (owner_id = auth.uid() and public.is_super_admin());
create policy "pms workspace admin update" on public.pms_workspaces for update
  using (owner_id = auth.uid() and public.is_super_admin()) with check (owner_id = auth.uid() and public.is_super_admin());
create policy "pms workspace admin delete" on public.pms_workspaces for delete using (owner_id = auth.uid() and public.is_super_admin());
revoke all on function public.pms_workspace_can_read(jsonb) from public;
grant execute on function public.pms_workspace_can_read(jsonb) to authenticated;
grant select, insert, update, delete on public.pms_workspaces to authenticated;

create or replace function public.admin_list_profiles()
returns setof jsonb
language plpgsql
security definer set search_path = public, auth
as $$
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required'; end if;
  return query select jsonb_build_object(
      'id', p.id::text,
      'full_name', p.full_name::text,
      'email', u.email::text,
      'role', p.role::text,
      'registration_status', p.registration_status::text,
      'created_at', p.created_at::text)
    from public.profiles p join auth.users u on u.id = p.id
    order by case p.registration_status when 'pending' then 0 when 'approved' then 1 else 2 end, p.created_at desc;
end;
$$;

create or replace function public.admin_set_profile_access(target_id uuid, next_role public.app_role, next_status text)
returns void
language plpgsql
security definer set search_path = public
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
language plpgsql
security definer set search_path = public
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

revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;
revoke all on function public.ensure_my_profile() from public;
grant execute on function public.ensure_my_profile() to authenticated;
revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;
revoke all on function public.admin_list_profiles() from public;
grant execute on function public.admin_list_profiles() to authenticated;
revoke all on function public.admin_set_profile_access(uuid, public.app_role, text) from public;
grant execute on function public.admin_set_profile_access(uuid, public.app_role, text) to authenticated;
revoke all on function public.admin_assign_broker(uuid, uuid) from public;
grant execute on function public.admin_assign_broker(uuid, uuid) to authenticated;

create table if not exists public.password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.password_resets enable row level security;
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

insert into storage.buckets (id, name, public)
values ('private-documents', 'private-documents', false)
on conflict (id) do nothing;

create policy "documents read own folder" on storage.objects for select
  using (bucket_id = 'private-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "documents insert own folder" on storage.objects for insert
  with check (bucket_id = 'private-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "documents update own folder" on storage.objects for update
  using (bucket_id = 'private-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "documents delete own folder" on storage.objects for delete
  using (bucket_id = 'private-documents' and auth.uid()::text = (storage.foldername(name))[1]);

-- Promote the first real administrator manually after account creation:
-- update public.profiles set role = 'super-admin'
-- where id = (select id from auth.users where email = 'your-email@example.com');
