-- First-response alerts for new leads (2026-10-21). Safe to run twice.
--
-- Apply with GitHub > Actions > Apply database migration (test, then apply), AFTER 0007.
-- Changes no data. Backend roadmap item F3.
--
-- lead_response_sweep(hours, dry_run): finds leads still marked "New" that nobody has worked
-- on for `hours` (default 24). Used by the hourly job .github/workflows/lead-response.yml,
-- which only counts until the repository variable LEAD_RESPONSE_ALERTS is "on".
--   - After `hours`: the assigned person gets "Not contacted yet: <name>" in the bell.
--     A lead with nobody assigned goes to the Super Admins instead.
--   - After twice `hours`: the assigned agent's broker (or the Super Admins, when the agent
--     has no broker or the lead is unassigned) gets "Waiting for a first call: <name>".
--   - Each message is sent once per lead (checked against the bell, 30 days back).
--   - Leads older than 14 days are left alone, so switching it on does not flood anyone
--     with old leads.
-- "Worked on" means the status moved past New. Writing a note without changing the status does
-- not count, which matches the "New" column people see.

create or replace function public.lead_response_sweep(p_hours integer default 24, p_dry_run boolean default true)
returns table(lead_id text, waited_hours integer, notified uuid, step text, alerted boolean)
language plpgsql security definer set search_path to 'public' as $function$
declare
  r record;
  who uuid;
  v_title text;
  v_name text;
  v_hours integer;
begin
  if p_hours is null or p_hours < 1 or p_hours > 720 then raise exception 'p_hours must be between 1 and 720'; end if;
  for r in
    select l.id, l.name, l.assigned_to_id, l.created_at,
           (select p.broker from public.profiles p where p.id = l.assigned_to_id and p.role = 'agent') as agent_broker
      from public.crm_leads l
     where coalesce(nullif(l.payload ->> 'status', ''), 'new') = 'new'
       and l.created_at < now() - make_interval(hours => p_hours)
       and l.created_at > now() - interval '14 days'
  loop
    v_hours := floor(extract(epoch from (now() - r.created_at)) / 3600)::integer;
    v_name := coalesce(nullif(btrim(r.name), ''), 'a new lead');

    -- Step 1: the assignee (or every Super Admin when nobody is assigned).
    v_title := left('Not contacted yet: ' || v_name, 200);
    for who in
      select r.assigned_to_id where r.assigned_to_id is not null
      union
      select p.id from public.profiles p where r.assigned_to_id is null and p.role = 'super-admin' and p.registration_status = 'approved'
    loop
      continue when exists (select 1 from public.notifications n where n.user_id = who and n.title = v_title and n.created_at > now() - interval '30 days');
      lead_id := r.id; waited_hours := v_hours; notified := who; step := 'assignee'; alerted := false;
      if not p_dry_run then
        perform public.notify_user(who, 'lead', v_title,
          'Waiting ' || v_hours || ' hours with no first contact. Call or message them, then move the lead to Contacted.', 'leads');
        alerted := true;
      end if;
      return next;
    end loop;

    -- Step 2: after twice the time, the agent's broker (or the Super Admins).
    continue when v_hours < 2 * p_hours;
    v_title := left('Waiting for a first call: ' || v_name, 200);
    for who in
      select r.agent_broker where r.agent_broker is not null
      union
      select p.id from public.profiles p where r.agent_broker is null and p.role = 'super-admin' and p.registration_status = 'approved'
    loop
      continue when who = r.assigned_to_id;
      continue when exists (select 1 from public.notifications n where n.user_id = who and n.title = v_title and n.created_at > now() - interval '30 days');
      lead_id := r.id; waited_hours := v_hours; notified := who; step := 'escalation'; alerted := false;
      if not p_dry_run then
        perform public.notify_user(who, 'lead', v_title,
          'No first contact after ' || v_hours || ' hours. Check with the assigned person or reassign the lead.', 'leads');
        alerted := true;
      end if;
      return next;
    end loop;
  end loop;
end;
$function$;
revoke all on function public.lead_response_sweep(integer, boolean) from public, anon, authenticated;
grant execute on function public.lead_response_sweep(integer, boolean) to service_role;

select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'lead_response_sweep')::int as sweep_function;
