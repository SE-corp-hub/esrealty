-- Shared Property Management workspace.
-- Run in Supabase SQL Editor, then refresh the app.

create table if not exists public.pms_workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pms_workspaces_payload_object check (jsonb_typeof(payload) = 'object')
);

create or replace function public.pms_workspace_can_read(workspace_payload jsonb)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select public.is_super_admin() or exists (
    select 1
    from public.profiles me
    where me.id = auth.uid()
      and me.registration_status = 'approved'
      and me.role in ('owner', 'tenant')
      and exists (
        select 1
        from jsonb_array_elements(case
          when me.role = 'owner' and jsonb_typeof(workspace_payload -> 'owners') = 'array' then workspace_payload -> 'owners'
          when me.role = 'tenant' and jsonb_typeof(workspace_payload -> 'tenants') = 'array' then workspace_payload -> 'tenants'
          else '[]'::jsonb end) linked(record)
        where coalesce(linked.record ->> 'archived', 'false') <> 'true'
          and (
            linked.record ->> 'authUserId' = auth.uid()::text
            or lower(coalesce(linked.record ->> 'email', '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
          )
      )
  );
$$;

insert into public.pms_workspaces (owner_id, payload)
select a.owner_id, a.payload -> 'pms'
from public.app_state a
join public.profiles p on p.id = a.owner_id
where p.role = 'super-admin'
  and jsonb_typeof(a.payload -> 'pms') = 'object'
on conflict (owner_id) do nothing;

alter table public.pms_workspaces enable row level security;
drop policy if exists "pms workspace linked read" on public.pms_workspaces;
drop policy if exists "pms workspace admin insert" on public.pms_workspaces;
drop policy if exists "pms workspace admin update" on public.pms_workspaces;
drop policy if exists "pms workspace admin delete" on public.pms_workspaces;

create policy "pms workspace linked read" on public.pms_workspaces for select
  using (public.pms_workspace_can_read(payload));
create policy "pms workspace admin insert" on public.pms_workspaces for insert
  with check (owner_id = auth.uid() and public.is_super_admin());
create policy "pms workspace admin update" on public.pms_workspaces for update
  using (owner_id = auth.uid() and public.is_super_admin())
  with check (owner_id = auth.uid() and public.is_super_admin());
create policy "pms workspace admin delete" on public.pms_workspaces for delete
  using (owner_id = auth.uid() and public.is_super_admin());

revoke all on function public.pms_workspace_can_read(jsonb) from public;
grant execute on function public.pms_workspace_can_read(jsonb) to authenticated;
grant select, insert, update, delete on public.pms_workspaces to authenticated;

drop trigger if exists pms_workspaces_set_updated_at on public.pms_workspaces;
create trigger pms_workspaces_set_updated_at before update on public.pms_workspaces
  for each row execute procedure public.set_updated_at();

notify pgrst, 'reload schema';
