-- Co-Broking module: commission-split agreements between licensed brokers.
-- Run AFTER schema.sql, shared_listings.sql, notifications.sql. Idempotent.

begin;

create table if not exists public.cobroke_agreements (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.shared_listings(id) on delete cascade,
  listing_broker_id uuid not null references auth.users(id) on delete cascade,
  selling_broker_id uuid references auth.users(id) on delete set null,
  partner_email text not null default '',
  split_listing_pct numeric(5, 2) not null default 50,
  split_selling_pct numeric(5, 2) not null default 50,
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'declined', 'completed', 'cancelled')),
  notes text not null default '',
  responded_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cobroke_pct_range
    check (split_listing_pct between 0 and 100 and split_selling_pct between 0 and 100),
  constraint cobroke_pct_sum
    check (split_listing_pct + split_selling_pct = 100),
  constraint cobroke_partner_email_valid
    check (btrim(partner_email) <> '' and char_length(partner_email) <= 200)
);

create index if not exists cobroke_listing_idx on public.cobroke_agreements (listing_id);
create index if not exists cobroke_listing_broker_idx on public.cobroke_agreements (listing_broker_id);
create index if not exists cobroke_selling_broker_idx on public.cobroke_agreements (selling_broker_id);

alter table public.cobroke_agreements enable row level security;

drop policy if exists "cobroke read parties" on public.cobroke_agreements;
create policy "cobroke read parties" on public.cobroke_agreements
  for select using (
    public.is_super_admin()
    or listing_broker_id = auth.uid()
    or selling_broker_id = auth.uid()
    or lower(partner_email) = lower(auth.email())
  );

drop policy if exists "cobroke insert owner" on public.cobroke_agreements;
create policy "cobroke insert owner" on public.cobroke_agreements
  for insert with check (
    listing_broker_id = auth.uid()
    and public.listing_current_user_can_publish()
  );

drop policy if exists "cobroke update parties" on public.cobroke_agreements;
create policy "cobroke update parties" on public.cobroke_agreements
  for update using (
    public.is_super_admin()
    or listing_broker_id = auth.uid()
    or selling_broker_id = auth.uid()
  )
  with check (
    public.is_super_admin()
    or listing_broker_id = auth.uid()
    or selling_broker_id = auth.uid()
  );

drop trigger if exists cobroke_set_updated_at on public.cobroke_agreements;
create trigger cobroke_set_updated_at
  before update on public.cobroke_agreements
  for each row execute function public.set_updated_at();

-- Resolve partner account from email, then notify them.
create or replace function public.notify_on_cobroke_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target uuid;
        ltitle text;
begin
  select p.id into target
  from public.profiles p
  where lower(p.email) = lower(new.partner_email)
    and p.registration_status = 'approved'
  limit 1;

  if target is not null then
    update public.cobroke_agreements
      set selling_broker_id = target
      where id = new.id and selling_broker_id is null;
  end if;

  select s.title into ltitle from public.shared_listings s where s.id = new.listing_id;

  perform public.notify_user(
    coalesce(target, new.listing_broker_id),
    'info',
    'New co-broke invitation' || coalesce(' - ' || ltitle, ''),
    'Proposed split ' || new.split_selling_pct::text || '% for the selling broker.',
    'admin'
  );
  return new;
end;
$$;

drop trigger if exists cobroke_notify_invite on public.cobroke_agreements;
create trigger cobroke_notify_invite
  after insert on public.cobroke_agreements
  for each row execute function public.notify_on_cobroke_invite();

-- Notify the counterparty whenever status changes.
create or replace function public.notify_on_cobroke_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target uuid;
begin
  if new.status = old.status then return new; end if;
  target := case when new.selling_broker_id = auth.uid()
                 then new.listing_broker_id
                 else new.selling_broker_id end;
  if target is null then return new; end if;
  perform public.notify_user(
    target, 'info',
    'Co-broke ' || new.status,
    'Agreement status changed to "' || new.status || '".',
    'admin'
  );
  return new;
end;
$$;

drop trigger if exists cobroke_notify_status on public.cobroke_agreements;
create trigger cobroke_notify_status
  after update of status on public.cobroke_agreements
  for each row execute function public.notify_on_cobroke_status();

-- Broker directory for proposing agreements (approved publishers only).
create or replace function public.list_cobroke_partners()
returns table (
  user_id uuid,
  full_name text,
  agency text,
  role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.listing_current_user_can_publish() then
    raise exception 'Approved publishers only';
  end if;
  return query
    select p.id, p.full_name, coalesce(p.agency, ''), p.role::text
    from public.profiles p
    where p.role in ('broker', 'agent')
      and p.registration_status = 'approved'
      and p.id <> auth.uid()
    order by p.full_name;
end;
$$;

revoke all on function public.list_cobroke_partners() from public, anon;
grant execute on function public.list_cobroke_partners() to authenticated;

-- Realtime for live status updates
do $$
begin
  alter publication supabase_realtime add table public.cobroke_agreements;
exception
  when duplicate_object then null;
  when others then
    if sqlerrm like '%already%' then null; else raise; end if;
end $$;

commit;
