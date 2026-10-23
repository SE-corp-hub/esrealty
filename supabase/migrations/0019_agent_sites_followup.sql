-- Agent websites, follow-up to the tidy-up (2026-10-23). Safe to run twice. Apply with GitHub >
-- Actions > Apply database migration (test, then apply), AFTER 0018. Nothing changes for visitors,
-- agents or the office; these close two side doors and remove a duplicated rule.
--
--   agent_reviews_admin()    the Super Admin's Reviews tab reads reviews through this function; the
--                            reviews table is no longer readable from the app at all (the agent's
--                            own and the public page already read through functions).
--   licence checks           written only through licence_check_save (0018); the app can no longer
--                            insert, change or delete licence check rows directly.
--   routing_people(...)      lead routing's town rule and the brokers' rotation share one
--                            "next in turn" instead of two copies of it.

-- 1. Reviews for the Super Admin ---------------------------------------------------------------------
create or replace function public.agent_reviews_admin() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.is_super_admin() then raise exception 'Super Admin access required' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'agent_id', r.agent_id, 'deal_id', r.deal_id, 'status', r.status,
            'client_label', r.client_label, 'town', r.town, 'month', r.month, 'body', r.body, 'reply', r.reply,
            'submitted_at', r.submitted_at, 'expires_at', r.expires_at, 'created_at', r.created_at) order by r.created_at desc)
     from (select * from public.agent_reviews order by created_at desc limit 200) r), '[]'::jsonb);
end $function$;
-- Every read now goes through a function (Super Admin, the agent's own, the public page).
revoke select on public.agent_reviews from authenticated;
drop policy if exists "reviews read own or admin" on public.agent_reviews;

-- 2. Licence checks: one way in ---------------------------------------------------------------------
-- licence_check_save (0018) is the only writer from the app; the stamping trigger stays and still
-- records who checked and when. Reading your own check, or every check as a Super Admin, is unchanged.
revoke insert, update, delete on public.agent_verifications from authenticated;
drop policy if exists "licence checks admin write" on public.agent_verifications;


-- 3. Lead routing: one "next in turn" for the town rule and the brokers' rotation --------------------
-- Approved people from a routing list, in the list's order; brokers only when asked.
create or replace function public.routing_people(p_list jsonb, p_brokers_only boolean) returns uuid[]
language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(p.id order by x.ord), '{}')
    from jsonb_array_elements_text(case when jsonb_typeof(p_list) = 'array' then p_list else '[]'::jsonb end) with ordinality as x(id, ord)
    join public.profiles p on p.id::text = x.id
   where p.registration_status = 'approved'
     and (p.role::text = 'broker' or (not p_brokers_only and p.role::text = 'agent')) $$;

create or replace function public.crm_leads_route()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  cfg jsonb;
  town text;
  ids uuid[] := '{}';
  turn text[];
  why text;
  pick integer;
  chosen uuid;
  chosen_name text;
begin
  if new.assigned_to_id is not null or auth.uid() is not null then return new; end if;
  begin
    select value into cfg from public.site_settings where key = 'leadRouting' for update;
    if cfg is null or coalesce((cfg ->> 'enabled')::boolean, false) is not true then return new; end if;
    -- Town rule first, for Value Guide requests (they carry the town the visitor chose). A broker
    -- consultation or an appraisal request goes to the town's brokers, never to a salesperson.
    town := case when new.payload ? 'fullReport'
                 then public.agent_town_slug(coalesce(new.payload -> 'fullReport' -> 'inputs' ->> 'municipality', new.payload -> 'fullReport' -> 'location' ->> 'town'))
                 else '' end;
    if town <> '' then
      ids := public.routing_people(cfg -> 'towns' -> town, coalesce(new.payload ->> 'channel', '') in ('broker-consultation', 'professional-appraisal-request'));
      turn := array['townNext', town]; why := 'town rule';
      if cardinality(ids) > 0 and jsonb_typeof(cfg -> 'townNext') is distinct from 'object' then cfg := cfg || '{"townNext": {}}'; end if;
    end if;
    -- Otherwise the brokers take turns.
    if cardinality(ids) = 0 then
      ids := public.routing_people(cfg -> 'brokers', true);
      turn := array['next']; why := 'in turn';
    end if;
    if cardinality(ids) = 0 then return new; end if;
    pick := mod(greatest(coalesce((cfg #>> turn)::integer, 0), 0), cardinality(ids));
    chosen := ids[pick + 1];
    cfg := jsonb_set(cfg, turn, to_jsonb(pick + 1));
    select coalesce(nullif(btrim(full_name), ''), 'Agent') into chosen_name from public.profiles where id = chosen;
    new.assigned_to_id := chosen;
    new.assigned_to := chosen_name;
    new.payload := coalesce(new.payload, '{}'::jsonb)
      || jsonb_build_object('assignedToId', chosen::text, 'assignedTo', chosen_name)
      || jsonb_build_object('activity', coalesce(new.payload -> 'activity', '[]'::jsonb)
           || jsonb_build_array(jsonb_build_object('date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                                   'text', 'Assigned to ' || chosen_name || ' automatically (lead routing, ' || why || ')')));
    update public.site_settings set value = cfg where key = 'leadRouting';
  exception when others then
    raise warning 'crm_leads_route: %', sqlerrm;  -- routing must never stop a lead from saving
  end;
  return new;
end;
$function$;


-- 4. Rights -----------------------------------------------------------------------------------------
revoke all on function public.agent_reviews_admin() from public, anon;
grant execute on function public.agent_reviews_admin() to authenticated;
revoke all on function public.routing_people(jsonb, boolean) from public, anon, authenticated;
