-- Video posters (first-frame JPEG captured on-device) + remux note for QuickTime.
alter table public.site_inspection_media
  add column if not exists poster_storage_path text;

comment on column public.site_inspection_media.poster_storage_path is
  'Optional JPEG poster for videos, captured on the recording device at upload time.';
