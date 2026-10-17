-- PMS receipt photos in private storage (2026-10-17)
--
-- Run AFTER supabase/pms_v2_tables.sql, in the Supabase SQL editor.
-- Safe to run more than once.
--
-- Receipt photos used to sit inside each payment record as a picture encoded
-- as text, which made every PMS load heavy and gave each file no access rule
-- of its own (PMS analysis S6). With this bucket, the app stores each photo
-- as a private file at payments/<payment id>/<file> and opens it through a
-- link that expires after a few minutes.
--
-- Who can open a receipt: exactly the people who can read its payment row.
--   - staff (super-admin): every receipt, and upload / replace / delete
--   - an owner: receipts for payments on their properties
--   - a tenant: receipts for their own payments
-- The read rule asks pms_payments, so the payment table's row rules decide.
--
-- Existing photos move across by themselves: the next time a super-admin
-- opens the app, it uploads each old photo here and replaces the text copy
-- with the file's path. Nothing is deleted from the payment records until
-- the upload has succeeded.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pms-receipts', 'pms-receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pms receipts staff all" on storage.objects;
create policy "pms receipts staff all" on storage.objects
  for all to authenticated
  using (bucket_id = 'pms-receipts' and public.pms_is_staff())
  with check (bucket_id = 'pms-receipts' and public.pms_is_staff());

drop policy if exists "pms receipts linked read" on storage.objects;
create policy "pms receipts linked read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pms-receipts'
    and (storage.foldername(name))[1] = 'payments'
    and exists (
      select 1 from public.pms_payments p
      where p.id = (storage.foldername(name))[2]
        and not p.archived
    )
  );

-- Check: one bucket row, private, and two policies.
select
  (select count(*) from storage.buckets where id = 'pms-receipts' and public = false) as private_bucket,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'pms receipts%') as policies;
