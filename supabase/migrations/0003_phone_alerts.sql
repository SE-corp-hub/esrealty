-- Phone alerts (web push) and lead alerts (2026-10-18). Safe to run twice.
--
-- Apply with GitHub > Actions > Apply database migration (test, then apply).
--
-- 1. push_subscriptions: one row per phone or browser that turned alerts on.
--    People see and remove only their own; push_subscribe() adds one (a phone
--    that changes hands moves to the new person).
-- 2. push_config: the public half of the alert key pair, made by a super-admin
--    in Settings. The private half is only a GitHub secret (VAPID_PRIVATE_KEY).
-- 3. notifications.pushed_at: when the sender (.github/workflows/push-alerts.yml)
--    passed a notification on to the person's phones.
-- 4. Lead alerts: a new lead notifies the agent it is assigned to (or the
--    super-admins when nobody is assigned yet), and reassigning a lead notifies
--    the new agent. An alert never stops a lead from saving.

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
drop policy if exists "push subscriptions own" on public.push_subscriptions;
create policy "push subscriptions own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_=-]{40,200}$' or coalesce(p_auth, '') !~ '^[A-Za-z0-9_=-]{8,100}$' then
    raise exception 'Not a push subscription' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(coalesce(p_ua, ''), 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, created_at = now();
end $$;
revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;

create table if not exists public.push_config (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
grant select on public.push_config to authenticated;
drop policy if exists "push config read" on public.push_config;
create policy "push config read" on public.push_config for select to authenticated using (true);

-- New keys: phones that turned alerts on with the old key can't be reached
-- any more, so their subscriptions are cleared and each person turns alerts on again.
create or replace function public.push_set_public_key(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  if coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{80,100}$' then raise exception 'Not a public key' using errcode = '22023'; end if;
  insert into public.push_config (id, public_key, updated_by) values (1, p_key, auth.uid())
  on conflict (id) do update set public_key = excluded.public_key, updated_at = now(), updated_by = excluded.updated_by;
  delete from public.push_subscriptions where true;
end $$;
revoke all on function public.push_set_public_key(text) from public, anon;
grant execute on function public.push_set_public_key(text) to authenticated;

alter table public.notifications add column if not exists pushed_at timestamptz;

create or replace function public.notify_on_lead()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  who text := coalesce(nullif(btrim(new.name), ''), 'a new lead');
  src text := coalesce('From ' || nullif(btrim(new.payload ->> 'source'), '') || '. ', '');
begin
  begin
    if tg_op = 'INSERT' then
      if new.assigned_to_id is not null then
        if new.assigned_to_id is distinct from new.created_by then
          perform public.notify_user(new.assigned_to_id, 'lead', 'New lead for you: ' || who, src || 'Open Leads to call them.', 'leads');
        end if;
      else
        for r in select id from public.profiles
                 where registration_status = 'approved' and role::text = 'super-admin' and id is distinct from new.created_by loop
          perform public.notify_user(r.id, 'lead', 'New lead: ' || who, src || 'Not assigned to anyone yet.', 'leads');
        end loop;
      end if;
    elsif new.assigned_to_id is not null and new.assigned_to_id is distinct from old.assigned_to_id
          and new.assigned_to_id is distinct from auth.uid() then
      perform public.notify_user(new.assigned_to_id, 'lead', 'Lead assigned to you: ' || who, src || 'Open Leads to call them.', 'leads');
    end if;
  exception when others then
    null;  -- an alert must never stop a lead from saving
  end;
  return new;
end $$;
revoke all on function public.notify_on_lead() from public, anon, authenticated;
drop trigger if exists crm_leads_notify on public.crm_leads;
create trigger crm_leads_notify after insert or update of assigned_to_id on public.crm_leads
  for each row execute function public.notify_on_lead();

-- Check: tables 2, lead_trigger 1, pushed_at_column 1, functions 3.
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename in ('push_subscriptions', 'push_config'))::int as tables,
  (select count(*) from pg_trigger where tgname = 'crm_leads_notify' and not tgisinternal)::int as lead_trigger,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'pushed_at')::int as pushed_at_column,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('push_subscribe', 'push_set_public_key', 'notify_on_lead'))::int as functions;
