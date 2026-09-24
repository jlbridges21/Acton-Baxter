-- Site inspection media is a shared team record, not a per-uploader folder.
--
-- 054 allowed INSERT/UPDATE/SELECT only when the object path started with
-- {auth.uid()}/. That does not match how inspections work: every app-access
-- user can open any inspection, and an ops lead must read media a field tech
-- uploaded. It also breaks TUS for any path that is not prefixed with the
-- caller's UUID — POST can succeed while PATCH (chunk 2) and HEAD (offset
-- discovery) are denied, which restarts the upload at byte 0 after the first
-- 6MB chunk (~12% of a ~50MB video).
--
-- Policies below are bucket-scoped for authenticated users. Inspection
-- authorization stays on the app's API routes (same model as the rest of
-- site inspections). The bucket stays private; downloads still use server
-- signed URLs.

drop policy if exists "No client read site inspection media" on storage.objects;
drop policy if exists "No client insert site inspection media" on storage.objects;
drop policy if exists "No client update site inspection media" on storage.objects;
drop policy if exists "No client delete site inspection media" on storage.objects;

drop policy if exists "Users can upload own site inspection media" on storage.objects;
create policy "Users can upload own site inspection media"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'site-inspection-media');

drop policy if exists "Users can update own site inspection media" on storage.objects;
create policy "Users can update own site inspection media"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'site-inspection-media')
  with check (bucket_id = 'site-inspection-media');

drop policy if exists "Users can read own site inspection media" on storage.objects;
create policy "Users can read own site inspection media"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'site-inspection-media');

drop policy if exists "Users can delete own site inspection media" on storage.objects;
create policy "Users can delete own site inspection media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'site-inspection-media');

comment on policy "Users can upload own site inspection media" on storage.objects is
  'Authenticated TUS and signed uploads anywhere in site-inspection-media. Shared team inspections; not scoped to the uploader.';
