-- Shared broker transactions.
-- Licensed brokers can create, read, update, and delete only their own records.
-- Agents can read transactions owned by their linked supervising broker.
-- Super Admin can read and manage every transaction.
-- Safe to re-run.

create table if not exists public.broker_transactions (
  id text primary key,
  ref text not null default '',
  title text not null default '',
  payload jsonb not null default '{}'::jsonb,
  broker_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint broker_transactions_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists broker_transactions_broker_id_idx on public.broker_transactions (broker_id);
create index if not exists broker_transactions_created_by_idx on public.broker_transactions (created_by);
create index if not exists broker_transactions_updated_at_idx on public.broker_transactions (updated_at desc);

-- Preserve existing broker/Super Admin transactions from app_state. Existing
-- shared rows win on re-runs, so newer cloud data is never overwritten.
insert into public.broker_transactions (id, ref, title, payload, broker_id, created_by)
select
  'migrated-' || a.owner_id::text || '-' || (tx.item ->> 'id'),
  coalesce(tx.item ->> 'ref', ''),
  coalesce(tx.item ->> 'title', ''),
  tx.item || jsonb_build_object(
    'id', 'migrated-' || a.owner_id::text || '-' || (tx.item ->> 'id'),
    'brokerId', a.owner_id::text,
    'createdBy', a.owner_id::text,
    'documents', coalesce(
      (
        select jsonb_agg(doc.item)
        from jsonb_array_elements(
          case when jsonb_typeof(a.payload -> 'docVault') = 'array' then a.payload -> 'docVault' else '[]'::jsonb end
        ) as doc(item)
        where doc.item ->> 'ownerType' = 'tx'
          and doc.item ->> 'ownerId' = tx.item ->> 'id'
      ),
      tx.item -> 'documents',
      '[]'::jsonb
    )
  ),
  a.owner_id,
  a.owner_id
from public.app_state a
join public.profiles p on p.id = a.owner_id and p.role in ('broker', 'super-admin')
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(a.payload -> 'transactions') = 'array' then a.payload -> 'transactions' else '[]'::jsonb end
) as tx(item)
where coalesce(tx.item ->> 'id', '') <> ''
on conflict (id) do nothing;

alter table public.broker_transactions enable row level security;

drop policy if exists "broker_transactions select permitted" on public.broker_transactions;
drop policy if exists "broker_transactions insert broker own" on public.broker_transactions;
drop policy if exists "broker_transactions update broker own" on public.broker_transactions;
drop policy if exists "broker_transactions delete broker own" on public.broker_transactions;

drop function if exists public.transaction_for_my_broker(uuid);
drop function if exists public.transaction_current_user_is_broker();

create or replace function public.transaction_for_my_broker(p_broker_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.profiles me
    where me.id = auth.uid()
      and me.role = 'agent'
      and me.registration_status = 'approved'
      and me.broker = p_broker_id
  );
$$;

create or replace function public.transaction_current_user_is_broker()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.profiles me
    where me.id = auth.uid()
      and me.role = 'broker'
      and me.registration_status = 'approved'
  );
$$;

create policy "broker_transactions select permitted"
  on public.broker_transactions for select
  using (
    public.is_super_admin()
    or broker_id = auth.uid()
    or public.transaction_for_my_broker(broker_id)
  );

create policy "broker_transactions insert broker own"
  on public.broker_transactions for insert
  with check (
    public.is_super_admin()
    or (
      broker_id = auth.uid()
      and created_by = auth.uid()
      and public.transaction_current_user_is_broker()
    )
  );

create policy "broker_transactions update broker own"
  on public.broker_transactions for update
  using (
    public.is_super_admin()
    or (
      broker_id = auth.uid()
      and created_by = auth.uid()
      and public.transaction_current_user_is_broker()
    )
  )
  with check (
    public.is_super_admin()
    or (
      broker_id = auth.uid()
      and created_by = auth.uid()
      and public.transaction_current_user_is_broker()
    )
  );

create policy "broker_transactions delete broker own"
  on public.broker_transactions for delete
  using (
    public.is_super_admin()
    or (
      broker_id = auth.uid()
      and created_by = auth.uid()
      and public.transaction_current_user_is_broker()
    )
  );

revoke all on function public.transaction_for_my_broker(uuid) from public;
grant execute on function public.transaction_for_my_broker(uuid) to authenticated;
revoke all on function public.transaction_current_user_is_broker() from public;
grant execute on function public.transaction_current_user_is_broker() to authenticated;
grant select, insert, update, delete on public.broker_transactions to authenticated;

notify pgrst, 'reload schema';

select
  tablename,
  has_table_privilege('authenticated', 'public.broker_transactions', 'select') as can_select,
  has_table_privilege('authenticated', 'public.broker_transactions', 'insert') as can_insert,
  has_table_privilege('authenticated', 'public.broker_transactions', 'update') as can_update,
  has_table_privilege('authenticated', 'public.broker_transactions', 'delete') as can_delete
from pg_tables
where schemaname = 'public' and tablename = 'broker_transactions';
