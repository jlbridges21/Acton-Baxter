-- Site inspection media pipeline: client media ids + authenticated direct-to-storage uploads.

alter table public.site_inspection_media
  add column if not exists client_media_id uuid;

alter table public.site_inspection_media
  add column if not exists upload_progress real
    check (upload_progress is null or (upload_progress >= 0 and upload_progress <= 1));

create unique index if not exists site_inspection_media_client_id_uidx
  on public.site_inspection_media (inspection_id, client_media_id)
  where client_media_id is not null;

comment on column public.site_inspection_media.client_media_id is
  'Client-generated id for optimistic UI reconciliation with the persistent upload queue.';
comment on column public.site_inspection_media.upload_progress is
  '0..1 progress while uploading (especially video). Null when idle/ready/failed.';

-- Allow authenticated users to upload/update objects under {auth.uid()}/… in the
-- site-inspection-media bucket (direct signed + TUS uploads). Reads still via signed URLs.
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
