-- Leads, deals and ads: the database keeps "last changed" (2026-10-18).
--
-- Run in the Supabase SQL editor after 0001. Safe to run more than once.
--
-- crm_leads, broker_transactions and ad_posts are shared between an agent, their
-- broker and the super-admins. Until now each phone wrote its own clock time
-- into updated_at, so the column could not tell whether a phone was saving on
-- top of a newer change from someone else. From now on the database sets
-- updated_at on every change; the app saves a lead or deal only on top of the
-- version it last saw, and otherwise merges the two (its own fields win, and
-- nobody's notes, activity or documents are lost).
--
-- ad_posts only exists where supabase/archive/ad_posts.sql has been run; it is skipped
-- otherwise.

do $$
declare t text;
begin
  foreach t in array array['crm_leads', 'broker_transactions', 'ad_posts'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end $$;

-- Check: one trigger per table that exists (2 or 3).
select count(*) as updated_at_triggers,
       (to_regclass('public.ad_posts') is not null) as ad_posts_table
from pg_trigger
where not tgisinternal
  and tgname in ('crm_leads_set_updated_at', 'broker_transactions_set_updated_at', 'ad_posts_set_updated_at');
