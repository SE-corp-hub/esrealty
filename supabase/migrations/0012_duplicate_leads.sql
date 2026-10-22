-- Duplicate leads from outside, and team targets staff can read (2026-10-22). Safe to run twice.
--
-- Apply with GitHub > Actions > Apply database migration (test, then apply), AFTER 0011.
-- Changes no existing data. Backend roadmap items F2 and F14.
--
-- 1. Duplicate leads (F2)
--
-- When a lead arrives from outside (the website, a Value Guide request or Facebook: there is no
-- signed-in person) with the same phone number or email as a lead already saved:
--   - the new lead is marked as a possible duplicate of the most recent such lead
--     (payload possibleDuplicateOf / possibleDuplicateRef) and its activity says so, so the CRM can
--     offer to merge the two;
--   - if nobody is assigned yet and the earlier lead's person is approved staff, the new lead goes
--     to that same person (a returning customer keeps their agent). Lead routing (0009) then
--     leaves it alone, because it only routes leads with nobody assigned.
-- Leads typed in the app are not touched: the app already warns about duplicates when saving.
-- Phone numbers are compared as digits without +63 or leading zeros; emails in lower case.
-- Nothing is merged or deleted automatically. A failure here never stops a lead from saving.

create or replace function public.crm_norm_phone(p text) returns text
language sql immutable parallel safe as $function$
  select nullif(regexp_replace(
           regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^63(\d{10,})$', '\1'),
           '^0+(\d{4,})$', '\1'), '')
$function$;

create or replace function public.crm_norm_email(p text) returns text
language sql immutable parallel safe as $function$
  select nullif(lower(btrim(coalesce(p, ''))), '')
$function$;

create index if not exists crm_leads_norm_phone_idx on public.crm_leads (public.crm_norm_phone(payload ->> 'phone'))
  where public.crm_norm_phone(payload ->> 'phone') is not null;
create index if not exists crm_leads_norm_email_idx on public.crm_leads (public.crm_norm_email(payload ->> 'email'))
  where public.crm_norm_email(payload ->> 'email') is not null;

create or replace function public.crm_leads_dedupe()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_phone text;
  v_email text;
  prev record;
  v_staff boolean;
  v_note text;
begin
  if auth.uid() is not null then return new; end if;
  begin
    v_phone := public.crm_norm_phone(new.payload ->> 'phone');
    v_email := public.crm_norm_email(new.payload ->> 'email');
    if v_phone is null and v_email is null then return new; end if;
    select l.id, l.ref, l.assigned_to_id, l.assigned_to into prev
      from public.crm_leads l
     where l.id <> new.id
       and ((v_phone is not null and public.crm_norm_phone(l.payload ->> 'phone') = v_phone)
         or (v_email is not null and public.crm_norm_email(l.payload ->> 'email') = v_email))
     order by l.created_at desc
     limit 1;
    if prev.id is null then return new; end if;
    v_note := 'Same phone or email as lead ' || coalesce(nullif(prev.ref, ''), prev.id) || ': possibly the same person.';
    new.payload := coalesce(new.payload, '{}'::jsonb)
      || jsonb_build_object('possibleDuplicateOf', prev.id, 'possibleDuplicateRef', coalesce(prev.ref, ''));
    if new.assigned_to_id is null and prev.assigned_to_id is not null then
      select exists (select 1 from public.profiles p where p.id = prev.assigned_to_id and p.registration_status = 'approved'
                       and p.role in ('super-admin', 'broker', 'agent')) into v_staff;
      if v_staff then
        new.assigned_to_id := prev.assigned_to_id;
        new.assigned_to := coalesce(prev.assigned_to, '');
        new.payload := new.payload || jsonb_build_object('assignedToId', prev.assigned_to_id::text, 'assignedTo', coalesce(prev.assigned_to, ''));
        v_note := v_note || ' Assigned to ' || coalesce(nullif(prev.assigned_to, ''), 'the same person') || ', who has the earlier lead.';
      end if;
    end if;
    new.payload := new.payload || jsonb_build_object('activity', coalesce(new.payload -> 'activity', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'text', v_note)));
  exception when others then
    raise warning 'crm_leads_dedupe: %', sqlerrm;  -- must never stop a lead from saving
  end;
  return new;
end;
$function$;
revoke all on function public.crm_leads_dedupe() from public, anon, authenticated;
-- The name sorts before crm_leads_route, so this runs first (BEFORE triggers run in name order).
drop trigger if exists crm_leads_dedupe on public.crm_leads;
create trigger crm_leads_dedupe before insert on public.crm_leads
  for each row execute function public.crm_leads_dedupe();

-- 2. Team targets (F14). A Super Admin sets monthly targets per person in the CRM; they are kept in
-- site_settings under 'teamTargets' (not public). Approved staff (brokers and agents) may read that
-- one row, so each person sees their own target; only a Super Admin can change it.
drop policy if exists "site settings staff read targets" on public.site_settings;
create policy "site settings staff read targets" on public.site_settings as permissive for select to authenticated
  using (key = 'teamTargets' and exists (select 1 from public.profiles p where p.id = auth.uid()
           and p.registration_status = 'approved' and p.role in ('super-admin', 'broker', 'agent')));

select (select count(*) from pg_trigger where tgname = 'crm_leads_dedupe' and not tgisinternal)::int as dedupe_trigger,
       (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('crm_leads_norm_phone_idx', 'crm_leads_norm_email_idx'))::int as indexes,
       (select count(*) from pg_policies where tablename = 'site_settings' and policyname = 'site settings staff read targets')::int as targets_policy;
