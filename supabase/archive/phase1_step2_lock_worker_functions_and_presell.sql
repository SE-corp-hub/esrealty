-- SEA ESTATES · Phase 1, step 2 (2026-10-16)
-- Found in the live schema snapshot:
-- 1) The CRM follow-up worker functions are meant to run only from the
--    agent-dispatch Edge Function (service role), but anyone with the public
--    site key can call them today: claim, complete or cancel every follow-up
--    task. The browser never calls them (it only uses agent_set_step).
-- 2) compliance_schedule_renewals can be run by signed-out visitors.
-- 3) Pre-selling projects, units and payment schedules (buyer names, amounts)
--    are readable by every signed-in account, including pending ones. This
--    limits them to approved accounts.
-- Safe to run more than once: if any line fails, nothing changes.
begin;

revoke execute on function public.agent_claim_due(integer) from public, anon, authenticated;
revoke execute on function public.agent_complete(uuid, jsonb, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.agent_cancel(uuid) from public, anon, authenticated;
revoke execute on function public.agent_snooze_lead(text) from public, anon, authenticated;
grant execute on function public.agent_claim_due(integer) to service_role;
grant execute on function public.agent_complete(uuid, jsonb, timestamptz, text) to service_role;
grant execute on function public.agent_cancel(uuid) to service_role;
grant execute on function public.agent_snooze_lead(text) to service_role;

revoke execute on function public.compliance_schedule_renewals(integer) from public, anon;
grant execute on function public.compliance_schedule_renewals(integer) to authenticated, service_role;

alter policy "presell projects read auth" on public.presell_projects using (public.listing_current_user_is_approved());
alter policy "presell units read auth" on public.presell_units using (public.listing_current_user_is_approved());
alter policy "presell payments read auth" on public.presell_payments using (public.listing_current_user_is_approved());

commit;

-- Check: who can run the worker functions, and the new pre-selling read rules.
-- Copy both results back to Claude.
select p.proname as function, p.proacl::text as who_can_run
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('agent_claim_due', 'agent_complete', 'agent_cancel', 'agent_snooze_lead', 'compliance_schedule_renewals')
order by 1;

select tablename, policyname, qual
from pg_policies
where schemaname = 'public' and tablename like 'presell_%' and cmd = 'SELECT'
order by 1;
