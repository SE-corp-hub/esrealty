\set ON_ERROR_STOP 1
-- Old-data clean-up (supabase/migrations/0010, retention_sweep). Rolls back.
\pset tuples_only on
\pset format unaligned
begin;
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'ran'; exception when insufficient_privilege then return 'refused'; when others then return 'error: ' || sqlerrm; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
create temp table results(name text, ok boolean, detail text);
grant all on results to authenticated, anon;
create temp table r(what text, rows_found bigint, deleted boolean);

insert into public.notifications (user_id, title, read_at, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'old read', now() - interval '200 days', now() - interval '200 days'),
  ('11111111-1111-1111-1111-111111111111', 'old unread', null, now() - interval '200 days'),
  ('11111111-1111-1111-1111-111111111111', 'new read', now(), now() - interval '10 days');
insert into public.password_resets (user_id, email, status, created_at, resolved_at) values
  ('11111111-1111-1111-1111-111111111111', 'agent@x.ph', 'completed', now() - interval '60 days', now() - interval '59 days'),
  ('11111111-1111-1111-1111-111111111111', 'agent@x.ph', 'pending', now() - interval '60 days', null);
insert into public.shared_listings (id, owner_id, title) values ('rt-lst', '11111111-1111-1111-1111-111111111111', 'H');
insert into public.listing_inquiries (listing_id, full_name, phone, status, consent_at, created_at) values
  ('rt-lst', 'Spammer', '0', 'spam', now(), now() - interval '100 days'),
  ('rt-lst', 'Real Buyer', '0917', 'new', now(), now() - interval '100 days');

insert into r select * from public.retention_sweep(true);
insert into results select 'dry run counts only', (select sum(rows_found) from r) = 3 and (select bool_and(not deleted) from r)
  and (select count(*) from public.notifications where title like 'old%') = 2, (select string_agg(what || '=' || rows_found, '; ') from r);
delete from r;
insert into r select * from public.retention_sweep(false);
insert into results select 'old read notifications go; unread and recent stay', (select string_agg(title, ',' order by title) from public.notifications where title in ('old read', 'old unread', 'new read')) = 'new read,old unread', '';
insert into results select 'resolved resets go; a pending one stays', (select string_agg(status, ',') from public.password_resets where user_id = '11111111-1111-1111-1111-111111111111') = 'pending', '';
insert into results select 'spam goes; a real inquiry of the same age stays', (select string_agg(full_name, ',') from public.listing_inquiries where listing_id = 'rt-lst') = 'Real Buyer', '';
insert into results select 'leads and the change log are never touched', position('lead' in (select string_agg(what, ' ') from r)) = 0 and position('change log' in (select string_agg(what, ' ') from r)) = 0, '';
set local role authenticated;
insert into results select 'people in the app cannot run it', pg_temp.fails($q$select * from public.retention_sweep(true)$q$) = 'refused', '';
reset role;

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail, '') end from results;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from results;
rollback;
