-- Compliance registry (Phase 0 of the @ph-realtor build: RA 9646 / DHSUD
-- foundations). Run this ENTIRE file in the Supabase SQL Editor, then press
-- Run. Safe to re-run any number of times.
--
-- One shared compliance_records table holding the brokerage's licenses,
-- permits, bonds, and registrations. RLS mirrors crm_leads so the org's
-- broker decisions and compliance state are visible to Super Admin and the
-- creator's chain of command, and to no one else.
--
-- The CRM Autopilot watches expires_at through the LocalStorage app (see
-- complianceDue() in js/app.js, 60-day window) and posts a `compliance` task
-- through the dispatch worker so the league renewer surfaces "leak-proof"
-- renewals. The worker's ladder (nextRecheck) schedules the follow-up.

create table if not exists public.compliance_records (
  id text primary key,
  type text not null default 'broker_license',
  name text not null default '',
  number text not null default '',
  holder text not null default '',
  issued_at date,
  expires_at date,
  status text not null default 'active',
  notes text not null default '',
  owner uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.compliance_records
  add column if not exists owner uuid references auth.users(id) on delete cascade;

create index if not exists compliance_records_expires_idx on public.compliance_records (expires_at);
create index if not exists compliance_records_type_idx on public.compliance_records (type);

alter table public.compliance_records enable row level security;

create or replace function public.compliance_upsert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.updated_at = now();
  if new.owner is null then
    new.owner = auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists compliance_records_upsert_trg on public.compliance_records;
create trigger compliance_records_upsert_trg
  before insert or update on public.compliance_records
  for each row execute function public.compliance_upsert();

-- True when the current viewer may see another profile's compliance entries via
-- the brokerage address book: the viewer is the owner, or supervises the owner.
-- Mirrors crm_leads' chain-of-command visibility so compliance stays as private
-- as the leads themselves.
create or replace function public.address_book_profile_accessible(p_owner text, p_viewer uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
       select 1 from public.profiles o
       where o.id = nullif(p_owner, '')::uuid
         and (o.broker = p_viewer or o.id = p_viewer)
     );
$$;

-- RLS: the brokerage (creator chain) and Super Admin only. Team access is
-- derived the same way as crm_leads: creator, assigned broker, and admin.
create policy "compliance_read_own_chain"
  on public.compliance_records for select
  using (
    auth.uid() = owner
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role in ('super-admin', 'broker')
             or address_book_profile_accessible(coalesce(owner::text, ''), p.id))
    )
  );

create policy "compliance_write_own_chain"
  on public.compliance_records for all
  using (
    auth.uid() = owner
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role in ('super-admin', 'broker')
             or address_book_profile_accessible(coalesce(owner::text, ''), p.id))
    )
  )
  with check (true);

-- Convenience scheduler used by the client (js/app.js) when the dispatch
-- worker is not configured: enqueue one `compliance` task per expiring record.
-- Idempotent: skips records that already have an active (due/working) task, and
-- no-ops entirely if agent_tasks is not deployed yet.
create or replace function public.compliance_schedule_renewals(p_window_days int default 60)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  n int := 0;
  r record;
begin
  if to_regclass('public.agent_tasks') is null then
    return 0;
  end if;
  for r in
    select c.* from public.compliance_records c
    where c.status <> 'revoked'
      and c.expires_at is not null
      and c.expires_at between current_date and current_date + (p_window_days || ' days')::interval
      and not exists (
        select 1 from public.agent_tasks t
        where t.kind = 'compliance'
          and t.payload ->> 'record_id' = c.id
          and t.state in ('due', 'working')
      )
  loop
    insert into public.agent_tasks (lead_id, kind, reason, payload, task_meta, due_at, state)
    values (
      '',
      'compliance',
      format('Compliance record expiring: %s (%s) — %s', r.name, r.number, r.expires_at),
      jsonb_build_object('record_id', r.id, 'type', r.type, 'name', r.name, 'expires_at', r.expires_at),
      jsonb_build_object('compliance', true, 'record', r.name, 'expires_at', r.expires_at),
      case when r.expires_at <= current_date then now() else (r.expires_at || 'T00:00:00')::timestamptz end,
      'due'
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;