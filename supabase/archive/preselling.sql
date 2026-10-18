-- Pre-Selling Inventory: projects and unit matrix for Philippine pre-selling sales.
-- Run AFTER schema.sql and notifications.sql. Idempotent: safe to re-run.

begin;

-- ── Projects ────────────────────────────────────────────────────────
create table if not exists public.presell_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  developer text not null default '',
  location text not null default '',
  lts_no text not null default '',
  turnover_date date,
  description text not null default '',
  status text not null default 'active'
    check (status in ('active', 'sold_out', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint presell_projects_name_valid
    check (btrim(name) <> '' and char_length(name) <= 200),
  constraint presell_projects_lts_len
    check (char_length(lts_no) <= 100)
);

create index if not exists presell_projects_status_idx
  on public.presell_projects (status, updated_at desc);

alter table public.presell_projects enable row level security;

drop policy if exists "presell projects read auth" on public.presell_projects;
create policy "presell projects read auth" on public.presell_projects
  for select using (auth.role() = 'authenticated');

drop policy if exists "presell projects admin write" on public.presell_projects;
create policy "presell projects admin write" on public.presell_projects
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

drop trigger if exists presell_projects_set_updated_at on public.presell_projects;
create trigger presell_projects_set_updated_at
  before update on public.presell_projects
  for each row execute function public.set_updated_at();

-- ── Units ───────────────────────────────────────────────────────────
create table if not exists public.presell_units (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.presell_projects(id) on delete cascade,
  unit_no text not null,
  tower text not null default '',
  floor int,
  unit_type text not null default '',
  price numeric(14, 2) not null default 0
    check (price >= 0),
  status text not null default 'available'
    check (status in ('available', 'reserved', 'sold', 'blocked')),
  reserved_for text not null default '',
  reserved_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint presell_units_code_valid
    check (btrim(unit_no) <> '' and char_length(unit_no) <= 60)
);

create index if not exists presell_units_project_idx
  on public.presell_units (project_id, status);

alter table public.presell_units enable row level security;

drop policy if exists "presell units read auth" on public.presell_units;
create policy "presell units read auth" on public.presell_units
  for select using (auth.role() = 'authenticated');

drop policy if exists "presell units admin write" on public.presell_units;
create policy "presell units admin write" on public.presell_units
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

drop trigger if exists presell_units_set_updated_at on public.presell_units;
create trigger presell_units_set_updated_at
  before update on public.presell_units
  for each row execute function public.set_updated_at();

-- ── Realtime: live unit-status updates across devices ───────────────
do $$
begin
  alter publication supabase_realtime add table public.presell_units;
exception
  when duplicate_object then null;
  when others then
    if sqlerrm like '%already%' then null; else raise; end if;
end $$;

commit;
