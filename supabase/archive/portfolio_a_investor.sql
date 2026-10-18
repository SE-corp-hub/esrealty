-- Portfolio A — Investor: assets + cash-on-hand + construction + presell link
-- ES Realty, single-owner investor model (owner_id = auth.users.id)
-- Idempotent: safe to re-run. Requires schema.sql (is_super_admin, set_updated_at)

begin;

-- ── helper: updated_at ───────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ── Portfolio Accounts (bank / cash-on-hand) ─────────────────────
create table if not exists public.portfolio_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  bank_name text not null default '',
  account_type text not null default 'cash' check (account_type in ('bank','cash','ewallet','escrow')),
  opening_balance numeric(14,2) not null default 0 check (opening_balance >= 0),
  as_of date not null default current_date,
  currency text not null default 'PHP' check (char_length(currency) <= 8),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolio_accounts_label_valid check (btrim(label) <> '' and char_length(label) <= 120)
);
create index if not exists portfolio_accounts_owner_idx on public.portfolio_accounts(owner_id, updated_at desc);
alter table public.portfolio_accounts enable row level security;
drop policy if exists "portfolio accounts owner read" on public.portfolio_accounts;
create policy "portfolio accounts owner read" on public.portfolio_accounts for select
  using (auth.uid() = owner_id or public.is_super_admin());
drop policy if exists "portfolio accounts owner write" on public.portfolio_accounts;
create policy "portfolio accounts owner write" on public.portfolio_accounts for all
  using (auth.uid() = owner_id or public.is_super_admin())
  with check (auth.uid() = owner_id or public.is_super_admin());
drop trigger if exists portfolio_accounts_set_updated_at on public.portfolio_accounts;
create trigger portfolio_accounts_set_updated_at before update on public.portfolio_accounts
  for each row execute function public.set_updated_at();

-- ── Construction Projects ────────────────────────────────────────
create table if not exists public.construction_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  asset_id text not null default '',
  presell_project_id uuid references public.presell_projects(id) on delete set null,
  name text not null,
  site text not null default '',
  contractor text not null default '',
  architect text not null default '',
  permit_status text not null default 'pending' check (permit_status in ('pending','approved','issued','expired')),
  status text not null default 'planned' check (status in ('planned','in_progress','on_hold','completed','archived')),
  start_date date,
  target_completion date,
  actual_completion date,
  contract_value numeric(14,2) not null default 0 check (contract_value >= 0),
  contingency numeric(14,2) not null default 0 check (contingency >= 0),
  retention numeric(14,2) not null default 0 check (retention >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint construction_projects_name_valid check (btrim(name) <> '' and char_length(name) <= 200)
);
create index if not exists construction_projects_owner_idx on public.construction_projects(owner_id, status);
alter table public.construction_projects enable row level security;
drop policy if exists "construction owner read" on public.construction_projects;
create policy "construction owner read" on public.construction_projects for select
  using (auth.uid() = owner_id or public.is_super_admin());
drop policy if exists "construction owner write" on public.construction_projects;
create policy "construction owner write" on public.construction_projects for all
  using (auth.uid() = owner_id or public.is_super_admin())
  with check (auth.uid() = owner_id or public.is_super_admin());
drop trigger if exists construction_projects_set_updated_at on public.construction_projects;
create trigger construction_projects_set_updated_at before update on public.construction_projects
  for each row execute function public.set_updated_at();

-- ── Construction Phases ──────────────────────────────────────────
create table if not exists public.construction_phases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.construction_projects(id) on delete cascade,
  name text not null,
  planned_budget numeric(14,2) not null default 0 check (planned_budget >= 0),
  approved_budget numeric(14,2) not null default 0 check (approved_budget >= 0),
  committed numeric(14,2) not null default 0 check (committed >= 0),
  paid numeric(14,2) not null default 0 check (paid >= 0),
  percent_complete numeric(5,2) not null default 0 check (percent_complete >= 0 and percent_complete <= 100),
  start_date date,
  end_date date,
  responsible text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint construction_phases_name_valid check (btrim(name) <> '' and char_length(name) <= 120)
);
create index if not exists construction_phases_project_idx on public.construction_phases(project_id);
alter table public.construction_phases enable row level security;
drop policy if exists "phases owner read" on public.construction_phases;
create policy "phases owner read" on public.construction_phases for select
  using (exists (select 1 from public.construction_projects p where p.id = project_id and (p.owner_id = auth.uid() or public.is_super_admin())));
drop policy if exists "phases owner write" on public.construction_phases;
create policy "phases owner write" on public.construction_phases for all
  using (exists (select 1 from public.construction_projects p where p.id = project_id and (p.owner_id = auth.uid() or public.is_super_admin())))
  with check (exists (select 1 from public.construction_projects p where p.id = project_id and (p.owner_id = auth.uid() or public.is_super_admin())));
drop trigger if exists construction_phases_set_updated_at on public.construction_phases;
create trigger construction_phases_set_updated_at before update on public.construction_phases
  for each row execute function public.set_updated_at();

-- Phase 2 depth: guarded columns on existing tables (idempotent re-runs)
alter table public.construction_projects add column if not exists retention_rate numeric(5,2) not null default 0;
alter table public.construction_projects add column if not exists allocation text not null default 'equal'
  check (allocation in ('equal','floor_area','actual','manual'));
alter table public.construction_projects add column if not exists presell_link jsonb not null default 'null'::jsonb;
alter table public.construction_phases add column if not exists allocation text not null default 'equal'
  check (allocation in ('equal','floor_area','actual','manual'));

-- ── Construction Vendors ─────────────────────────────────────────
create table if not exists public.construction_vendors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.construction_projects(id) on delete cascade,
  name text not null,
  contact text not null default '',
  tax_id text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint construction_vendors_name_valid check (btrim(name) <> '' and char_length(name) <= 200)
);
create index if not exists construction_vendors_project_idx on public.construction_vendors(project_id);
alter table public.construction_vendors enable row level security;
drop policy if exists "vendors owner read" on public.construction_vendors;
create policy "vendors owner read" on public.construction_vendors for select
  using (exists (select 1 from public.construction_projects p where p.id = project_id and (p.owner_id = auth.uid() or public.is_super_admin())));
drop policy if exists "vendors owner write" on public.construction_vendors;
create policy "vendors owner write" on public.construction_vendors for all
  using (exists (select 1 from public.construction_projects p where p.id = project_id and (p.owner_id = auth.uid() or public.is_super_admin())))
  with check (exists (select 1 from public.construction_projects p where p.id = project_id and (p.owner_id = auth.uid() or public.is_super_admin())));
drop trigger if exists construction_vendors_set_updated_at on public.construction_vendors;
create trigger construction_vendors_set_updated_at before update on public.construction_vendors
  for each row execute function public.set_updated_at();

-- ── Construction Invoices ────────────────────────────────────────
create table if not exists public.construction_invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.construction_projects(id) on delete cascade,
  phase_id uuid references public.construction_phases(id) on delete set null,
  vendor_id uuid references public.construction_vendors(id) on delete set null,
  invoice_no text not null,
  invoice_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','approved','paid')),
  ledger_entry_id uuid,
  paid_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint construction_invoices_no_valid check (btrim(invoice_no) <> '' and char_length(invoice_no) <= 80)
);
create index if not exists construction_invoices_project_idx on public.construction_invoices(project_id, status);
alter table public.construction_invoices enable row level security;
drop policy if exists "invoices owner read" on public.construction_invoices;
create policy "invoices owner read" on public.construction_invoices for select
  using (exists (select 1 from public.construction_projects p where p.id = project_id and (p.owner_id = auth.uid() or public.is_super_admin())));
drop policy if exists "invoices owner write" on public.construction_invoices;
create policy "invoices owner write" on public.construction_invoices for all
  using (exists (select 1 from public.construction_projects p where p.id = project_id and (p.owner_id = auth.uid() or public.is_super_admin())))
  with check (exists (select 1 from public.construction_projects p where p.id = project_id and (p.owner_id = auth.uid() or public.is_super_admin())));
drop trigger if exists construction_invoices_set_updated_at on public.construction_invoices;
create trigger construction_invoices_set_updated_at before update on public.construction_invoices
  for each row execute function public.set_updated_at();

-- ── Construction Change Orders ───────────────────────────────────
create table if not exists public.construction_change_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.construction_projects(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  reason text not null,
  approver text not null default '',
  co_date date not null default current_date,
  status text not null default 'approved' check (status in ('draft','approved','rejected')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint construction_change_orders_reason_valid check (btrim(reason) <> '' and char_length(reason) <= 500)
);
create index if not exists construction_change_orders_project_idx on public.construction_change_orders(project_id);
alter table public.construction_change_orders enable row level security;
drop policy if exists "change orders owner read" on public.construction_change_orders;
create policy "change orders owner read" on public.construction_change_orders for select
  using (exists (select 1 from public.construction_projects p where p.id = project_id and (p.owner_id = auth.uid() or public.is_super_admin())));
drop policy if exists "change orders owner write" on public.construction_change_orders;
create policy "change orders owner write" on public.construction_change_orders for all
  using (exists (select 1 from public.construction_projects p where p.id = project_id and (p.owner_id = auth.uid() or public.is_super_admin())))
  with check (exists (select 1 from public.construction_projects p where p.id = project_id and (p.owner_id = auth.uid() or public.is_super_admin())));
drop trigger if exists construction_change_orders_set_updated_at on public.construction_change_orders;
create trigger construction_change_orders_set_updated_at before update on public.construction_change_orders
  for each row execute function public.set_updated_at();

-- ── Cash Ledger ──────────────────────────────────────────────────
do $$ begin
create table if not exists public.cash_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.portfolio_accounts(id) on delete cascade,
  entry_date date not null default current_date,
  direction text not null check (direction in ('in','out')),
  amount numeric(14,2) not null check (amount > 0),
  category text not null default '',
  purpose text not null default '' check (purpose in ('', 'project_selling','construction','others')),
  subcategory text not null default '',
  description text not null default '',
  counterparty text not null default '',
  reference_no text not null default '',
  linked_asset_id text not null default '',
  linked_construction_id uuid references public.construction_projects(id) on delete set null,
  linked_phase_id uuid references public.construction_phases(id) on delete set null,
  linked_presell_project_id uuid references public.presell_projects(id) on delete set null,
  linked_presell_payment_id text not null default '',
  linked_transaction_id text not null default '',
  proof_required boolean not null default false,
  status text not null default 'posted' check (status in ('draft','pending','posted','voided','reversed')),
  reversal_of uuid references public.cash_entries(id) on delete set null,
  idempotency_key text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
exception when duplicate_table then null;
end $$;
-- construction_invoices FKs cash_entries, which is created above; adding the
-- FK via ALTER here (instead of inline in the CREATE TABLE) avoids the
-- 42P01 "relation public.cash_entries does not exist" forward-reference from
-- the earlier construction_invoices DDL.
do $$ begin
  alter table public.construction_invoices add constraint construction_invoices_ledger_entry_fk
    foreign key (ledger_entry_id) references public.cash_entries(id) on delete set null;
exception when duplicate_object or duplicate_table then null;
end $$;
alter table public.cash_entries add column if not exists linked_presell_project_id uuid references public.presell_projects(id) on delete set null;
-- add checks idempotently
do $$ begin
  alter table public.cash_entries add constraint cash_entries_purpose_check check (
    (direction = 'in' and purpose = '') or
    (direction = 'out' and purpose in ('project_selling','construction','others'))
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.cash_entries add constraint cash_entries_others_check check (
    purpose <> 'others' or (btrim(subcategory) <> '' and btrim(description) <> '')
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.cash_entries add constraint cash_entries_idempotency_unique unique (owner_id, idempotency_key) deferrable initially deferred;
exception when duplicate_object then null;
end $$;
create index if not exists cash_entries_account_date_idx on public.cash_entries(account_id, entry_date desc);
create index if not exists cash_entries_owner_status_idx on public.cash_entries(owner_id, status);
create index if not exists cash_entries_link_idx on public.cash_entries(linked_asset_id, linked_construction_id);
alter table public.cash_entries enable row level security;
drop policy if exists "cash owner read" on public.cash_entries;
create policy "cash owner read" on public.cash_entries for select
  using (auth.uid() = owner_id or public.is_super_admin());
drop policy if exists "cash owner write" on public.cash_entries;
create policy "cash owner write" on public.cash_entries for all
  using (auth.uid() = owner_id or public.is_super_admin())
  with check (auth.uid() = owner_id or public.is_super_admin());
drop trigger if exists cash_entries_set_updated_at on public.cash_entries;
create trigger cash_entries_set_updated_at before update on public.cash_entries
  for each row execute function public.set_updated_at();

-- ── Audit helper (optional, uses existing app_state audit if needed) ─
-- cash_entries, construction_projects/phases already have created_by/updated_at; use Supabase audit via triggers if required.

-- ── Portfolio Proofs (private financial proof metadata) ───────────
-- Local/demo mode stores a downsized copy in the browser and writes only
-- metadata here when signed in. Never expose private proofs via public URLs.
create table if not exists public.portfolio_proofs (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.cash_entries(id) on delete cascade,
  filename text not null,
  mimetype text not null default '',
  byte_size bigint not null default 0 check (byte_size >= 0),
  checksum text not null default '',
  category text not null default 'other' check (category in ('receipt','deposit_slip','transfer_confirmation','contract','invoice','other')),
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  storage_path text not null default '',
  storage_mode text not null default 'local' check (storage_mode in ('local','supabase')),
  proof_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolio_proofs_filename_valid check (btrim(filename) <> '' and char_length(filename) <= 260),
  constraint portfolio_proofs_mime_valid check (mimetype in ('image/jpeg','image/png','image/gif','image/webp','application/pdf',''))
);
create index if not exists portfolio_proofs_entry_idx on public.portfolio_proofs(entry_id, proof_order);
alter table public.portfolio_proofs enable row level security;
drop policy if exists "portfolio proofs owner read" on public.portfolio_proofs;
create policy "portfolio proofs owner read" on public.portfolio_proofs for select
  using (exists (select 1 from public.cash_entries c where c.id = entry_id and (c.owner_id = auth.uid() or public.is_super_admin())));
drop policy if exists "portfolio proofs owner write" on public.portfolio_proofs;
create policy "portfolio proofs owner write" on public.portfolio_proofs for all
  using (exists (select 1 from public.cash_entries c where c.id = entry_id and (c.owner_id = auth.uid() or public.is_super_admin())))
  with check (exists (select 1 from public.cash_entries c where c.id = entry_id and (c.owner_id = auth.uid() or public.is_super_admin())));
drop trigger if exists portfolio_proofs_set_updated_at on public.portfolio_proofs;
create trigger portfolio_proofs_set_updated_at before update on public.portfolio_proofs
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';

commit;
