-- Adds ONLY the broker_team function used by the CRM/Leads view.
-- A logged-in broker can list the agents connected to them (agents whose
-- profiles.broker points to their own profile id) so the app shows only the
-- leads assigned to that broker's team.
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query), then press Run.

create or replace function public.broker_team()
returns setof jsonb
language plpgsql security definer set search_path = public, auth
as $$
declare
  me_role text;
begin
  select role::text into me_role from public.profiles where id = auth.uid();
  if me_role is distinct from 'broker' and me_role is distinct from 'super-admin' then
    raise exception 'Broker access required';
  end if;
  return query select jsonb_build_object(
      'id', p.id::text,
      'full_name', p.full_name::text,
      'email', u.email::text)
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role = 'agent' and p.registration_status = 'approved' and p.broker = auth.uid()
    order by p.full_name;
end;
$$;
revoke all on function public.broker_team() from public;
grant execute on function public.broker_team() to authenticated;

-- A logged-in agent can see only their linked supervising broker.
create or replace function public.my_broker()
returns jsonb
language sql stable security definer set search_path = public, auth
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

-- Reload PostgREST's schema cache so the app can call it immediately.
notify pgrst, 'reload schema';

-- Verify it is callable by authenticated users (should print t).
select
  p.proname,
  has_function_privilege('authenticated', 'public.broker_team()', 'execute') as can_call
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'broker_team';
