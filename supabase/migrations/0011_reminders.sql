-- Viewing reminders and licence renewal reminders (2026-10-22). Safe to run twice.
--
-- Apply with GitHub > Actions > Apply database migration (test, then apply), AFTER 0010.
-- Changes no data. Backend roadmap items A4 / F9 (viewing reminders) and J4 (licence renewals).
-- Both are used by the job .github/workflows/reminders.yml (every 15 minutes), which only counts until the
-- repository variable REMINDER_ALERTS is "on".
--
-- viewing_reminder_sweep(dry_run)
--   A lead's calendar entries (viewings, calls, meetings) are kept inside the lead
--   (crm_leads.payload -> 'calendarEvents'), each with a date, a time and a reminder choice
--   ("1", "3" or "24" hours before; "0" = none). The app has always saved that choice, but nothing
--   sent it. This puts "Viewing at 3:00 PM: <lead>" in the bell of the person the lead is
--   assigned to (else whoever created it) once the reminder time has come and the entry has not
--   started yet. Only entries marked Scheduled count. Times are Philippine time. Each reminder is
--   sent once; moving the entry to another time sends it again for the new time.
--
-- compliance_expiry_sweep(dry_run)
--   Licences and permits in the compliance registry (compliance_records): 60, 30 and 7 days
--   before the expiry date, and on the day it expires, the account that saved the record gets a
--   bell note. When that account is an agent, their broker gets it too. Revoked records are
--   skipped. Records that expired more than 30 days ago are left alone, so switching it on does
--   not flood anyone.

create table if not exists public.viewing_reminders_sent (
  lead_id text not null,
  event_id text not null,
  remind_at timestamptz not null,
  sent_to uuid,
  sent_at timestamptz not null default now(),
  primary key (lead_id, event_id, remind_at)
);
alter table public.viewing_reminders_sent enable row level security;
-- No policies: only the sweep (security definer) and the service role read or write it.
revoke all on public.viewing_reminders_sent from anon, authenticated;
create index if not exists viewing_reminders_sent_at_idx on public.viewing_reminders_sent (sent_at);

create or replace function public.viewing_reminder_sweep(p_dry_run boolean default true)
returns table(lead_id text, event_id text, starts_at timestamptz, notified uuid, alerted boolean)
language plpgsql security definer set search_path to 'public' as $function$
declare
  r record;
  v_at timestamptz;
  v_remind timestamptz;
  v_hours integer;
  v_who uuid;
  v_label text;
begin
  for r in
    select l.id as lid, l.name, l.assigned_to_id, l.created_by, e.value as ev
      from public.crm_leads l
      cross join lateral jsonb_array_elements(case when jsonb_typeof(l.payload -> 'calendarEvents') = 'array' then l.payload -> 'calendarEvents' else '[]'::jsonb end) e
     where l.updated_at > now() - interval '120 days'
  loop
    continue when coalesce(r.ev ->> 'status', 'scheduled') <> 'scheduled';
    continue when coalesce(r.ev ->> 'reminder', '') not in ('1', '3', '24');
    continue when coalesce(r.ev ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$';
    continue when coalesce(r.ev ->> 'id', '') = '';
    begin
      v_at := ((r.ev ->> 'date') || ' ' || case when coalesce(r.ev ->> 'time', '') ~ '^\d{1,2}:\d{2}$' then r.ev ->> 'time' else '09:00' end)::timestamp at time zone 'Asia/Manila';
    exception when others then
      continue;
    end;
    v_hours := (r.ev ->> 'reminder')::integer;
    v_remind := v_at - make_interval(hours => v_hours);
    continue when now() < v_remind or now() >= v_at;
    continue when exists (select 1 from public.viewing_reminders_sent s where s.lead_id = r.lid and s.event_id = r.ev ->> 'id' and s.remind_at = v_remind);
    v_who := coalesce(r.assigned_to_id, r.created_by);
    continue when v_who is null;
    lead_id := r.lid; event_id := r.ev ->> 'id'; starts_at := v_at; notified := v_who; alerted := false;
    if not p_dry_run then
      v_label := case coalesce(r.ev ->> 'type', 'showing') when 'showing' then 'Viewing' when 'follow-up' then 'Follow-up' when 'meeting' then 'Meeting'
        when 'offer' then 'Offer deadline' when 'closing' then 'Closing' when 'documents' then 'Document deadline' else 'Appointment' end;
      perform public.notify_user(v_who, 'lead',
        v_label || ' at ' || to_char(v_at at time zone 'Asia/Manila', 'FMHH12:MI AM') ||
          case when (v_at at time zone 'Asia/Manila')::date <> (now() at time zone 'Asia/Manila')::date then ' tomorrow' else '' end ||
          ': ' || coalesce(nullif(btrim(r.name), ''), 'a lead'),
        btrim(coalesce(nullif(r.ev ->> 'title', ''), v_label) || case when coalesce(r.ev ->> 'location', '') <> '' then ', ' || (r.ev ->> 'location') else '' end ||
          '. Remind the client by text or Viber if needed.'),
        'leads');
      insert into public.viewing_reminders_sent (lead_id, event_id, remind_at, sent_to) values (r.lid, r.ev ->> 'id', v_remind, v_who)
        on conflict do nothing;
      alerted := true;
    end if;
    return next;
  end loop;
end;
$function$;
revoke all on function public.viewing_reminder_sweep(boolean) from public, anon, authenticated;
grant execute on function public.viewing_reminder_sweep(boolean) to service_role;

create or replace function public.compliance_expiry_sweep(p_dry_run boolean default true)
returns table(record_id text, days_left integer, notified uuid, stage text, alerted boolean)
language plpgsql security definer set search_path to 'public' as $function$
declare
  r record;
  who uuid;
  v_days integer;
  v_stage text;
  v_title text;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  for r in
    select c.id, c.name, c.number, c.holder, c.expires_at, c.owner,
           (select p.broker from public.profiles p where p.id = c.owner and p.role = 'agent') as agent_broker
      from public.compliance_records c
     where c.status <> 'revoked'
       and c.expires_at is not null
       and c.expires_at between v_today - 30 and v_today + 60
       and c.owner is not null
  loop
    v_days := r.expires_at - v_today;
    v_stage := case when v_days <= 0 then 'expired' when v_days <= 7 then '7' when v_days <= 30 then '30' else '60' end;
    v_title := left(case when v_stage = 'expired' then 'Expired: ' else 'Renew within ' || v_stage || ' days: ' end ||
      coalesce(nullif(btrim(r.name), ''), 'licence') || case when coalesce(btrim(r.holder), '') <> '' then ' (' || btrim(r.holder) || ')' else '' end, 200);
    for who in
      select r.owner
      union
      select r.agent_broker where r.agent_broker is not null
    loop
      continue when exists (select 1 from public.notifications n where n.user_id = who and n.title = v_title and n.created_at > now() - interval '120 days');
      record_id := r.id; days_left := v_days; notified := who; stage := v_stage; alerted := false;
      if not p_dry_run then
        perform public.notify_user(who, 'system', v_title,
          case when v_stage = 'expired' then 'Expired on ' || to_char(r.expires_at, 'FMMonth FMDD, YYYY') || '. Renew it and update the record in Compliance.'
               else 'Expires on ' || to_char(r.expires_at, 'FMMonth FMDD, YYYY') || ' (' || v_days || ' days). Start the renewal, then update the record in Compliance.' end ||
            case when coalesce(btrim(r.number), '') <> '' then ' No. ' || btrim(r.number) || '.' else '' end,
          'admin:compliance');
        alerted := true;
      end if;
      return next;
    end loop;
  end loop;
end;
$function$;
revoke all on function public.compliance_expiry_sweep(boolean) from public, anon, authenticated;
grant execute on function public.compliance_expiry_sweep(boolean) to service_role;

select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('viewing_reminder_sweep', 'compliance_expiry_sweep'))::int as sweep_functions,
       (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname = 'viewing_reminders_sent')::int as sent_table;
