\set ON_ERROR_STOP 1
-- Viewing reminders and licence renewal reminders (supabase/migrations/0011). Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when insufficient_privilege then return 'refused'; when others then return 'error: ' || sqlerrm; end $$;
-- A calendar entry starting `mins` minutes from now, Philippine time.
create or replace function pg_temp.ev(id text, mins integer, remind text, status text default 'scheduled', typ text default 'showing') returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'type', typ, 'title', 'Site viewing', 'location', 'Lipa', 'reminder', remind, 'status', status,
    'date', to_char((now() + make_interval(mins => mins)) at time zone 'Asia/Manila', 'YYYY-MM-DD'),
    'time', to_char((now() + make_interval(mins => mins)) at time zone 'Asia/Manila', 'HH24:MI')) $$;
create temp table results(name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant execute on all functions in schema pg_temp to authenticated, anon;
create temp table v1 as select * from public.viewing_reminder_sweep(true) limit 0;
create temp table c1 as select * from public.compliance_expiry_sweep(true) limit 0;

-- Agent 1111 belongs to broker A (aaaa).
update public.profiles set broker = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' where id = '11111111-1111-1111-1111-111111111111';
insert into public.crm_leads (id, name, payload, created_by, assigned_to_id) values
  ('vr-1', 'Vina Viewer', jsonb_build_object('calendarEvents', jsonb_build_array(
      pg_temp.ev('e-soon', 40, '1'),          -- starts in 40 min, 1 hour reminder: due
      pg_temp.ev('e-later', 150, '1'),        -- starts in 2.5 h, 1 hour reminder: not yet
      pg_temp.ev('e-3h', 150, '3', 'scheduled', 'meeting'), -- 3 hour reminder: due
      pg_temp.ev('e-past', -20, '24'),        -- already started: never
      pg_temp.ev('e-cancel', 30, '1', 'cancelled'),
      pg_temp.ev('e-none', 30, '0'))), '77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111'),
  ('vr-2', 'Una Unassigned', jsonb_build_object('calendarEvents', jsonb_build_array(pg_temp.ev('e-day', 600, '24'))), '77777777-7777-7777-7777-777777777777', null),
  ('vr-3', 'Bad Data', '{"calendarEvents": [{"id": "x", "date": "next Monday", "reminder": "1"}, {"id": "y", "date": "2026-13-45", "time": "10:00", "reminder": "1"}]}', '77777777-7777-7777-7777-777777777777', null),
  ('vr-4', 'No Events', '{"calendarEvents": "oops"}', '77777777-7777-7777-7777-777777777777', null);

insert into v1 select * from public.viewing_reminder_sweep(true);
insert into results select 'dry run sends nothing', (select count(*) from public.notifications where title ~ '^(Viewing|Meeting) at') = 0 and (select count(*) from public.viewing_reminders_sent) = 0, '';
insert into results select 'due reminders: 1 hour, 3 hours and 1 day before', (select string_agg(event_id, ',' order by event_id) from v1) = 'e-3h,e-day,e-soon', (select string_agg(event_id, ',' order by event_id) from v1);
insert into results select 'the assigned agent is reminded', (select notified from v1 where event_id = 'e-soon') = '11111111-1111-1111-1111-111111111111', '';
insert into results select 'nobody assigned: whoever created the lead', (select notified from v1 where event_id = 'e-day') = '77777777-7777-7777-7777-777777777777', '';
insert into results select 'broken dates and a non-list are skipped, not an error', (select count(*) from v1 where lead_id in ('vr-3', 'vr-4')) = 0, '';

delete from v1;
insert into v1 select * from public.viewing_reminder_sweep(false);
insert into results select 'sending: the bell gets "Viewing at <time>: <lead>"', (select count(*) from public.notifications where user_id = '11111111-1111-1111-1111-111111111111' and title ~ '^Viewing at \d{1,2}:\d{2} (AM|PM)( tomorrow)?: Vina Viewer$' and type = 'lead' and link_view = 'leads') = 1,
  (select string_agg(title, ' | ') from public.notifications where user_id = '11111111-1111-1111-1111-111111111111');
insert into results select 'a meeting is called a meeting, with the place', (select count(*) from public.notifications where title like 'Meeting at %: Vina Viewer' and body like 'Site viewing, Lipa.%') = 1, '';
insert into results select 'each sent reminder is recorded', (select count(*) from public.viewing_reminders_sent) = 3, '';
delete from v1;
insert into v1 select * from public.viewing_reminder_sweep(false);
insert into results select 'the next run sends nothing again', (select count(*) from v1) = 0, (select count(*)::text from v1);
-- Moved to a new time: reminded again.
update public.crm_leads set payload = jsonb_build_object('calendarEvents', jsonb_build_array(pg_temp.ev('e-soon', 50, '1'))) where id = 'vr-1';
delete from v1;
insert into v1 select * from public.viewing_reminder_sweep(false);
insert into results select 'a viewing moved to another time is reminded again', (select count(*) from v1 where event_id = 'e-soon') = 1, '';

-- Licences: owner 1111 (agent of broker aaaa) and the Super Admin 7777.
insert into public.compliance_records (id, type, name, number, holder, expires_at, status, owner) values
  ('cr-30', 'broker_license', 'PRC licence', '0012345', 'Ana Agent', current_date + 20, 'active', '11111111-1111-1111-1111-111111111111'),
  ('cr-7', 'mayors_permit', 'Mayor''s permit', '', '', current_date + 5, 'active', '77777777-7777-7777-7777-777777777777'),
  ('cr-exp', 'bir_reg', 'BIR registration', '', '', current_date - 10, 'active', '77777777-7777-7777-7777-777777777777'),
  ('cr-far', 'broker_license', 'Far licence', '', '', current_date + 90, 'active', '77777777-7777-7777-7777-777777777777'),
  ('cr-old', 'broker_license', 'Old licence', '', '', current_date - 40, 'active', '77777777-7777-7777-7777-777777777777'),
  ('cr-rev', 'broker_license', 'Revoked licence', '', '', current_date + 3, 'revoked', '77777777-7777-7777-7777-777777777777');
insert into c1 select * from public.compliance_expiry_sweep(true);
insert into results select 'licences: 30 days, 7 days and expired are due', (select string_agg(distinct record_id || ':' || stage, ',' order by record_id || ':' || stage) from c1) = 'cr-30:30,cr-7:7,cr-exp:expired', (select string_agg(record_id || ':' || stage, ',') from c1);
insert into results select 'far, long-expired and revoked records are left alone', (select count(*) from c1 where record_id in ('cr-far', 'cr-old', 'cr-rev')) = 0, '';
insert into results select 'an agent''s licence also goes to their broker', (select count(*) from c1 where record_id = 'cr-30') = 2 and exists (select 1 from c1 where record_id = 'cr-30' and notified = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '';
delete from c1;
insert into c1 select * from public.compliance_expiry_sweep(false);
insert into results select 'sending: the title names the licence and the holder', (select count(*) from public.notifications where title = 'Renew within 30 days: PRC licence (Ana Agent)' and body like 'Expires on % (20 days).% No. 0012345.') = 2, '';
insert into results select 'expired records say so and open Compliance', (select count(*) from public.notifications where title = 'Expired: BIR registration' and type = 'system' and link_view = 'admin:compliance') = 1, '';
delete from c1;
insert into c1 select * from public.compliance_expiry_sweep(false);
insert into results select 'the next run sends nothing again', (select count(*) from c1) = 0, '';
-- Moves into the next stage: one more message.
update public.compliance_records set expires_at = current_date + 6 where id = 'cr-30';
delete from c1;
insert into c1 select * from public.compliance_expiry_sweep(false);
insert into results select 'the 7-day stage is a new message', (select count(*) from public.notifications where title = 'Renew within 7 days: PRC licence (Ana Agent)') = 2, '';

set local role authenticated;
insert into results select 'people in the app cannot run the viewing sweep', pg_temp.fails($q$select * from public.viewing_reminder_sweep(true)$q$) = 'refused', '';
insert into results select 'or the licence sweep', pg_temp.fails($q$select * from public.compliance_expiry_sweep(true)$q$) = 'refused', '';
insert into results select 'or read who was reminded', pg_temp.fails($q$select * from public.viewing_reminders_sent$q$) = 'refused', '';
reset role;

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
