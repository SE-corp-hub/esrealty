-- Storage rules, a fuller change log, one open co-broke per listing and partner (2026-10-21).
-- Safe to run twice.
--
-- Apply with GitHub > Actions > Apply database migration (test, then apply),
-- AFTER 0005. Changes no data. Backend roadmap items B9, B6 (rest), J6.
--
-- 1. Storage (B9).
--    - listing-photos: a size limit (3 MB; the app already stops at 2 MB) and image types
--      only. The public web address of each photo keeps working (the bucket stays public);
--      what goes is the rule that let anyone LIST the whole bucket. People can still see,
--      replace and delete the files in their own folder, and Super Admins can see all.
--    - private-documents: a size limit (3 MB; the app stops at 2 MB). Types stay open on
--      purpose: when a browser cannot name a file's type the app sends it as a generic
--      file, and refusing those would turn away real documents. Super Admins can now read
--      every file here, so a data-subject request (access or erasure) can be answered.
--    - pms-receipts: PDF is accepted next to photos. (The app still sends photos only.)
-- 2. More of the change log (B6): deals (opened, stage changed, deleted), property
--    management payments (recorded, amount or status changed) and co-broke agreements
--    (proposed, status changed). Same rules as 0005: only changes made by a signed-in
--    person are logged, and logging can never stop the change itself.
-- 3. Co-broke (J6): one OPEN (proposed or accepted) agreement per listing and partner
--    email. A declined, cancelled or completed one does not block a new proposal. If the
--    live data already holds duplicates, the index is skipped with a warning (nothing is
--    changed); cancel the extra agreements and run this file again.

-- 1. Storage ------------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 3145728,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
 where id = 'listing-photos';
update storage.buckets set file_size_limit = 3145728 where id = 'private-documents';
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
 where id = 'pms-receipts';

drop policy if exists "listing photos public read" on storage.objects;
drop policy if exists "listing photos read own folder" on storage.objects;
create policy "listing photos read own folder" on storage.objects as permissive for select to authenticated
  using (bucket_id = 'listing-photos' and (auth.uid())::text = (storage.foldername(name))[1]);
drop policy if exists "listing photos super-admin read" on storage.objects;
create policy "listing photos super-admin read" on storage.objects as permissive for select to authenticated
  using (bucket_id = 'listing-photos' and public.is_super_admin());
drop policy if exists "documents super-admin read" on storage.objects;
create policy "documents super-admin read" on storage.objects as permissive for select to authenticated
  using (bucket_id = 'private-documents' and public.is_super_admin());

-- 2. Change log, the rest ------------------------------------------------------------------
-- Deals: opened, stage moved, deleted. The stage and price live in the deal's data.
create or replace function public.audit_broker_transactions()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op = 'INSERT' then
    perform public.audit_log('deal_created', 'broker_transaction', new.id,
      jsonb_build_object('stage', new.payload ->> 'stage', 'price', new.payload ->> 'price'));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.payload ->> 'stage' is distinct from old.payload ->> 'stage' then
      perform public.audit_log('deal_stage', 'broker_transaction', new.id,
        jsonb_build_object('from', old.payload ->> 'stage', 'to', new.payload ->> 'stage', 'price', new.payload ->> 'price'));
    end if;
    return new;
  end if;
  perform public.audit_log('deal_deleted', 'broker_transaction', old.id,
    jsonb_build_object('stage', old.payload ->> 'stage', 'price', old.payload ->> 'price'));
  return old;
end;
$function$;
revoke all on function public.audit_broker_transactions() from public, anon, authenticated;
drop trigger if exists broker_transactions_audit on public.broker_transactions;
create trigger broker_transactions_audit after insert or update or delete on public.broker_transactions
  for each row execute function public.audit_broker_transactions();

-- Property management payments: recorded, amount or status changed (archiving counts as a status).
create or replace function public.audit_pms_payments()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op = 'INSERT' then
    perform public.audit_log('pms_payment_added', 'pms_payment', new.id,
      jsonb_build_object('amount', new.data ->> 'amount', 'status', new.data ->> 'status', 'month', new.data ->> 'month'));
    return new;
  end if;
  if new.data ->> 'amount' is distinct from old.data ->> 'amount'
     or new.data ->> 'status' is distinct from old.data ->> 'status'
     or new.archived is distinct from old.archived then
    perform public.audit_log('pms_payment_changed', 'pms_payment', new.id,
      jsonb_build_object('from_amount', old.data ->> 'amount', 'to_amount', new.data ->> 'amount',
                         'from_status', case when old.archived then 'archived' else old.data ->> 'status' end,
                         'to_status', case when new.archived then 'archived' else new.data ->> 'status' end,
                         'month', new.data ->> 'month'));
  end if;
  return new;
end;
$function$;
revoke all on function public.audit_pms_payments() from public, anon, authenticated;
drop trigger if exists pms_payments_audit on public.pms_payments;
create trigger pms_payments_audit after insert or update on public.pms_payments
  for each row execute function public.audit_pms_payments();

-- Co-broke: proposed, status changed (accepted, declined, completed, cancelled). The partner's
-- email is not copied into the log.
create or replace function public.audit_cobroke_agreements()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op = 'INSERT' then
    perform public.audit_log('cobroke_proposed', 'cobroke', new.id::text,
      jsonb_build_object('listing_id', new.listing_id, 'split_selling_pct', new.split_selling_pct));
    return new;
  end if;
  if new.status is distinct from old.status then
    perform public.audit_log('cobroke_status', 'cobroke', new.id::text,
      jsonb_build_object('listing_id', new.listing_id, 'from', old.status, 'to', new.status));
  end if;
  return new;
end;
$function$;
revoke all on function public.audit_cobroke_agreements() from public, anon, authenticated;
drop trigger if exists cobroke_agreements_audit on public.cobroke_agreements;
create trigger cobroke_agreements_audit after insert or update of status on public.cobroke_agreements
  for each row execute function public.audit_cobroke_agreements();

-- 3. One open co-broke per listing and partner ----------------------------------------------
do $$
declare dupes int;
begin
  select count(*) into dupes from (
    select 1 from public.cobroke_agreements
     where status in ('proposed', 'accepted')
     group by listing_id, lower(partner_email) having count(*) > 1) d;
  if dupes > 0 then
    raise warning 'cobroke_one_open_idx NOT created: % listing/partner pairs have more than one open co-broke agreement. Cancel the extra ones and run 0006 again.', dupes;
  else
    create unique index if not exists cobroke_one_open_idx
      on public.cobroke_agreements (listing_id, lower(partner_email)) where status in ('proposed', 'accepted');
  end if;
end $$;

-- What this file changed, for the apply log (counts only).
select
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('listing photos read own folder', 'listing photos super-admin read', 'documents super-admin read'))::int as new_storage_policies,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'listing photos public read')::int as public_read_left,
  (select count(*) from pg_trigger where tgname in ('broker_transactions_audit', 'pms_payments_audit', 'cobroke_agreements_audit') and not tgisinternal)::int as new_audit_triggers,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'cobroke_one_open_idx')::int as cobroke_index;
