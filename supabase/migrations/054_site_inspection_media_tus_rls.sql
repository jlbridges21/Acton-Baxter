-- Restore authenticated TUS uploads for site-inspection-media.
--
-- Root cause of "user JWT → RLS violation / service-role → 201":
-- Migration 047 installed deny-all insert/update/select policies on this bucket.
-- 048 added scoped allow policies, but left the deny-all policies in place and
-- never granted SELECT (needed for TUS resume / HEAD). Depending on apply order
-- and policy evaluation, authenticated resumable uploads failed while the
-- service role (RLS bypass) succeeded — which pushed the client onto
-- non-resumable signed URLs for large videos.
--
-- This migration:
-- 1. Drops the deny-all policies for site-inspection-media
-- 2. Recreates insert / update / select for the caller's own {auth.uid()}/… prefix
-- 3. Keeps the bucket private (no public read; app uses signed download URLs)
-- 4. Ensures video MIME types remain allowed (no size cap)

update storage.buckets
set
  file_size_limit = null,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-m4v'
  ]
where id = 'site-inspection-media';

drop policy if exists "No client read site inspection media" on storage.objects;
drop policy if exists "No client insert site inspection media" on storage.objects;
drop policy if exists "No client update site inspection media" on storage.objects;
drop policy if exists "No client delete site inspection media" on storage.objects;

drop policy if exists "Users can upload own site inspection media" on storage.objects;
create policy "Users can upload own site inspection media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'site-inspection-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update own site inspection media" on storage.objects;
create policy "Users can update own site inspection media"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'site-inspection-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'site-inspection-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- SELECT is required for TUS to locate / resume a previous upload (HEAD / metadata).
drop policy if exists "Users can read own site inspection media" on storage.objects;
create policy "Users can read own site inspection media"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'site-inspection-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Optional: allow owners to remove their own in-progress objects (cancel cleanup).
drop policy if exists "Users can delete own site inspection media" on storage.objects;
create policy "Users can delete own site inspection media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'site-inspection-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

comment on policy "Users can upload own site inspection media" on storage.objects is
  'Authenticated TUS/signed uploads under {auth.uid()}/… in site-inspection-media.';
