-- Listing photo uploads via Supabase Storage.
-- Run after schema.sql (private-documents bucket pattern) in the SQL Editor.
-- Creates a public bucket so listing photos render on the public storefront.

begin;

insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do nothing;

-- Publishers upload photos into their own user-id folder.
create policy "listing photos insert own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'listing-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "listing photos update own folder"
  on storage.objects for update
  using (bucket_id = 'listing-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "listing photos delete own folder"
  on storage.objects for delete
  using (bucket_id = 'listing-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- Public bucket: anyone may read listing photos.
create policy "listing photos public read"
  on storage.objects for select
  using (bucket_id = 'listing-photos');

commit;