-- CRM Autopilot — agent task queue + evidence ledger (Comp AI-style).
-- Run this ENTIRE file in the Supabase SQL Editor, then press Run. Safe to
-- re-run any number of times.
--
-- Two matching tables:
--   * agent_tasks — follow-up work the agent schedules for itself. Tasks are
--     claimed with FOR UPDATE SKIP LOCKED semantics (a lease with an expiry):
--     a tick that dies frees its row when the lease expires, and two
--     dispatchers take disjoint work.
--   * agent_steps — the evidence ledger. Nothing is guessed here: every step is
--     either an observation (something the system actually saw) or a suggestion
--     (best available; a rep settles it). confident=true only on observations.
--
-- RLS mirrors crm_leads: creator, the assigned agent, the creator's supervising
-- broker and the Super Admin see their own team's rows. Service-role callers
-- (the agent-dispatch edge function) bypass RLS entirely.

create table if not exists public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null default '',
  kind text not null default 'follow-up',
  reason text not null default '',
  payload jsonb not null default '{}'::jsonb,
  task_meta jsonb not null default '{}'::jsonb,
  due_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_id uuid,
  state text not null default 'due' check (state in ('due', 'working', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.agent_steps (
  id bigint generated always as identity primary key,
  lead_id text not null default '',
  task_id uuid,
  kind text not null check (kind in ('observation', 'suggestion')),
  summary text not null default '',
  detail jsonb not null default '{}'::jsonb,
  confident boolean not null default false,
  state text not null default 'open' check (state in ('open', 'approved', 'rejected')),
  done_by text not null default 'agent',
  created_at timestamptz not null default now()
);

alter table public.agent_tasks
  add column if not exists task_meta jsonb not null default '{}'::jsonb;

create index if not exists agent_tasks_due_idx on public.agent_tasks (state, due_at);
create index if not exists agent_tasks_lead_idx on public.agent_tasks (lead_id, created_at desc);
create index if not exists agent_steps_lead_idx on public.agent_steps (lead_id, created_at desc);
create index if not exists agent_steps_task_idx on public.agent_steps (task_id);

-- Claim up to p_max due tasks. The lease means we "own" the row until it
-- expires; the caller must complete or cancel it before then.
create or replace function public.agent_claim_due(p_max int default 10)
returns setof public.agent_tasks
language plpgsql
security definer set search_path = public
as $$
begin
  return query
    update public.agent_tasks t
    set state = 'working',
        lease_id = gen_random_uuid(),
        lease_until = now() + interval '5 minutes'
    where t.id in (
      select id from public.agent_tasks
      where state = 'due'
        and due_at <= now()
        and (lease_until is null or lease_until < now())
      order by due_at
      limit greatest(1, p_max)
      for update skip locked
    )
    returning t.*;
end;
$$;

-- Finish a claimed task: write its steps to the evidence ledger, mark it done,
-- and when p_next_due is set, schedule the follow-on task with its reason.
create or replace function public.agent_complete(
  p_task uuid,
  p_steps jsonb,
  p_next_due timestamptz,
  p_next_reason text default ''
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  t public.agent_tasks;
  step jsonb;
begin
  select * into t from public.agent_tasks where id = p_task for update;
  if t is null or t.state <> 'working' then
    raise exception 'Task % is not claimed/working', coalesce(p_task::text, 'null');
  end if;

  for step in select * from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) loop
    insert into public.agent_steps (lead_id, task_id, kind, summary, detail, confident, done_by)
    values (
      coalesce(step ->> 'lead_id', t.lead_id),
      p_task,
      coalesce(step ->> 'kind', 'observation'),
      coalesce(step ->> 'summary', ''),
      coalesce(step -> 'detail', '{}'::jsonb),
      coalesce((step ->> 'confident')::boolean, false),
      coalesce(step ->> 'done_by', 'agent')
    );
  end loop;

  update public.agent_tasks
  set state = 'done', completed_at = now(), lease_until = null, lease_id = null
  where id = p_task;

  if p_next_due is not null and t.lead_id <> '' then
    insert into public.agent_tasks (lead_id, kind, reason, payload, task_meta, due_at, state)
    values (
      t.lead_id,
      'follow-up',
      coalesce(nullif(p_next_reason, ''), 'Scheduled follow-up'),
      jsonb_build_object('from_task', p_task, 'lead_id', t.lead_id),
      t.task_meta,
      p_next_due,
      'due'
    );
  end if;
end;
$$;

-- Cancel a task (rep closed the lead, etc.).
create or replace function public.agent_cancel(p_task uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.agent_tasks
  set state = 'cancelled', lease_until = null, lease_id = null, completed_at = now()
  where id = p_task;
end;
$$;

-- A lead the procedure would re-activate on a later recheck but that must never
-- be nagged past this point (closed/lost): one RPC that cancels its open work.
create or replace function public.agent_snooze_lead(p_lead_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.agent_tasks
  set state = 'cancelled', lease_until = null, lease_id = null, completed_at = now()
  where lead_id = p_lead_id and state in ('due', 'working');
end;
$$;

-- Resolve a suggestion step (Approve / Reject) from the UX. Invoker rights on
-- purpose: the caller's UPDATE must pass the agent_steps RLS policy below, so
-- a rep can only resolve steps on leads they are allowed to see.
create or replace function public.agent_set_step(p_step bigint, p_state text, p_by text default 'agent')
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_state not in ('approved', 'rejected') then
    raise exception 'Step state must be approved or rejected';
  end if;
  update public.agent_steps
  set state = p_state, done_by = coalesce(nullif(p_by, ''), 'agent')
  where id = p_step;
end;
$$;

alter table public.agent_tasks enable row level security;
alter table public.agent_steps enable row level security;

-- Owner / team visibility reuses the crm_leads helpers (my_full_name,
-- crm_lead_broker_of, crm_lead_assigned_to_my_team, crm_current_user_is_approved,
-- is_super_admin) so a broker sees exactly the team they already supervise.

create policy "agent_tasks select own or team"
  on public.agent_tasks for select
  using (
    public.is_super_admin()
    or (
      public.crm_current_user_is_approved()
      and (
        exists (select 1 from public.crm_leads cl where cl.id = agent_tasks.lead_id and (
          cl.created_by = auth.uid()
          or cl.assigned_to_id = auth.uid()
          or public.crm_lead_broker_of(cl.created_by)
          or public.crm_lead_assigned_to_my_team(cl.assigned_to_id)
        ))
      )
    )
  );

create policy "agent_steps select own or team"
  on public.agent_steps for select
  using (
    public.is_super_admin()
    or (
      public.crm_current_user_is_approved()
      and (
        exists (select 1 from public.crm_leads cl where cl.id = agent_steps.lead_id and (
          cl.created_by = auth.uid()
          or cl.assigned_to_id = auth.uid()
          or public.crm_lead_broker_of(cl.created_by)
          or public.crm_lead_assigned_to_my_team(cl.assigned_to_id)
        ))
      )
    )
  );

-- Front-end writes to steps only through agent_set_step; the UPDATE policy
-- below is what lets reps resolve suggestions on leads they own or supervise.

create policy "agent_steps update own or team"
  on public.agent_steps for update
  using (
    public.is_super_admin()
    or (
      public.crm_current_user_is_approved()
      and (
        exists (select 1 from public.crm_leads cl where cl.id = agent_steps.lead_id and (
          cl.created_by = auth.uid()
          or cl.assigned_to_id = auth.uid()
          or public.crm_lead_broker_of(cl.created_by)
          or public.crm_lead_assigned_to_my_team(cl.assigned_to_id)
        ))
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      public.crm_current_user_is_approved()
      and (
        exists (select 1 from public.crm_leads cl where cl.id = agent_steps.lead_id and (
          cl.created_by = auth.uid()
          or cl.assigned_to_id = auth.uid()
          or public.crm_lead_broker_of(cl.created_by)
          or public.crm_lead_assigned_to_my_team(cl.assigned_to_id)
        ))
      )
    )
  );

-- The four worker RPCs are service-role only: they claim, complete, cancel and
-- snooze across ALL leads, which must never be reachable from the browser.
revoke all on function public.agent_claim_due(integer) from public;
revoke all on function public.agent_complete(uuid, jsonb, timestamptz, text) from public;
revoke all on function public.agent_cancel(uuid) from public;
revoke all on function public.agent_snooze_lead(text) from public;
grant execute on function public.agent_claim_due(integer) to service_role;
grant execute on function public.agent_complete(uuid, jsonb, timestamptz, text) to service_role;
grant execute on function public.agent_cancel(uuid) to service_role;
grant execute on function public.agent_snooze_lead(text) to service_role;

-- The rep-side step resolver is usable by any approved user (RLS gates it).
revoke all on function public.agent_set_step(bigint, text, text) from public;
grant execute on function public.agent_set_step(bigint, text, text) to authenticated;

-- PostgREST schema cache reload so the app can call the RPCs immediately.
notify pgrst, 'reload schema';