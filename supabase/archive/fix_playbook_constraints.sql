-- One-time fix: force Sales Playbook domain constraints to the Philippine market lists.
-- Safe to run multiple times. Works even if constraints were auto-named or partially migrated.
-- Run this in Supabase -> SQL Editor, then click "Load starter playbooks" in the app again.

begin;

-- Drop the known constraint names
alter table public.sales_playbooks drop constraint if exists sales_playbooks_category_valid;
alter table public.sales_playbooks drop constraint if exists sales_playbooks_stage_valid;
alter table public.sales_playbooks drop constraint if exists sales_playbooks_property_type_valid;

-- Also drop ANY leftover check constraints touching these columns (auto-named variants)
do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.sales_playbooks'::regclass
      and contype = 'c'
      and (
        conname ilike '%category%'
        or conname ilike '%stage%'
        or conname ilike '%property%'
      )
  loop
    execute format('alter table public.sales_playbooks drop constraint if exists %I', r.conname);
  end loop;
end $$;

-- Remove rows using retired values so the new constraints can be applied
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

commit;

-- Verify: should show the three constraints with check prefix
select conname from pg_constraint
  where conrelid = 'public.sales_playbooks'::regclass and contype = 'c'
  order by conname;
