\set ON_ERROR_STOP 1
-- Leads and deals: the database keeps updated_at (supabase/migrations/0002), so a
-- phone can only save on top of the version it last saw. Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.changed(q text) returns int language plpgsql as $$
declare n int; begin execute q; get diagnostics n = row_count; return n; exception when others then return -1; end $$;
create or replace function pg_temp.as_user(uid text, em text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', em)::text, true); $$;
grant execute on all functions in schema pg_temp to authenticated;
create temp table results(name text, ok boolean, detail text);
grant all on results to authenticated;
insert into public.crm_leads (id, ref, name, payload, created_by, updated_at)
  values ('lead-t1', 'L-T1', 'Test', '{"id":"lead-t1"}', '77777777-7777-7777-7777-777777777777', '2026-01-01');
insert into public.broker_transactions (id, ref, title, payload, broker_id, created_by, updated_at)
  values ('tx-t1', 'T-T1', 'Deal', '{"id":"tx-t1"}', '77777777-7777-7777-7777-777777777777', '77777777-7777-7777-7777-777777777777', '2026-01-01');
-- simulate time passing so now() differs from the stored value
set local role authenticated;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777', 'admin@x.ph');
insert into results select 'leads: a save made with the version seen applies', pg_temp.changed($q$update public.crm_leads set payload = '{"id":"lead-t1","n":1}', updated_at = '2026-01-02' where id = 'lead-t1' and updated_at = '2026-01-01'$q$) = 1, '';
insert into results select 'leads: the database sets updated_at, not the phone', (select updated_at > '2026-01-02' from public.crm_leads where id = 'lead-t1'), (select updated_at::text from public.crm_leads where id = 'lead-t1');
insert into results select 'leads: a save based on the old version no longer applies', pg_temp.changed($q$update public.crm_leads set payload = '{"id":"lead-t1","stale":true}' where id = 'lead-t1' and updated_at = '2026-01-01'$q$) = 0, '';
insert into results select 'deals: a save applies', pg_temp.changed($q$update public.broker_transactions set title = 'Deal 2', updated_at = '2026-01-02' where id = 'tx-t1'$q$) = 1, '';
insert into results select 'deals: the database sets updated_at too', (select updated_at > '2026-01-02' from public.broker_transactions where id = 'tx-t1'), '';
reset role;
insert into results select 'triggers in place on leads and deals', (select count(*) from pg_trigger where tgname in ('crm_leads_set_updated_at', 'broker_transactions_set_updated_at')) = 2, '';
select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
