-- ============================================================
-- Fix: "Supervising broker (agents)" in Users & Access
--
-- Why the dropdown is empty / missing:
--   * The field only renders for accounts whose role = 'agent'
--     (js/app.js:7594).
--   * Its options are profiles with role = 'broker' AND
--     registration_status = 'approved' (js/app.js:7595, 7617).
--   * Emails live in auth.users, NOT public.profiles (so earlier
--     "email does not exist" diagnostic failed).
--
-- Run this ENTIRE file once in the Supabase SQL Editor and paste
-- the results back.
-- ============================================================

-- 1) See every account: who is agent, who is broker, who is approved.
select p.id, u.email, p.full_name, p.role, p.registration_status,
       p.broker,
       (select b.full_name from public.profiles b where b.id = p.broker) as assigned_broker_name
from public.profiles p
left join auth.users u on u.id = p.id
order by p.role, p.registration_status, u.email;

-- 2) How many brokers can be picked from the dropdown?
select count(*) as approved_brokers_available
from public.profiles
where role = 'broker' and registration_status = 'approved';

-- 3) Auto-repair the sample2 account(s): make them approved agents and
--    assign the first approved broker if one exists.
do $$
declare
  v_broker uuid;
  v_target uuid;
  v_any_approved_broker boolean := false;
begin
  select id into v_broker
    from public.profiles
   where role = 'broker' and registration_status = 'approved'
   order by created_at asc
   limit 1;
  v_any_approved_broker := v_broker is not null;

  if not v_any_approved_broker then
    raise notice 'NOTE: No approved broker exists yet, so the Supervising broker dropdown will stay empty. Create one via Users & Access > Add Account (role Broker, with PRC), then Approve it.';
  end if;

  for v_target in
    select p.id
      from public.profiles p
      join auth.users u on u.id = p.id
     where u.email ilike 'sample2%'
  loop
    if v_any_approved_broker then
      update public.profiles
         set role = 'agent', registration_status = 'approved', broker = v_broker
       where id = v_target;
      raise notice 'FIXED sample2 account % -> role=agent, approved, supervising broker set', v_target;
    else
      update public.profiles
         set role = 'agent', registration_status = 'approved'
       where id = v_target;
      raise notice 'sample2 account % -> role=agent, approved (waiting for a broker to assign)', v_target;
    end if;
  end loop;

  if not exists (select 1 from public.profiles p join auth.users u on u.id = p.id where u.email ilike 'sample2%') then
    raise notice 'No sample2 account found (deleted by cleanup?). Check listing #1 output.';
  end if;
end $$;

notify pgrst, 'reload schema';
