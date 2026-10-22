\set ON_ERROR_STOP 1
-- First-response alerts for new leads (supabase/migrations/0008). Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when insufficient_privilege then return 'refused'; when others then return 'error: ' || sqlerrm; end $$;
create temp table results(name text, ok boolean, detail text);
grant all on results to authenticated, anon;
grant execute on all functions in schema pg_temp to authenticated, anon;
create temp table r1 as select * from public.lead_response_sweep(24, true) limit 0;

-- Agent 1111 belongs to broker A (aaaa). Leads: fresh, 30h unassigned, 30h agent, 60h agent, 60h worked on, 20 days old.
update public.profiles set broker = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' where id = '11111111-1111-1111-1111-111111111111';
insert into public.crm_leads (id, name, payload, created_by, assigned_to_id, created_at) values
  ('sla-fresh', 'Fresh Fiona', '{"status":"new"}', '77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', now() - interval '3 hours'),
  ('sla-unass', 'Una Unassigned', '{"status":"new"}', '77777777-7777-7777-7777-777777777777', null, now() - interval '30 hours'),
  ('sla-30', 'Thirty Tom', '{}', '77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', now() - interval '30 hours'),
  ('sla-60', 'Sixty Sam', '{"status":"new"}', '77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', now() - interval '60 hours'),
  ('sla-done', 'Done Dina', '{"status":"contacted"}', '77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', now() - interval '60 hours'),
  ('sla-old', 'Old Olga', '{"status":"new"}', '77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', now() - interval '20 days');

insert into r1 select * from public.lead_response_sweep(24, true);
insert into results select 'dry run sends nothing', (select count(*) from public.notifications where title like 'Not contacted yet:%' or title like 'Waiting for a first call:%') = 0 and (select bool_and(not alerted) from r1), '';
insert into results select 'fresh, worked-on and very old leads are left alone', (select count(*) from r1 where lead_id in ('sla-fresh', 'sla-done', 'sla-old')) = 0, (select string_agg(lead_id, ',') from r1);
insert into results select 'a lead with no status counts as New', (select count(*) from r1 where lead_id = 'sla-30' and step = 'assignee' and notified = '11111111-1111-1111-1111-111111111111') = 1, '';
insert into results select 'unassigned: the Super Admin hears', (select count(*) from r1 where lead_id = 'sla-unass' and notified = '77777777-7777-7777-7777-777777777777' and step = 'assignee') = 1, '';
insert into results select 'after 48h the agent''s broker hears', (select count(*) from r1 where lead_id = 'sla-60' and step = 'escalation' and notified = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 1, '';
insert into results select 'no escalation before 48h', (select count(*) from r1 where lead_id = 'sla-30' and step = 'escalation') = 0, '';

delete from r1;
insert into r1 select * from public.lead_response_sweep(24, false);
insert into results select 'sending: one message per person and lead', (select count(*) from public.notifications where title = 'Not contacted yet: Sixty Sam' and user_id = '11111111-1111-1111-1111-111111111111') = 1
  and (select count(*) from public.notifications where title = 'Waiting for a first call: Sixty Sam' and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 1, '';
insert into results select 'the messages are lead alerts that open Leads', (select bool_and(type = 'lead' and link_view = 'leads') from public.notifications where title like 'Not contacted yet:%'), '';
delete from r1;
insert into r1 select * from public.lead_response_sweep(24, false);
insert into results select 'the next hour sends nothing again', (select count(*) from r1) = 0, (select count(*)::text from r1);
insert into results select 'a bad window is refused', pg_temp.fails($q$select * from public.lead_response_sweep(0, true)$q$) like 'error: p_hours must be%', '';
set local role authenticated;
insert into results select 'people in the app cannot run it', pg_temp.fails($q$select * from public.lead_response_sweep(24, true)$q$) = 'refused', '';
reset role;

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
