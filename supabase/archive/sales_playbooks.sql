-- Super Admin-only Sales Playbook storage.
-- Run after schema.sql or repair_schema.sql so public.is_super_admin()
-- and public.set_updated_at() already exist.

begin;

create table if not exists public.sales_playbooks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null default '',
  category text not null default 'General',
  sales_stage text not null default 'Discovery',
  property_type text not null default 'All Properties',
  target_customer text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  sections jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_by uuid default auth.uid()
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sales_playbooks_title_valid
    check (btrim(title) <> '' and char_length(title) <= 200),
  constraint sales_playbooks_summary_valid
    check (char_length(summary) <= 2000),
  constraint sales_playbooks_category_valid
    check (category in ('OFW Buyer', 'First-Time Homebuyer', 'End-User', 'Investor', 'Balikbayan', 'Relocating Expat', 'Corporate Lease', 'Developer Bulk')),
  constraint sales_playbooks_stage_valid
    check (sales_stage in ('Lead Generation', 'Initial Consultation', 'Property Matching', 'Site Viewing', 'Price Negotiation', 'Reservation', 'Contract to Sell', 'Financing', 'Turnover', 'Post-Sale')),
  constraint sales_playbooks_property_type_valid
    check (property_type in ('Condominium', 'House & Lot', 'Townhouse', 'Shophouse', 'Lot Only', 'Warehouse', 'Mixed-Use', 'Farm Lot')),
  constraint sales_playbooks_target_valid
    check (char_length(target_customer) <= 200),
  constraint sales_playbooks_sections_object
    check (jsonb_typeof(sections) = 'object')
);

-- ── Upgrade constraints on pre-existing tables ─────────────────────────
-- create table if not exists does NOT update an already-deployed table,
-- so older deployments keep the legacy domain lists. Drop and re-add.
alter table public.sales_playbooks drop constraint if exists sales_playbooks_category_valid;
alter table public.sales_playbooks drop constraint if exists sales_playbooks_stage_valid;
alter table public.sales_playbooks drop constraint if exists sales_playbooks_property_type_valid;

delete from public.sales_playbooks
  where category not in ('OFW Buyer', 'First-Time Homebuyer', 'End-User', 'Investor', 'Balikbayan', 'Relocating Expat', 'Corporate Lease', 'Developer Bulk')
     or sales_stage not in ('Lead Generation', 'Initial Consultation', 'Property Matching', 'Site Viewing', 'Price Negotiation', 'Reservation', 'Contract to Sell', 'Financing', 'Turnover', 'Post-Sale')
     or property_type not in ('Condominium', 'House & Lot', 'Townhouse', 'Shophouse', 'Lot Only', 'Warehouse', 'Mixed-Use', 'Farm Lot');

alter table public.sales_playbooks add constraint sales_playbooks_category_valid
  check (category in ('OFW Buyer', 'First-Time Homebuyer', 'End-User', 'Investor', 'Balikbayan', 'Relocating Expat', 'Corporate Lease', 'Developer Bulk'));
alter table public.sales_playbooks add constraint sales_playbooks_stage_valid
  check (sales_stage in ('Lead Generation', 'Initial Consultation', 'Property Matching', 'Site Viewing', 'Price Negotiation', 'Reservation', 'Contract to Sell', 'Financing', 'Turnover', 'Post-Sale'));
alter table public.sales_playbooks add constraint sales_playbooks_property_type_valid
  check (property_type in ('Condominium', 'House & Lot', 'Townhouse', 'Shophouse', 'Lot Only', 'Warehouse', 'Mixed-Use', 'Farm Lot'));
-- ────────────────────────────────────────────────────────────────────────

create index if not exists sales_playbooks_status_updated_idx
  on public.sales_playbooks (status, updated_at desc);

create index if not exists sales_playbooks_order_idx
  on public.sales_playbooks (sort_order, updated_at desc);

drop trigger if exists sales_playbooks_set_updated_at
  on public.sales_playbooks;

create trigger sales_playbooks_set_updated_at
  before update on public.sales_playbooks
  for each row execute function public.set_updated_at();

alter table public.sales_playbooks enable row level security;
alter table public.sales_playbooks force row level security;

drop policy if exists "sales playbooks super admin read"
  on public.sales_playbooks;
drop policy if exists "sales playbooks super admin insert"
  on public.sales_playbooks;
drop policy if exists "sales playbooks super admin update"
  on public.sales_playbooks;
drop policy if exists "sales playbooks super admin delete"
  on public.sales_playbooks;

create policy "sales playbooks super admin read"
  on public.sales_playbooks
  for select to authenticated
  using (public.is_super_admin());

create policy "sales playbooks super admin insert"
  on public.sales_playbooks
  for insert to authenticated
  with check (
    public.is_super_admin()
    and created_by = auth.uid()
  );

create policy "sales playbooks super admin update"
  on public.sales_playbooks
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "sales playbooks super admin delete"
  on public.sales_playbooks
  for delete to authenticated
  using (public.is_super_admin());

revoke all privileges on table public.sales_playbooks
  from public, anon, authenticated;

grant select, delete on table public.sales_playbooks
  to authenticated;

grant insert (
  title, summary, category, sales_stage, property_type,
  target_customer, status, sections, sort_order
) on public.sales_playbooks to authenticated;

grant update (
  title, summary, category, sales_stage, property_type,
  target_customer, status, sections, sort_order
) on public.sales_playbooks to authenticated;

create or replace function public.swap_sales_playbook_order(
  first_id uuid,
  second_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_order integer;
  second_order integer;
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access required';
  end if;

  select sort_order into first_order
  from public.sales_playbooks
  where id = first_id
  for update;

  select sort_order into second_order
  from public.sales_playbooks
  where id = second_id
  for update;

  if first_order is null or second_order is null then
    raise exception 'Playbook not found';
  end if;

  update public.sales_playbooks
  set sort_order = case
    when id = first_id then second_order
    when id = second_id then first_order
    else sort_order
  end
  where id in (first_id, second_id);
end;
$$;

revoke all on function public.swap_sales_playbook_order(uuid, uuid)
  from public, anon;
grant execute on function public.swap_sales_playbook_order(uuid, uuid)
  to authenticated;

-- Remove snapshots created by older frontend builds. Playbook content must
-- exist only in the dedicated table protected by approved Super Admin RLS.
update public.app_state
set payload = payload - 'salesPlaybooks'
where payload ? 'salesPlaybooks';

notify pgrst, 'reload schema';

commit;
