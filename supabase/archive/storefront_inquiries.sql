-- Public storefront contact submissions: the "Talk to a Shophouse Specialist"
-- consult form and the "Shophouse Investment Guide" lead form.
-- The listing-api edge function writes rows (service role) AND mirrors each
-- submission into crm_leads owned by the super-admin account. Only the Super
-- Admin can read/manage this archive. Safe to re-run.

create table if not exists public.storefront_inquiries (
  id uuid primary key default gen_random_uuid(),
  inquiry_type text not null default 'consult'
    check (inquiry_type in ('consult', 'guide', 'project-bt')),
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null default '',
  email text not null default '',
  phone text not null default '',
  message text not null default '',
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'closed', 'spam')),
  consent_at timestamptz,
  source text not null default 'website',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migration: allow Project B.T submissions in the archive. Existing databases
-- created the inline check with the default auto-generated name, so drop and
-- re-add it to include 'project-bt'.
alter table if exists public.storefront_inquiries drop constraint if exists storefront_inquiries_inquiry_type_check;
alter table if exists public.storefront_inquiries
  add constraint storefront_inquiries_inquiry_type_check
  check (inquiry_type in ('consult', 'guide', 'project-bt'));

create index if not exists storefront_inquiries_type_date_idx
  on public.storefront_inquiries (inquiry_type, created_at desc);
create index if not exists storefront_inquiries_status_date_idx
  on public.storefront_inquiries (status, created_at desc);

drop trigger if exists storefront_inquiries_set_updated_at on public.storefront_inquiries;
create trigger storefront_inquiries_set_updated_at
  before update on public.storefront_inquiries
  for each row execute function public.set_updated_at();

alter table public.storefront_inquiries enable row level security;

drop policy if exists "storefront inquiries public insert" on public.storefront_inquiries;
create policy "storefront inquiries public insert"
  on public.storefront_inquiries for insert
  with check (consent_at is not null);

drop policy if exists "storefront inquiries publisher read" on public.storefront_inquiries;
create policy "storefront inquiries publisher read"
  on public.storefront_inquiries for select
  using (public.is_super_admin());

drop policy if exists "storefront inquiries publisher update" on public.storefront_inquiries;
create policy "storefront inquiries publisher update"
  on public.storefront_inquiries for update
  using (public.is_super_admin());

drop policy if exists "storefront inquiries publisher delete" on public.storefront_inquiries;
create policy "storefront inquiries publisher delete"
  on public.storefront_inquiries for delete
  using (public.is_super_admin());

grant select, insert, update, delete on public.storefront_inquiries to authenticated;
grant select, insert on public.storefront_inquiries to anon;

notify pgrst, 'reload schema';
