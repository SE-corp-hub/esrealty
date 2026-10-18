-- PMS Normalization: projects the legacy workspace JSONB payload into proper
-- relational tables so portfolios become queryable (analytics, joins, BI).
--
-- HOW IT WORKS
--   * The app keeps saving state.pms exactly as before (single payload blob).
--   * A trigger unpacks every payload change into the tables below.
--   * Existing workspaces are backfilled automatically.
--   * Tables are read-only to clients; writes happen only inside the definer
--     trigger, so the payload stays the single source of truth.
--
-- Run AFTER schema.sql / repair_schema.sql. Idempotent: safe to re-run.

begin;

-- ── 1. Normalized entity tables ───────────────────────────────────────
create table if not exists public.pms_properties (
  owner_id uuid not null,
  id       text not null,
  data     jsonb not null default '{}'::jsonb,
  title    text generated always as (data ->> 'title') stored,
  status   text generated always as (data ->> 'status') stored,
  city     text generated always as (data ->> 'city') stored,
  primary key (owner_id, id)
);

create table if not exists public.pms_units (
  owner_id    uuid not null,
  id          text not null,
  data        jsonb not null default '{}'::jsonb,
  property_id text generated always as (data ->> 'property_id') stored,
  unit_no     text generated always as (coalesce(data ->> 'name', data ->> 'unit_no')) stored,
  status      text generated always as (data ->> 'status') stored,
  primary key (owner_id, id)
);

create table if not exists public.pms_owners (
  owner_id uuid not null,
  id       text not null,
  data     jsonb not null default '{}'::jsonb,
  name     text generated always as (data ->> 'name') stored,
  email    text generated always as (data ->> 'email') stored,
  primary key (owner_id, id)
);

create table if not exists public.pms_tenants (
  owner_id uuid not null,
  id       text not null,
  data     jsonb not null default '{}'::jsonb,
  name     text generated always as (data ->> 'name') stored,
  email    text generated always as (data ->> 'email') stored,
  primary key (owner_id, id)
);

create table if not exists public.pms_leases (
  owner_id    uuid not null,
  id          text not null,
  data        jsonb not null default '{}'::jsonb,
  property_id text generated always as (data ->> 'property_id') stored,
  unit_id     text generated always as (data ->> 'unit_id') stored,
  tenant_id   text generated always as (data ->> 'tenant_id') stored,
  start_date  text generated always as (data ->> 'start') stored,
  end_date    text generated always as (data ->> 'end') stored,
  rent        text generated always as (data ->> 'rent') stored,
  status      text generated always as (data ->> 'status') stored,
  primary key (owner_id, id)
);

create table if not exists public.pms_payments (
  owner_id  uuid not null,
  id        text not null,
  data      jsonb not null default '{}'::jsonb,
  lease_id  text generated always as (data ->> 'lease_id') stored,
  pay_date  text generated always as (data ->> 'date') stored,
  month_lbl text generated always as (data ->> 'month') stored,
  amount    text generated always as (data ->> 'amount') stored,
  status    text generated always as (data ->> 'status') stored,
  primary key (owner_id, id)
);

create table if not exists public.pps_maintenance (
  owner_id    uuid not null,
  id          text not null,
  data        jsonb not null default '{}'::jsonb,
  property_id text generated always as (data ->> 'property_id') stored,
  title       text generated always as (data ->> 'title') stored,
  cost        text generated always as (data ->> 'cost') stored,
  priority    text generated always as (data ->> 'priority') stored,
  status      text generated always as (data ->> 'status') stored,
  primary key (owner_id, id)
);

create table if not exists public.pps_expenses (
  owner_id    uuid not null,
  id          text not null,
  data        jsonb not null default '{}'::jsonb,
  property_id text generated always as (data ->> 'property_id') stored,
  category    text generated always as (data ->> 'category') stored,
  amount      text generated always as (data ->> 'amount') stored,
  exp_date    text generated always as (data ->> 'date') stored,
  primary key (owner_id, id)
);

create table if not exists public.pms_documents (
  owner_id uuid not null,
  id       text not null,
  data     jsonb not null default '{}'::jsonb,
  name     text generated always as (data ->> 'name') stored,
  category text generated always as (data ->> 'category') stored,
  primary key (owner_id, id)
);

-- ── 2. Projection function ────────────────────────────────────────────
create or replace function public.pms_project_payload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e jsonb;
begin
  -- properties ---------------------------------------------------------
  delete from public.pms_properties where owner_id = new.owner_id;
  for e in select * from jsonb_array_elements(coalesce(new.payload -> 'properties', '[]'::jsonb))
  loop
    insert into public.pms_properties (owner_id, id, data)
    values (new.owner_id, coalesce(e ->> 'id', left(md5(e::text), 32)), e);
  end loop;

  -- units ----------------------------------------------------------------
  delete from public.pms_units where owner_id = new.owner_id;
  for e in select * from jsonb_array_elements(coalesce(new.payload -> 'units', '[]'::jsonb))
  loop
    insert into public.pms_units (owner_id, id, data)
    values (new.owner_id, coalesce(e ->> 'id', left(md5(e::text), 32)), e);
  end loop;

  -- owners ----------------------------------------------------------------
  delete from public.pms_owners where owner_id = new.owner_id;
  for e in select * from jsonb_array_elements(coalesce(new.payload -> 'owners', '[]'::jsonb))
  loop
    insert into public.pms_owners (owner_id, id, data)
    values (new.owner_id, coalesce(e ->> 'id', left(md5(e::text), 32)), e);
  end loop;

  -- tenants ---------------------------------------------------------------
  delete from public.pms_tenants where owner_id = new.owner_id;
  for e in select * from jsonb_array_elements(coalesce(new.payload -> 'tenants', '[]'::jsonb))
  loop
    insert into public.pms_tenants (owner_id, id, data)
    values (new.owner_id, coalesce(e ->> 'id', left(md5(e::text), 32)), e);
  end loop;

  -- leases -----------------------------------------------------------------
  delete from public.pms_leases where owner_id = new.owner_id;
  for e in select * from jsonb_array_elements(coalesce(new.payload -> 'leases', '[]'::jsonb))
  loop
    insert into public.pms_leases (owner_id, id, data)
    values (new.owner_id, coalesce(e ->> 'id', left(md5(e::text), 32)), e);
  end loop;

  -- payments ----------------------------------------------------------------
  delete from public.pms_payments where owner_id = new.owner_id;
  for e in select * from jsonb_array_elements(coalesce(new.payload -> 'payments', '[]'::jsonb))
  loop
    insert into public.pms_payments (owner_id, id, data)
    values (new.owner_id, coalesce(e ->> 'id', left(md5(e::text), 32)), e);
  end loop;

  -- maintenance --------------------------------------------------------------
  delete from public.pps_maintenance where owner_id = new.owner_id;
  for e in select * from jsonb_array_elements(coalesce(new.payload -> 'maintenance', '[]'::jsonb))
  loop
    insert into public.pps_maintenance (owner_id, id, data)
    values (new.owner_id, coalesce(e ->> 'id', left(md5(e::text), 32)), e);
  end loop;

  -- expenses -------------------------------------------------------------------
  delete from public.pps_expenses where owner_id = new.owner_id;
  for e in select * from jsonb_array_elements(coalesce(new.payload -> 'expenses', '[]'::jsonb))
  loop
    insert into public.pps_expenses (owner_id, id, data)
    values (new.owner_id, coalesce(e ->> 'id', left(md5(e::text), 32)), e);
  end loop;

  -- documents --------------------------------------------------------------------
  delete from public.pms_documents where owner_id = new.owner_id;
  for e in select * from jsonb_array_elements(coalesce(new.payload -> 'documents', '[]'::jsonb))
  loop
    insert into public.pms_documents (owner_id, id, data)
    values (new.owner_id, coalesce(e ->> 'id', left(md5(e::text), 32)), e);
  end loop;

  return new;
end;
$$;

drop trigger if exists pms_project_payload_trg on public.pms_workspaces;
create trigger pms_project_payload_trg
  after insert or update of payload on public.pms_workspaces
  for each row execute function public.pms_project_payload();

create or replace function public.pms_unproject_payload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.pms_properties where owner_id = old.owner_id;
  delete from public.pms_units      where owner_id = old.owner_id;
  delete from public.pms_owners     where owner_id = old.owner_id;
  delete from public.pms_tenants    where owner_id = old.owner_id;
  delete from public.pms_leases     where owner_id = old.owner_id;
  delete from public.pms_payments   where owner_id = old.owner_id;
  delete from public.pps_maintenance where owner_id = old.owner_id;
  delete from public.pps_expenses   where owner_id = old.owner_id;
  delete from public.pms_documents  where owner_id = old.owner_id;
  return old;
end;
$$;

drop trigger if exists pms_unproject_payload_trg on public.pms_workspaces;
create trigger pms_unproject_payload_trg
  after delete on public.pms_workspaces
  for each row execute function public.pms_unproject_payload();

-- ── 3. Access control ────────────────────────────────────────────────
-- Read: your own workspace rows, plus super-admin sees everything.
alter table public.pms_properties enable row level security;
alter table public.pms_units enable row level security;
alter table public.pms_owners enable row level security;
alter table public.pms_tenants enable row level security;
alter table public.pms_leases enable row level security;
alter table public.pms_payments enable row level security;
alter table public.pps_maintenance enable row level security;
alter table public.pps_expenses enable row level security;
alter table public.pms_documents enable row level security;

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'pms_properties', 'pms_units', 'pms_owners', 'pms_tenants',
    'pms_leases', 'pms_payments', 'pps_maintenance',
    'pps_expenses', 'pms_documents'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', tbl || '_read', tbl);
    execute format($f$
      create policy %I on public.%I for select
      using (owner_id = auth.uid() or public.is_super_admin())
    $f$, tbl || '_read', tbl);

    execute format('revoke insert, update, delete on table public.%I from authenticated', tbl);
    execute format('revoke all on table public.%I from anon', tbl);
  end loop;
end $$;

-- ── 4. Portfolio insights (cross-workspace for Super Admin) ──────────
create or replace function public.pms_insights()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with scope as (
    select case when public.is_super_admin() then null else auth.uid() end as uid
  )
  select jsonb_build_object(
    'properties_total',    (select count(*) from public.pms_properties x, scope s where s.uid is null or x.owner_id = s.uid),
    'units_total',         (select count(*) from public.pms_units x, scope s where s.uid is null or x.owner_id = s.uid),
    'units_occupied',      (select count(*) from public.pms_units x, scope s where s.uid is null or x.owner_id = s.uid and x.status = 'occupied'),
    'leases_active',       (select count(*) from public.pms_leases x, scope s where s.uid is null or x.owner_id = s.uid and x.status = 'active'),
    'collected',           (select coalesce(sum(nullif(x.amount, '')::numeric), 0) from public.pms_payments x, scope s where (s.uid is null or x.owner_id = s.uid) and x.status = 'paid'),
    'arrears_pending',     (select coalesce(sum(nullif(x.amount, '')::numeric), 0) from public.pms_payments x, scope s where (s.uid is null or x.owner_id = s.uid) and x.status in ('pending', 'late')),
    'expenses_total',      (select coalesce(sum(nullif(x.amount, '')::numeric), 0) from public.pps_expenses x, scope s where s.uid is null or x.owner_id = s.uid),
    'maintenance_open',    (select count(*) from public.pps_maintenance x, scope s where (s.uid is null or x.owner_id = s.uid) and x.status <> 'completed'),
    'documents_total',     (select count(*) from public.pms_documents x, scope s where s.uid is null or x.owner_id = s.uid),
    'generated_at',        now()
  );
$$;

revoke all on function public.pms_insights() from public, anon;
grant execute on function public.pms_insights() to authenticated;

commit;
