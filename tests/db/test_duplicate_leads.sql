\set ON_ERROR_STOP 1
-- Duplicate leads from outside (supabase/migrations/0012). Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.as_user(uid text, em text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', em)::text, true); $$;
create or replace function pg_temp.nobody() returns void language sql as $$ select set_config('request.jwt.claims', '', true); $$;
create temp table results(name text, ok boolean, detail text);

insert into results select 'phone numbers compare as digits without +63 or leading zeros',
  public.crm_norm_phone('+63 917 123 4567') = '9171234567' and public.crm_norm_phone('0917-123-4567') = '9171234567' and public.crm_norm_phone('') is null, public.crm_norm_phone('+63 917 123 4567');
insert into results select 'emails compare in lower case, without spaces', public.crm_norm_email('  Ana@X.PH ') = 'ana@x.ph' and public.crm_norm_email(' ') is null, '';

-- An earlier lead, assigned to agent 1111 (approved).
select pg_temp.nobody();
insert into public.crm_leads (id, ref, name, payload, created_by, assigned_to_id, assigned_to, created_at) values
  ('dl-old', 'L-0100', 'Ana Reyes', '{"phone":"0917 123 4567","email":"ana@x.ph","activity":[]}', '77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', 'Agent One', now() - interval '20 days');

-- The same person writes again through the website: same phone, different format.
insert into public.crm_leads (id, name, payload, created_by) values ('dl-new', 'Ana R.', '{"phone":"+63 917 123 4567","source":"website","activity":[{"text":"Lead created"}]}', '77777777-7777-7777-7777-777777777777');
insert into results select 'a repeat website lead is marked as a possible duplicate',
  (select payload ->> 'possibleDuplicateOf' = 'dl-old' and payload ->> 'possibleDuplicateRef' = 'L-0100' from public.crm_leads where id = 'dl-new'), (select payload::text from public.crm_leads where id = 'dl-new');
insert into results select 'it goes to the agent who has the earlier lead',
  (select assigned_to_id = '11111111-1111-1111-1111-111111111111' and payload ->> 'assignedToId' = '11111111-1111-1111-1111-111111111111' from public.crm_leads where id = 'dl-new'), '';
insert into results select 'its activity says why, after the original lines',
  (select payload -> 'activity' -> 0 ->> 'text' = 'Lead created' and payload -> 'activity' -> 1 ->> 'text' like 'Same phone or email as lead L-0100: possibly the same person. Assigned to Agent One%' from public.crm_leads where id = 'dl-new'), '';
insert into results select 'the agent gets the usual "New lead for you" alert', (select count(*) from public.notifications where user_id = '11111111-1111-1111-1111-111111111111' and title = 'New lead for you: Ana R.') = 1, '';
insert into results select 'the earlier lead is not changed', (select payload ->> 'possibleDuplicateOf' is null and assigned_to_id = '11111111-1111-1111-1111-111111111111' from public.crm_leads where id = 'dl-old'), '';

-- Same email, with routing on: the earlier person wins, routing leaves it alone.
insert into public.site_settings (key, value, is_public) values ('leadRouting', '{"enabled": true, "brokers": ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"], "next": 0}', false)
  on conflict (key) do update set value = excluded.value;
insert into public.crm_leads (id, name, payload, created_by) values ('dl-mail', 'Ana', '{"email":"ANA@x.ph ","source":"facebook"}', '77777777-7777-7777-7777-777777777777');
insert into results select 'matched by email; routing does not take it away', (select assigned_to_id = '11111111-1111-1111-1111-111111111111' and payload ->> 'possibleDuplicateOf' in ('dl-new', 'dl-old') from public.crm_leads where id = 'dl-mail'),
  (select assigned_to_id::text || ' ' || coalesce(payload ->> 'possibleDuplicateOf', '-') from public.crm_leads where id = 'dl-mail');
insert into results select 'by email alone: the lead with that email', (select payload ->> 'possibleDuplicateOf' = 'dl-old' from public.crm_leads where id = 'dl-mail'), '';
update public.crm_leads set created_at = now() - interval '2 days' where id = 'dl-new';
insert into public.crm_leads (id, name, payload, created_by) values ('dl-both', 'Ana', '{"phone":"09171234567","source":"website"}', '77777777-7777-7777-7777-777777777777');
insert into results select 'when several match, the most recent is named', (select payload ->> 'possibleDuplicateOf' = 'dl-new' from public.crm_leads where id = 'dl-both'), (select payload ->> 'possibleDuplicateOf' from public.crm_leads where id = 'dl-both');

-- A new person: untouched, routing still works.
insert into public.crm_leads (id, name, payload, created_by) values ('dl-other', 'Ben', '{"phone":"0918 765 4321","source":"website"}', '77777777-7777-7777-7777-777777777777');
insert into results select 'a new person is not marked, and routing still assigns them', (select payload ->> 'possibleDuplicateOf' is null and assigned_to_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' from public.crm_leads where id = 'dl-other'), '';

-- Earlier lead's person no longer approved staff: marked, but not assigned to them.
update public.crm_leads set assigned_to_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc', assigned_to = 'Broker Pending' where id = 'dl-other';
update public.site_settings set value = '{"enabled": false}' where key = 'leadRouting';
insert into public.crm_leads (id, name, payload, created_by) values ('dl-again', 'Ben', '{"phone":"918-765-4321"}', '77777777-7777-7777-7777-777777777777');
insert into results select 'not given to someone who is not approved staff', (select payload ->> 'possibleDuplicateOf' = 'dl-other' and assigned_to_id is null from public.crm_leads where id = 'dl-again'), '';

-- No phone or email: nothing to compare.
insert into public.crm_leads (id, name, payload, created_by) values ('dl-none', 'Walk-in', '{"source":"website"}', '77777777-7777-7777-7777-777777777777');
insert into results select 'no phone or email: left alone', (select payload ->> 'possibleDuplicateOf' is null from public.crm_leads where id = 'dl-none'), '';

-- Typed in the app by a signed-in person: not touched (the app warns before saving).
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
set local role authenticated;
insert into public.crm_leads (id, name, payload, created_by, assigned_to_id) values ('dl-app', 'Ana again', '{"phone":"09171234567"}', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111');
reset role;
select pg_temp.nobody();
insert into results select 'leads typed in the app are not marked', (select payload ->> 'possibleDuplicateOf' is null from public.crm_leads where id = 'dl-app'), '';

-- Team targets: staff read the one row; only a Super Admin writes; other settings stay hidden.
insert into public.site_settings (key, value, is_public) values ('teamTargets', '{"month":"2026-10","targets":{}}', false) on conflict (key) do update set value = excluded.value;
create temp table seen(who text, n int); grant all on seen to authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'agent@x.ph');
set local role authenticated;
insert into seen select 'agent targets', count(*) from public.site_settings where key = 'teamTargets';
insert into seen select 'agent routing', count(*) from public.site_settings where key = 'leadRouting';
update public.site_settings set value = '{"hacked":true}' where key = 'teamTargets';
reset role;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'buyer@x.ph');
set local role authenticated;
insert into seen select 'buyer targets', count(*) from public.site_settings where key = 'teamTargets';
reset role;
select pg_temp.as_user('cccccccc-cccc-cccc-cccc-cccccccccccc', 'brokerc@x.ph');
set local role authenticated;
insert into seen select 'pending targets', count(*) from public.site_settings where key = 'teamTargets';
reset role;
select pg_temp.nobody();
insert into results select 'an approved agent can read the team targets', (select n from seen where who = 'agent targets') = 1, '';
insert into results select 'but not other private settings', (select n from seen where who = 'agent routing') = 0, '';
insert into results select 'and cannot change the targets', (select value ->> 'hacked' is null from public.site_settings where key = 'teamTargets'), '';
insert into results select 'buyers and pending accounts cannot read them', (select n from seen where who = 'buyer targets') = 0 and (select n from seen where who = 'pending targets') = 0, '';

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
