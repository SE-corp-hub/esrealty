-- Shared CRM leads so every lead an agent enters is visible to that agent's
-- supervising broker (and to the Super Admin). Run this ENTIRE file in the
-- Supabase SQL Editor, then press Run. Safe to re-run any number of times.
--
-- Before this table existed, each user's CRM leads lived only inside their own
-- app_state row, so a broker could never see the leads entered by their agents.
-- This adds one shared crm_leads table. RLS lets:
--   * the creator (agent/broker) read, update, delete their own leads,
--   * the person the lead is assigned to read/update it,
--   * the creator's supervising broker read/update/delete their team's leads,
--   * a broker read/update/delete leads assigned to any of their team agents,
--   * the Super Admin see everything.

create table if not exists public.crm_leads (
  id text primary key,
  ref text not null default '',
  name text not null default '',
  assigned_to text not null default '',
  assigned_to_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_leads_payload_object check (jsonb_typeof(payload) = 'object')
);

alter table public.crm_leads
  add column if not exists assigned_to_id uuid references auth.users(id) on delete set null;

-- Safely migrate legacy rows only where the display name identifies one account.
update public.crm_leads l
set assigned_to_id = (
  select p.id from public.profiles p where p.full_name = l.assigned_to limit 1
)
where l.assigned_to_id is null
  and l.assigned_to <> ''
  and (select count(*) from public.profiles p where p.full_name = l.assigned_to) = 1;

create index if not exists crm_leads_created_by_idx on public.crm_leads (created_by);
create index if not exists crm_leads_assigned_to_idx on public.crm_leads (assigned_to);
create index if not exists crm_leads_assigned_to_id_idx on public.crm_leads (assigned_to_id);
create index if not exists crm_leads_updated_at_idx on public.crm_leads (updated_at desc);

alter table public.crm_leads enable row level security;

-- Ownership is provenance, not an editable assignment. Without this guard an
-- assigned user can rewrite created_by to themselves and gain delete rights.
create or replace function public.crm_leads_keep_creator()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Lead creator cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists crm_leads_keep_creator on public.crm_leads;
create trigger crm_leads_keep_creator
  before update on public.crm_leads
  for each row execute function public.crm_leads_keep_creator();

-- Drop policies BEFORE functions: the policies depend on the helper functions,
-- so dropping the functions first raises 2BP01 "cannot drop ... other objects
-- depend on it".
drop policy if exists "crm_leads select own or team" on public.crm_leads;
drop policy if exists "crm_leads insert own" on public.crm_leads;
drop policy if exists "crm_leads update own or team" on public.crm_leads;
drop policy if exists "crm_leads delete own or team" on public.crm_leads;

-- Drop any previous versions (including the old row-type signatures) so the
-- file can be re-run after an earlier failed attempt.
drop function if exists public.crm_lead_broker_of(public.crm_leads);
drop function if exists public.crm_lead_broker_of(uuid);
drop function if exists public.crm_lead_assigned_to_my_team(public.crm_leads);
drop function if exists public.crm_lead_assigned_to_my_team(text);
drop function if exists public.crm_lead_assigned_to_my_team(uuid);

-- The current user's full name, used to match "assigned to me".
create or replace function public.my_full_name()
returns text
language sql
stable
security definer set search_path = public
as $$
  select full_name from public.profiles where id = auth.uid();
$$;

-- True when the lead was created by one of my supervised agents.
create or replace function public.crm_lead_broker_of(p_created_by uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_created_by and p.broker = auth.uid()
  );
$$;

-- True when the lead is assigned to one of my supervised agents.
create or replace function public.crm_lead_assigned_to_my_team(p_assigned_to_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_assigned_to_id
      and p.role = 'agent'
      and p.registration_status = 'approved'
      and p.broker = auth.uid()
  );
$$;

create or replace function public.crm_current_user_is_approved()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and registration_status = 'approved'
  );
$$;

create policy "crm_leads select own or team"
  on public.crm_leads for select
  using (
    public.is_super_admin()
    or (public.crm_current_user_is_approved() and (
      created_by = auth.uid()
      or assigned_to_id = auth.uid()
      or public.crm_lead_broker_of(created_by)
      or public.crm_lead_assigned_to_my_team(assigned_to_id)
    ))
  );

create policy "crm_leads insert own"
  on public.crm_leads for insert
  with check (public.is_super_admin() or (
    public.crm_current_user_is_approved() and created_by = auth.uid()
  ));

create policy "crm_leads update own or team"
  on public.crm_leads for update
  using (
    public.is_super_admin()
    or (public.crm_current_user_is_approved() and (
      created_by = auth.uid()
      or assigned_to_id = auth.uid()
      or public.crm_lead_broker_of(created_by)
      or public.crm_lead_assigned_to_my_team(assigned_to_id)
    ))
  )
  with check (
    public.is_super_admin()
    or (public.crm_current_user_is_approved() and (
      created_by = auth.uid()
      or assigned_to_id = auth.uid()
      or public.crm_lead_broker_of(created_by)
      or public.crm_lead_assigned_to_my_team(assigned_to_id)
    ))
  );

create policy "crm_leads delete own or team"
  on public.crm_leads for delete
  using (
    public.is_super_admin()
    or (public.crm_current_user_is_approved() and (
      created_by = auth.uid()
      or public.crm_lead_broker_of(created_by)
      or public.crm_lead_assigned_to_my_team(assigned_to_id)
    ))
  );

revoke all on function public.my_full_name() from public;
grant execute on function public.my_full_name() to authenticated;
revoke all on function public.crm_lead_broker_of(uuid) from public;
grant execute on function public.crm_lead_broker_of(uuid) to authenticated;
revoke all on function public.crm_lead_assigned_to_my_team(uuid) from public;
grant execute on function public.crm_lead_assigned_to_my_team(uuid) to authenticated;
revoke all on function public.crm_current_user_is_approved() from public;
grant execute on function public.crm_current_user_is_approved() to authenticated;
revoke all on function public.crm_leads_keep_creator() from public;

-- Linked-agent roster used by the licensed broker's CRM view and lead editor.
create or replace function public.broker_team()
returns setof jsonb
language plpgsql
security definer set search_path = public, auth
as $$
declare
  me_role text;
begin
  select role::text into me_role from public.profiles where id = auth.uid();
  if me_role is distinct from 'broker' and me_role is distinct from 'super-admin' then
    raise exception 'Broker access required';
  end if;

  return query
    select jsonb_build_object(
      'id', p.id::text,
      'full_name', p.full_name::text,
      'email', u.email::text
    )
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role = 'agent'
      and p.registration_status = 'approved'
      and p.broker = auth.uid()
    order by p.full_name;
end;
$$;

revoke all on function public.broker_team() from public;
grant execute on function public.broker_team() to authenticated;

-- Supervising broker shown to an agent in CRM. The function only returns the
-- broker linked to the current authenticated agent.
create or replace function public.my_broker()
returns jsonb
language sql
stable
security definer set search_path = public, auth
as $$
  select jsonb_build_object(
    'id', b.id::text,
    'full_name', b.full_name::text,
    'email', u.email::text,
    'agency', coalesce(b.agency, '')::text,
    'prc', coalesce(b.prc, '')::text
  )
  from public.profiles me
  join public.profiles b on b.id = me.broker
  join auth.users u on u.id = b.id
  where me.id = auth.uid()
    and me.role = 'agent'
    and b.role = 'broker'
    and b.registration_status = 'approved';
$$;

revoke all on function public.my_broker() from public;
grant execute on function public.my_broker() to authenticated;

-- Reload PostgREST's schema cache so the app can call the table immediately.
notify pgrst, 'reload schema';

-- Verify the table and privileges (should print t for all four).
select
  tablename,
  has_table_privilege('authenticated', 'public.crm_leads', 'select') as can_select,
  has_table_privilege('authenticated', 'public.crm_leads', 'insert') as can_insert,
  has_table_privilege('authenticated', 'public.crm_leads', 'update') as can_update,
  has_table_privilege('authenticated', 'public.crm_leads', 'delete') as can_delete
from pg_tables where schemaname = 'public' and tablename = 'crm_leads';
