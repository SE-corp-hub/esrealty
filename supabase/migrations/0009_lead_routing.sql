-- Automatic lead routing (2026-10-21). Safe to run twice.
--
-- Apply with GitHub > Actions > Apply database migration (test, then apply), AFTER 0008.
-- Changes no data. Backend roadmap item F1. OFF until a Super Admin turns it on in
-- Users & Access > Lead routing.
--
-- A lead that arrives from the website, a Value Guide request or Facebook with nobody assigned
-- is given to the next broker in the chosen list, in turn (round robin). The setting lives in
-- site_settings under the key 'leadRouting' (not public):
--   { "enabled": true, "brokers": ["<broker id>", ...], "next": 0 }
-- Only approved brokers in the list take part; a broker who is removed, demoted or not approved
-- is skipped. Leads typed in by a person in the app are never re-routed (they chose), and a lead
-- that already has someone assigned (for example the listing's agent) is left alone.
-- The broker is told by the existing "New lead for you" alert, and the lead's activity says it
-- was routed automatically.

create or replace function public.crm_leads_route()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  cfg jsonb;
  ids uuid[];
  n integer;
  pick integer;
  chosen uuid;
  chosen_name text;
begin
  if new.assigned_to_id is not null or auth.uid() is not null then return new; end if;
  begin
    select value into cfg from public.site_settings where key = 'leadRouting' for update;
    if cfg is null or coalesce((cfg ->> 'enabled')::boolean, false) is not true then return new; end if;
    select coalesce(array_agg(p.id order by x.ord), '{}') into ids
      from jsonb_array_elements_text(coalesce(cfg -> 'brokers', '[]'::jsonb)) with ordinality as x(id, ord)
      join public.profiles p on p.id::text = x.id
     where p.role = 'broker' and p.registration_status = 'approved';
    n := cardinality(ids);
    if n = 0 then return new; end if;
    pick := mod(greatest(coalesce((cfg ->> 'next')::integer, 0), 0), n);
    chosen := ids[pick + 1];
    select coalesce(nullif(btrim(full_name), ''), 'Broker') into chosen_name from public.profiles where id = chosen;
    new.assigned_to_id := chosen;
    new.assigned_to := chosen_name;
    new.payload := coalesce(new.payload, '{}'::jsonb)
      || jsonb_build_object('assignedToId', chosen::text, 'assignedTo', chosen_name)
      || jsonb_build_object('activity', coalesce(new.payload -> 'activity', '[]'::jsonb)
           || jsonb_build_array(jsonb_build_object('date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                                   'text', 'Assigned to ' || chosen_name || ' automatically (lead routing, in turn)')));
    update public.site_settings set value = jsonb_set(cfg, '{next}', to_jsonb(pick + 1)) where key = 'leadRouting';
  exception when others then
    raise warning 'crm_leads_route: %', sqlerrm;  -- routing must never stop a lead from saving
  end;
  return new;
end;
$function$;
revoke all on function public.crm_leads_route() from public, anon, authenticated;
drop trigger if exists crm_leads_route on public.crm_leads;
create trigger crm_leads_route before insert on public.crm_leads
  for each row execute function public.crm_leads_route();

select (select count(*) from pg_trigger where tgname = 'crm_leads_route' and not tgisinternal)::int as routing_trigger;
