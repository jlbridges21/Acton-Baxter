-- Prompt 2: live research metadata columns
-- Run after 001_initial_schema.sql

alter table public.reports
  add column if not exists attom_id text,
  add column if not exists rentcast_id text,
  add column if not exists fips text,
  add column if not exists mailing_locality text,
  add column if not exists zip_code text,
  add column if not exists property_profile_access_type text
    check (
      property_profile_access_type is null
      or property_profile_access_type in (
        'direct_report',
        'deep_link',
        'generic_search',
        'recreated_from_layers',
        'unavailable'
      )
    ),
  add column if not exists property_profile_url text,
  add column if not exists property_profile_status_message text,
  add column if not exists research_diagnostics_json jsonb;

create index if not exists reports_attom_id_idx on public.reports (attom_id);
create index if not exists reports_rentcast_id_idx on public.reports (rentcast_id);

alter table public.report_sources
  add column if not exists endpoint_name text,
  add column if not exists http_status integer;

alter table public.property_source_claims
  add column if not exists match_score double precision,
  add column if not exists is_preferred boolean default false;
