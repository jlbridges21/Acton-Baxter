-- Cached Street View default cover for site inspections.
-- Fetched once per address (at create, and again if the address changes).
-- List cards read this path from storage; they do not call Google.

alter table public.site_inspections
  add column if not exists street_view_storage_path text,
  add column if not exists street_view_address text,
  add column if not exists street_view_status text,
  add column if not exists street_view_captured_on text;

alter table public.site_inspections
  drop constraint if exists site_inspections_street_view_status_check;

alter table public.site_inspections
  add constraint site_inspections_street_view_status_check
  check (
    street_view_status is null
    or street_view_status in ('available', 'unavailable')
  );
