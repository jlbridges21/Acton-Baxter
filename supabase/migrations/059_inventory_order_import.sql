-- build.com PDF import: file hash for duplicate detection, private files, product photo paths.

alter table public.inventory_orders
  add column if not exists source_pdf_sha256 text;

create index if not exists inventory_orders_pdf_sha_idx
  on public.inventory_orders (source_pdf_sha256)
  where source_pdf_sha256 is not null and deleted_at is null;

comment on column public.inventory_orders.source_pdf_sha256 is
  'SHA-256 of the uploaded order PDF. Re-uploads of the same file are detected before another import.';

alter table public.inventory_items
  add column if not exists photo_storage_path text;

comment on column public.inventory_items.photo_storage_path is
  'Private inventory-order-files path for an extracted product photo. Null when the PDF had no usable image.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inventory-order-files',
  'inventory-order-files',
  false,
  26214400,
  array['application/pdf', 'image/png', 'image/jpeg']
)
on conflict (id) do nothing;

-- Client writes stay off. The app stores files with the service role.
create policy "No client reads of inventory order files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'inventory-order-files' and false);

create policy "No client inserts of inventory order files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'inventory-order-files' and false);

create policy "No client updates of inventory order files"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'inventory-order-files' and false);

create policy "No client deletes of inventory order files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'inventory-order-files' and false);

alter table public.report_jobs
  drop constraint if exists report_jobs_job_type_check;

alter table public.report_jobs
  add constraint report_jobs_job_type_check
  check (job_type in (
    'property_research',
    'slack_completion_notification',
    'google_knowledge_sync',
    'slack_baxter_reply',
    'baxter_monitor_sweep',
    'baxter_alert_delivery',
    'slack_monitoring_reaction',
    'pem_neat_generate',
    'project_setup',
    'knowledge_drive_ingest',
    'expense_jobs_sync',
    'site_inspection_ai',
    'site_inspection_pdf_export',
    'site_inspection_street_view_backfill',
    'inventory_order_import'
  ));
