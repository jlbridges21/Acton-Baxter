-- Video uploads now use signed URLs (same path as photos) because TUS Authorization
-- is unreliable in this client (Invalid Compact JWS). Remove the bucket size cap so
-- field videos are not rejected after client size caps were removed.
-- Also reap orphaned pending/uploading media rows created at enqueue time before
-- bytes ever landed (phantom "Uploading 0%" on other devices).

update storage.buckets
set file_size_limit = null
where id = 'site-inspection-media';

delete from public.site_inspection_media
where upload_status in ('pending', 'uploading');
