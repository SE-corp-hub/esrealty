\set ON_ERROR_STOP 1
-- Hand over records before deleting an account (supabase/migrations/0010). Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when insufficient_privilege then return 'refused'; when others then return 'error: ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(uid text, em text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', em)::text, true); $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
create temp table results(name text, ok boolean, detail text);
grant all on results to authenticated, anon;
create temp table moved(j jsonb);
grant all on moved to authenticated;

-- Broker A (aaaa) owns things and supervises agent 1111; B (bbbb) takes over.
update public.profiles set broker = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' where id = '11111111-1111-1111-1111-111111111111';
insert into public.crm_leads (id, name, created_by, assigned_to_id) values
  ('ho-1', 'Made by A', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null),
  ('ho-2', 'Given to A', '77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into public.shared_listings (id, owner_id, title) values ('ho-l', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A house');
insert into public.broker_transactions (id, title, broker_id, created_by) values ('ho-t', 'A deal', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

set local role authenticated;
select pg_temp.as_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'brokera@x.ph');
insert into results select 'a broker cannot hand over records', pg_temp.fails($q$select public.admin_handover_records('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$q$) = 'refused', '';
insert into results select 'people in the app still cannot change a lead''s creator',
  pg_temp.fails($q$update public.crm_leads set created_by = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id = 'ho-1'$q$) like 'error: Lead creator cannot be changed%', pg_temp.fails($q$update public.crm_leads set created_by = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id = 'ho-1'$q$);
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into results select 'records cannot go to a buyer', pg_temp.fails($q$select public.admin_handover_records('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222')$q$) like 'error: Records can only go to%', '';
insert into results select 'records cannot go to a pending broker', pg_temp.fails($q$select public.admin_handover_records('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc')$q$) like 'error: Records can only go to%', '';
insert into results select 'the owned counts are shown first', (select (public.admin_records_owned('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') ->> 'leads')::int = 2 and (public.admin_records_owned('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') ->> 'agents')::int = 1), public.admin_records_owned('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text;
insert into moved select public.admin_handover_records('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
reset role;
insert into results select 'leads made by and given to A now belong to B',
  (select created_by = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' from public.crm_leads where id = 'ho-1')
  and (select assigned_to_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and payload ->> 'assignedTo' = 'Broker Beta' from public.crm_leads where id = 'ho-2'), '';
insert into results select 'listing and deal move', (select owner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' from public.shared_listings where id = 'ho-l')
  and (select broker_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and created_by = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' from public.broker_transactions where id = 'ho-t'), '';
insert into results select 'A''s agent is now supervised by B', (select broker = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' from public.profiles where id = '11111111-1111-1111-1111-111111111111'), '';
insert into results select 'the counts come back and go to the change log', (select (j ->> 'leads_created')::int = 1 and (j ->> 'leads_assigned')::int = 1 and (j ->> 'listings')::int = 1 from moved)
  and (select count(*) from public.audit_events where event_type = 'records_handed_over' and entity_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 1, (select j::text from moved);
insert into results select 'nothing is left for A', (select bool_and(value::text in ('0')) from jsonb_each(public.admin_records_owned('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))), public.admin_records_owned('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text;

-- Deleting A now removes only A's own account data; the records and the change log stay.
insert into public.audit_events (owner_id, event_type, entity_type, entity_id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'lead_status', 'crm_lead', 'ho-2');
delete from auth.users where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
insert into results select 'after deleting A, the handed-over records are still there', (select count(*) from public.crm_leads where id in ('ho-1', 'ho-2')) = 2 and (select count(*) from public.shared_listings where id = 'ho-l') = 1, '';
insert into results select 'A''s change log entries outlive the account', (select count(*) from public.audit_events where owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 1, '';

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
