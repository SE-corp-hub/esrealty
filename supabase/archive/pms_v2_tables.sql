-- Property Management v2: one table per record type (2026-10-17)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Why: the PMS lived in one JSON record per super-admin (pms_workspaces).
--  * Any linked tenant or owner could download the whole record, including
--    other tenants' incomes and owners' bank details (the portals only hid
--    them on screen).
--  * Every save replaced the whole record, so an older phone or a second admin
--    silently overwrote newer data, and a second super-admin got an empty PMS.
-- Now each record is its own row. All staff (super-admins) share one PMS, and
-- row rules let an owner read only their own properties and what belongs to
-- them, and a tenant only their own leases and payments. People are linked by
-- login id (auth_user_id), never by email.
--
-- What this script does, in order:
--  1. Backs up pms_workspaces to pms_workspaces_backup_20261017.
--  2. Drops the old copy tables, their triggers and pms_insights(). Those
--     tables only held copies of pms_workspaces, rebuilt on every save, and
--     pms_insights() gave wrong figures; nothing else reads them.
--  3. Creates the nine tables, the access helpers and the row rules.
--  4. Copies every record from pms_workspaces (and, for super-admins without a
--     workspace row, from app_state) into the new tables. Where two admins'
--     records share an id, the most recently updated one wins.
--  5. Makes pms_workspaces staff-only and removes the PMS copy from every
--     user's app_state (tenants and owners each had a full copy).
-- pms_workspaces itself is kept (read-only to staff) for rollback.
-- After running this, reload the app on every phone so it uses the new tables.

begin;

-- 1. Backup -------------------------------------------------------------------
create table if not exists public.pms_workspaces_backup_20261017 as
  select * from public.pms_workspaces;
alter table public.pms_workspaces_backup_20261017 enable row level security;
revoke all on public.pms_workspaces_backup_20261017 from anon, authenticated;

-- 2. Old copy tables, triggers and insights -----------------------------------
drop trigger if exists pms_project_payload_trg on public.pms_workspaces;
drop trigger if exists pms_unproject_payload_trg on public.pms_workspaces;
drop function if exists public.pms_project_payload() cascade;
drop function if exists public.pms_unproject_payload() cascade;
drop function if exists public.pms_insights() cascade;
drop table if exists public.pps_maintenance cascade;
drop table if exists public.pps_expenses cascade;
do $$
declare t text;
begin
  -- The old copies were keyed by (owner_id uuid, id); the new tables use a text
  -- owner_id, so only the old shape is dropped and a re-run keeps the new data.
  foreach t in array array['pms_properties','pms_units','pms_owners','pms_tenants','pms_leases','pms_payments','pms_documents'] loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = t and column_name = 'owner_id' and data_type = 'uuid') then
      execute format('drop table public.%I cascade', t);
    end if;
  end loop;
end $$;

-- 3. Tables -------------------------------------------------------------------
-- Each row keeps the app's full record in `data`; the plain columns are the
-- links the row rules and indexes need. The app writes both.
create table if not exists public.pms_owners (
  id text primary key, data jsonb not null default '{}'::jsonb, archived boolean not null default false,
  auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid);
create table if not exists public.pms_tenants (
  id text primary key, data jsonb not null default '{}'::jsonb, archived boolean not null default false,
  auth_user_id uuid references auth.users(id) on delete set null, owner_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid);
create table if not exists public.pms_properties (
  id text primary key, data jsonb not null default '{}'::jsonb, archived boolean not null default false,
  owner_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid);
create table if not exists public.pms_units (
  id text primary key, data jsonb not null default '{}'::jsonb, archived boolean not null default false,
  property_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid);
create table if not exists public.pms_leases (
  id text primary key, data jsonb not null default '{}'::jsonb, archived boolean not null default false,
  property_id text, unit_id text, tenant_id text, owner_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid);
create table if not exists public.pms_payments (
  id text primary key, data jsonb not null default '{}'::jsonb, archived boolean not null default false,
  lease_id text, property_id text, tenant_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid);
create table if not exists public.pms_maintenance (
  id text primary key, data jsonb not null default '{}'::jsonb, archived boolean not null default false,
  property_id text, unit_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid);
create table if not exists public.pms_expenses (
  id text primary key, data jsonb not null default '{}'::jsonb, archived boolean not null default false,
  property_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid);
create table if not exists public.pms_documents (
  id text primary key, data jsonb not null default '{}'::jsonb, archived boolean not null default false,
  property_id text, unit_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by uuid);

create index if not exists pms_owners_auth_idx on public.pms_owners (auth_user_id);
create index if not exists pms_tenants_auth_idx on public.pms_tenants (auth_user_id);
create index if not exists pms_properties_owner_idx on public.pms_properties (owner_id);
create index if not exists pms_units_property_idx on public.pms_units (property_id);
create index if not exists pms_leases_property_idx on public.pms_leases (property_id);
create index if not exists pms_leases_tenant_idx on public.pms_leases (tenant_id);
create index if not exists pms_payments_lease_idx on public.pms_payments (lease_id);
create index if not exists pms_payments_property_idx on public.pms_payments (property_id);
create index if not exists pms_maintenance_property_idx on public.pms_maintenance (property_id);
create index if not exists pms_expenses_property_idx on public.pms_expenses (property_id);
create index if not exists pms_documents_property_idx on public.pms_documents (property_id);

-- updated_at is set by the database on every change; the app sends the value
-- it last saw so a stale phone cannot overwrite a newer row.
do $$
declare t text;
begin
  foreach t in array array['pms_owners','pms_tenants','pms_properties','pms_units','pms_leases','pms_payments','pms_maintenance','pms_expenses','pms_documents'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end $$;

-- Access helpers. Security definer, so the row rules can use them without the
-- rules calling each other in a loop. Each requires an approved account.
create or replace function public.pms_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin();
$$;

create or replace function public.pms_my_owner_ids()
returns setof text language sql stable security definer set search_path = public as $$
  select o.id from public.pms_owners o
  join public.profiles me on me.id = auth.uid()
  where o.auth_user_id = auth.uid() and not o.archived
    and me.role = 'owner' and me.registration_status = 'approved';
$$;

create or replace function public.pms_my_property_ids()
returns setof text language sql stable security definer set search_path = public as $$
  select p.id from public.pms_properties p
  where p.owner_id in (select public.pms_my_owner_ids());
$$;

create or replace function public.pms_my_tenant_ids()
returns setof text language sql stable security definer set search_path = public as $$
  select t.id from public.pms_tenants t
  join public.profiles me on me.id = auth.uid()
  where t.auth_user_id = auth.uid() and not t.archived
    and me.role = 'tenant' and me.registration_status = 'approved';
$$;

create or replace function public.pms_my_lease_ids()
returns setof text language sql stable security definer set search_path = public as $$
  select l.id from public.pms_leases l
  where l.tenant_id in (select public.pms_my_tenant_ids());
$$;

-- Names an owner may see for the tenants on their properties (no income,
-- employment or notes), and the landlord a tenant may see (no bank details).
create or replace function public.pms_owner_tenants()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.data ->> 'name', 'phone', t.data ->> 'phone',
    'email', t.data ->> 'email', 'owner_id', t.owner_id, 'archived', t.archived)), '[]'::jsonb)
  from public.pms_tenants t
  where t.owner_id in (select public.pms_my_owner_ids())
     or t.id in (select l.tenant_id from public.pms_leases l
                 where l.property_id in (select public.pms_my_property_ids()));
$$;

create or replace function public.pms_tenant_landlords()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'name', o.data ->> 'name', 'company', o.data ->> 'company',
    'phone', o.data ->> 'phone', 'email', o.data ->> 'email', 'archived', o.archived)), '[]'::jsonb)
  from public.pms_owners o
  where o.id in (select l.owner_id from public.pms_leases l where l.id in (select public.pms_my_lease_ids()))
     or o.id in (select p.owner_id from public.pms_properties p
                 join public.pms_leases l on l.property_id = p.id
                 where l.id in (select public.pms_my_lease_ids()));
$$;

revoke all on function public.pms_is_staff() from public, anon;
revoke all on function public.pms_my_owner_ids() from public, anon;
revoke all on function public.pms_my_property_ids() from public, anon;
revoke all on function public.pms_my_tenant_ids() from public, anon;
revoke all on function public.pms_my_lease_ids() from public, anon;
revoke all on function public.pms_owner_tenants() from public, anon;
revoke all on function public.pms_tenant_landlords() from public, anon;
grant execute on function public.pms_is_staff(), public.pms_my_owner_ids(), public.pms_my_property_ids(),
  public.pms_my_tenant_ids(), public.pms_my_lease_ids(), public.pms_owner_tenants(), public.pms_tenant_landlords()
  to authenticated;

-- Row rules: staff do everything; owners and tenants only read their own.
do $$
declare t text;
begin
  foreach t in array array['pms_owners','pms_tenants','pms_properties','pms_units','pms_leases','pms_payments','pms_maintenance','pms_expenses','pms_documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || ' staff all', t);
    execute format('create policy %I on public.%I for all using (public.pms_is_staff()) with check (public.pms_is_staff())', t || ' staff all', t);
    execute format('drop policy if exists %I on public.%I', t || ' owner read', t);
    execute format('drop policy if exists %I on public.%I', t || ' tenant read', t);
  end loop;
end $$;

create policy "pms_owners owner read" on public.pms_owners for select
  using (id in (select public.pms_my_owner_ids()));
create policy "pms_properties owner read" on public.pms_properties for select
  using (id in (select public.pms_my_property_ids()));
create policy "pms_units owner read" on public.pms_units for select
  using (property_id in (select public.pms_my_property_ids()));
create policy "pms_leases owner read" on public.pms_leases for select
  using (property_id in (select public.pms_my_property_ids()));
create policy "pms_payments owner read" on public.pms_payments for select
  using (property_id in (select public.pms_my_property_ids()));
create policy "pms_maintenance owner read" on public.pms_maintenance for select
  using (property_id in (select public.pms_my_property_ids()));
create policy "pms_expenses owner read" on public.pms_expenses for select
  using (property_id in (select public.pms_my_property_ids()));
create policy "pms_documents owner read" on public.pms_documents for select
  using (property_id in (select public.pms_my_property_ids()));

create policy "pms_tenants tenant read" on public.pms_tenants for select
  using (id in (select public.pms_my_tenant_ids()));
create policy "pms_leases tenant read" on public.pms_leases for select
  using (id in (select public.pms_my_lease_ids()));
create policy "pms_payments tenant read" on public.pms_payments for select
  using (lease_id in (select public.pms_my_lease_ids()));
create policy "pms_units tenant read" on public.pms_units for select
  using (id in (select l.unit_id from public.pms_leases l where l.id in (select public.pms_my_lease_ids())));
create policy "pms_properties tenant read" on public.pms_properties for select
  using (id in (select l.property_id from public.pms_leases l where l.id in (select public.pms_my_lease_ids())));

-- 4. Copy records from the old single record ----------------------------------
create or replace function pg_temp.pms_ts(v jsonb) returns timestamptz language plpgsql immutable as $$
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) = 'number' then return to_timestamp((v #>> '{}')::numeric / 1000); end if;
  begin return (v #>> '{}')::timestamptz; exception when others then return null; end;
end $$;

create or replace function pg_temp.pms_uuid(v text) returns uuid language plpgsql immutable as $$
begin
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return v::uuid; end if;
  return null;
end $$;

-- A person's login: the stored login id if it is a real account, else an
-- approved account of the right role with the same email (old records only).
create or replace function pg_temp.pms_login(rec jsonb, want_role text) returns uuid language sql stable as $$
  select coalesce(
    (select u.id from auth.users u where u.id = pg_temp.pms_uuid(rec ->> 'authUserId')),
    (select p.id from public.profiles p join auth.users u on u.id = p.id
      where p.role::text = want_role and lower(u.email) = lower(nullif(trim(rec ->> 'email'), ''))
      order by p.created_at limit 1));
$$;

create or replace function pg_temp.pms_import(payload jsonb) returns void language plpgsql as $$
declare r jsonb; login uuid;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then return; end if;
  for r in select x from jsonb_array_elements(case when jsonb_typeof(payload->'owners') = 'array' then payload->'owners' else '[]' end) x loop
    login := pg_temp.pms_login(r, 'owner');
    -- The record carries the resolved login too, so the app links it the same way.
    if login is not null then r := r || jsonb_build_object('authUserId', login::text); end if;
    insert into public.pms_owners as t (id, data, archived, auth_user_id, created_at)
    values (r->>'id', r, coalesce((r->>'archived')::boolean, false), login, coalesce(pg_temp.pms_ts(r->'createdAt'), now()))
    on conflict (id) do update set data = excluded.data, archived = excluded.archived, auth_user_id = excluded.auth_user_id
      where coalesce(pg_temp.pms_ts(excluded.data->'updatedAt'), 'epoch') > coalesce(pg_temp.pms_ts(t.data->'updatedAt'), 'epoch');
  end loop;
  for r in select x from jsonb_array_elements(case when jsonb_typeof(payload->'tenants') = 'array' then payload->'tenants' else '[]' end) x loop
    login := pg_temp.pms_login(r, 'tenant');
    if login is not null then r := r || jsonb_build_object('authUserId', login::text); end if;
    insert into public.pms_tenants as t (id, data, archived, auth_user_id, owner_id, created_at)
    values (r->>'id', r, coalesce((r->>'archived')::boolean, false), login, nullif(r->>'owner_id', ''), coalesce(pg_temp.pms_ts(r->'createdAt'), now()))
    on conflict (id) do update set data = excluded.data, archived = excluded.archived, auth_user_id = excluded.auth_user_id, owner_id = excluded.owner_id
      where coalesce(pg_temp.pms_ts(excluded.data->'updatedAt'), 'epoch') > coalesce(pg_temp.pms_ts(t.data->'updatedAt'), 'epoch');
  end loop;
  for r in select x from jsonb_array_elements(case when jsonb_typeof(payload->'properties') = 'array' then payload->'properties' else '[]' end) x loop
    insert into public.pms_properties as t (id, data, archived, owner_id, created_at)
    values (r->>'id', r, coalesce((r->>'archived')::boolean, false), nullif(r->>'owner_id', ''), coalesce(pg_temp.pms_ts(r->'createdAt'), now()))
    on conflict (id) do update set data = excluded.data, archived = excluded.archived, owner_id = excluded.owner_id
      where coalesce(pg_temp.pms_ts(excluded.data->'updatedAt'), 'epoch') > coalesce(pg_temp.pms_ts(t.data->'updatedAt'), 'epoch');
  end loop;
  for r in select x from jsonb_array_elements(case when jsonb_typeof(payload->'units') = 'array' then payload->'units' else '[]' end) x loop
    insert into public.pms_units as t (id, data, archived, property_id, created_at)
    values (r->>'id', r, coalesce((r->>'archived')::boolean, false), nullif(r->>'property_id', ''), coalesce(pg_temp.pms_ts(r->'createdAt'), now()))
    on conflict (id) do update set data = excluded.data, archived = excluded.archived, property_id = excluded.property_id
      where coalesce(pg_temp.pms_ts(excluded.data->'updatedAt'), 'epoch') > coalesce(pg_temp.pms_ts(t.data->'updatedAt'), 'epoch');
  end loop;
  for r in select x from jsonb_array_elements(case when jsonb_typeof(payload->'leases') = 'array' then payload->'leases' else '[]' end) x loop
    insert into public.pms_leases as t (id, data, archived, property_id, unit_id, tenant_id, owner_id, created_at)
    values (r->>'id', r, coalesce((r->>'archived')::boolean, false), nullif(r->>'property_id', ''), nullif(r->>'unit_id', ''), nullif(r->>'tenant_id', ''), nullif(r->>'owner_id', ''), coalesce(pg_temp.pms_ts(r->'createdAt'), now()))
    on conflict (id) do update set data = excluded.data, archived = excluded.archived, property_id = excluded.property_id, unit_id = excluded.unit_id, tenant_id = excluded.tenant_id, owner_id = excluded.owner_id
      where coalesce(pg_temp.pms_ts(excluded.data->'updatedAt'), 'epoch') > coalesce(pg_temp.pms_ts(t.data->'updatedAt'), 'epoch');
  end loop;
  for r in select x from jsonb_array_elements(case when jsonb_typeof(payload->'payments') = 'array' then payload->'payments' else '[]' end) x loop
    insert into public.pms_payments as t (id, data, archived, lease_id, property_id, tenant_id, created_at)
    values (r->>'id', r, coalesce((r->>'archived')::boolean, false), nullif(r->>'lease_id', ''), nullif(r->>'property_id', ''), nullif(r->>'tenant_id', ''), coalesce(pg_temp.pms_ts(r->'createdAt'), now()))
    on conflict (id) do update set data = excluded.data, archived = excluded.archived, lease_id = excluded.lease_id, property_id = excluded.property_id, tenant_id = excluded.tenant_id
      where coalesce(pg_temp.pms_ts(excluded.data->'updatedAt'), 'epoch') > coalesce(pg_temp.pms_ts(t.data->'updatedAt'), 'epoch');
  end loop;
  for r in select x from jsonb_array_elements(case when jsonb_typeof(payload->'maintenance') = 'array' then payload->'maintenance' else '[]' end) x loop
    insert into public.pms_maintenance as t (id, data, archived, property_id, unit_id, created_at)
    values (r->>'id', r, coalesce((r->>'archived')::boolean, false), nullif(r->>'property_id', ''), nullif(r->>'unit_id', ''), coalesce(pg_temp.pms_ts(r->'createdAt'), now()))
    on conflict (id) do update set data = excluded.data, archived = excluded.archived, property_id = excluded.property_id, unit_id = excluded.unit_id
      where coalesce(pg_temp.pms_ts(excluded.data->'updatedAt'), 'epoch') > coalesce(pg_temp.pms_ts(t.data->'updatedAt'), 'epoch');
  end loop;
  for r in select x from jsonb_array_elements(case when jsonb_typeof(payload->'expenses') = 'array' then payload->'expenses' else '[]' end) x loop
    insert into public.pms_expenses as t (id, data, archived, property_id, created_at)
    values (r->>'id', r, coalesce((r->>'archived')::boolean, false), nullif(r->>'property_id', ''), coalesce(pg_temp.pms_ts(r->'createdAt'), now()))
    on conflict (id) do update set data = excluded.data, archived = excluded.archived, property_id = excluded.property_id
      where coalesce(pg_temp.pms_ts(excluded.data->'updatedAt'), 'epoch') > coalesce(pg_temp.pms_ts(t.data->'updatedAt'), 'epoch');
  end loop;
  for r in select x from jsonb_array_elements(case when jsonb_typeof(payload->'documents') = 'array' then payload->'documents' else '[]' end) x loop
    insert into public.pms_documents as t (id, data, archived, property_id, unit_id, created_at)
    values (r->>'id', r, coalesce((r->>'archived')::boolean, false), nullif(r->>'property_id', ''), nullif(r->>'unit_id', ''), coalesce(pg_temp.pms_ts(r->'createdAt'), now()))
    on conflict (id) do update set data = excluded.data, archived = excluded.archived, property_id = excluded.property_id, unit_id = excluded.unit_id
      where coalesce(pg_temp.pms_ts(excluded.data->'updatedAt'), 'epoch') > coalesce(pg_temp.pms_ts(t.data->'updatedAt'), 'epoch');
  end loop;
end $$;

-- Oldest first, so the most recently saved workspace wins ties.
select pg_temp.pms_import(w.payload) from public.pms_workspaces w order by w.updated_at;
select pg_temp.pms_import(a.payload -> 'pms')
from public.app_state a join public.profiles p on p.id = a.owner_id
where p.role = 'super-admin'
  and not exists (select 1 from public.pms_workspaces w where w.owner_id = a.owner_id);

-- 5. Old record: read-only for staff, and no more PMS copies in app_state ------
-- (A phone still running the old app gets a save error and reloads.)
drop policy if exists "pms workspace linked read" on public.pms_workspaces;
drop policy if exists "pms workspace admin insert" on public.pms_workspaces;
drop policy if exists "pms workspace admin update" on public.pms_workspaces;
drop policy if exists "pms workspace admin delete" on public.pms_workspaces;
drop policy if exists "pms workspace staff read" on public.pms_workspaces;
create policy "pms workspace staff read" on public.pms_workspaces for select using (public.is_super_admin());
revoke all on public.pms_workspaces from anon;
drop function if exists public.pms_workspace_can_read(jsonb);

update public.app_state
set payload = payload - 'pms' - 'pmsInsights' - 'pmsInsightsLoaded'
where payload ? 'pms' or payload ? 'pmsInsights' or payload ? 'pmsInsightsLoaded';

commit;

notify pgrst, 'reload schema';

-- Check: record counts in the new tables, and links found for owner/tenant logins.
select
  (select count(*) from public.pms_properties) as properties,
  (select count(*) from public.pms_units) as units,
  (select count(*) from public.pms_owners) as owners,
  (select count(*) from public.pms_owners where auth_user_id is not null) as owners_with_login,
  (select count(*) from public.pms_tenants) as tenants,
  (select count(*) from public.pms_tenants where auth_user_id is not null) as tenants_with_login,
  (select count(*) from public.pms_leases) as leases,
  (select count(*) from public.pms_payments) as payments,
  (select count(*) from public.pms_maintenance) as maintenance,
  (select count(*) from public.pms_expenses) as expenses,
  (select count(*) from public.pms_documents) as documents;
