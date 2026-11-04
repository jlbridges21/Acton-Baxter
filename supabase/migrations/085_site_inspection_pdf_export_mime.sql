-- Allow the generated PDF report to be stored in site-inspection-media.
--
-- Root cause of "Could not store inspection media (mime type application/pdf is
-- not supported)" on large inspections:
--
-- An inspection with more than PDF_INLINE_MEDIA_LIMIT (60) ready media files
-- takes the asynchronous export path. The background job builds the PDF and
-- then writes it to {inspectionId}/exports/site-inspection-report.pdf in the
-- site-inspection-media bucket, and the download poll reads it back from there.
--
-- The bucket's allowed_mime_types (047, last rewritten by 054) listed only
-- image and video types, so storage rejected application/pdf and the job
-- failed after building the PDF successfully.
--
-- The inline path (<= 60 media) wraps the same store in a catch and still
-- returns the bytes directly, which is why this only ever failed on large
-- inspections and went unnoticed until one with 112 photos.
--
-- Storing an export artifact in the media bucket is a category error worth
-- revisiting; adding the type it already writes is the minimal correct fix.

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  -- Generated export artifact written by site_inspection_pdf_export.
  'application/pdf'
]
where id = 'site-inspection-media';
