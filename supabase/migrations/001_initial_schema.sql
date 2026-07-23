-- Acton Property Research — initial schema
-- Run this in the Supabase SQL Editor (or via supabase db push).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'salesperson'
    check (role in ('admin', 'salesperson')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1), ''),
    coalesce(new.raw_user_meta_data->>'role', 'salesperson')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id),
  input_address text not null,
  standardized_address text,
  status text not null default 'queued'
    check (status in ('queued', 'researching', 'complete', 'failed')),
  jurisdiction_name text,
  jurisdiction_type text,
  county text,
  state text,
  latitude double precision,
  longitude double precision,
  apn text,
  summary text,
  report_version text not null default '1.0.0',
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists reports_created_by_idx on public.reports (created_by);
create index if not exists reports_status_idx on public.reports (status);
create index if not exists reports_created_at_idx on public.reports (created_at desc);
create index if not exists reports_apn_idx on public.reports (apn);
create index if not exists reports_input_address_idx on public.reports using gin (
  to_tsvector('english', coalesce(input_address, '') || ' ' || coalesce(standardized_address, ''))
);

create trigger reports_set_updated_at
  before update on public.reports
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- property_facts
-- ---------------------------------------------------------------------------
create table if not exists public.property_facts (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  category text not null,
  field_key text not null,
  field_label text not null,
  normalized_value_text text,
  normalized_value_number double precision,
  normalized_value_boolean boolean,
  unit text,
  preferred_source_name text,
  preferred_source_url text,
  confidence text not null default 'unavailable'
    check (confidence in ('high', 'medium', 'low', 'unavailable')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (report_id, field_key)
);

create index if not exists property_facts_report_id_idx on public.property_facts (report_id);
create index if not exists property_facts_field_key_idx on public.property_facts (field_key);

create trigger property_facts_set_updated_at
  before update on public.property_facts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- property_source_claims
-- ---------------------------------------------------------------------------
create table if not exists public.property_source_claims (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  field_key text not null,
  source_name text not null,
  source_type text not null
    check (source_type in (
      'licensed_property_api',
      'city_gis',
      'county_gis',
      'state_government',
      'federal_government',
      'public_portal',
      'manual_link',
      'visual_observation',
      'mock'
    )),
  source_url text,
  source_record_id text,
  raw_value text,
  normalized_value text,
  match_method text not null
    check (match_method in (
      'address',
      'apn',
      'coordinate',
      'parcel_geometry',
      'manual',
      'mock'
    )),
  confidence text not null default 'medium'
    check (confidence in ('high', 'medium', 'low', 'unavailable')),
  retrieved_at timestamptz not null default timezone('utc', now()),
  source_updated_at timestamptz,
  raw_response_json jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists property_source_claims_report_id_idx
  on public.property_source_claims (report_id);
create index if not exists property_source_claims_field_key_idx
  on public.property_source_claims (report_id, field_key);

-- ---------------------------------------------------------------------------
-- report_conflicts
-- ---------------------------------------------------------------------------
create table if not exists public.report_conflicts (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  field_key text not null,
  field_label text not null,
  severity text not null
    check (severity in ('information', 'warning', 'critical')),
  description text not null,
  values_json jsonb not null default '[]'::jsonb,
  recommended_resolution text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists report_conflicts_report_id_idx on public.report_conflicts (report_id);

-- ---------------------------------------------------------------------------
-- report_sources
-- ---------------------------------------------------------------------------
create table if not exists public.report_sources (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  source_name text not null,
  source_type text not null
    check (source_type in (
      'licensed_property_api',
      'city_gis',
      'county_gis',
      'state_government',
      'federal_government',
      'public_portal',
      'manual_link',
      'visual_observation',
      'mock'
    )),
  source_url text,
  status text not null
    check (status in ('active', 'unavailable', 'error', 'stale', 'manual_review')),
  retrieved_at timestamptz,
  source_updated_at timestamptz,
  response_time_ms integer,
  status_message text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists report_sources_report_id_idx on public.report_sources (report_id);

-- ---------------------------------------------------------------------------
-- parcel_geometry
-- ---------------------------------------------------------------------------
create table if not exists public.parcel_geometry (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.reports (id) on delete cascade,
  geometry_geojson jsonb not null,
  centroid_latitude double precision,
  centroid_longitude double precision,
  calculated_area_sq_ft double precision,
  source_name text,
  source_url text,
  created_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- site_observations
-- ---------------------------------------------------------------------------
create table if not exists public.site_observations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  observation_type text not null,
  title text not null,
  description text not null,
  confidence text not null default 'low'
    check (confidence in ('high', 'medium', 'low', 'unavailable')),
  source_name text,
  source_url text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists site_observations_report_id_idx on public.site_observations (report_id);

-- ---------------------------------------------------------------------------
-- pem_preparations
-- ---------------------------------------------------------------------------
create table if not exists public.pem_preparations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.reports (id) on delete cascade,
  overview text not null,
  property_findings jsonb not null default '[]'::jsonb,
  property_questions jsonb not null default '[]'::jsonb,
  verify_during_pem jsonb not null default '[]'::jsonb,
  verify_during_feasibility jsonb not null default '[]'::jsonb,
  verify_through_title_or_survey jsonb not null default '[]'::jsonb,
  verify_with_planning jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger pem_preparations_set_updated_at
  before update on public.pem_preparations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- jurisdiction_connectors
-- ---------------------------------------------------------------------------
create table if not exists public.jurisdiction_connectors (
  id uuid primary key default gen_random_uuid(),
  connector_key text not null unique,
  name text not null,
  state text not null default 'CA',
  county text,
  cities jsonb not null default '[]'::jsonb,
  connector_type text not null,
  is_active boolean not null default true,
  configuration_json jsonb not null default '{}'::jsonb,
  last_validated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger jurisdiction_connectors_set_updated_at
  before update on public.jurisdiction_connectors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- connector_health_checks
-- ---------------------------------------------------------------------------
create table if not exists public.connector_health_checks (
  id uuid primary key default gen_random_uuid(),
  connector_key text not null,
  source_name text not null,
  endpoint_url text,
  status text not null
    check (status in ('active', 'unavailable', 'error', 'stale', 'manual_review')),
  response_time_ms integer,
  expected_schema_valid boolean,
  message text,
  checked_at timestamptz not null default timezone('utc', now())
);

create index if not exists connector_health_checks_connector_key_idx
  on public.connector_health_checks (connector_key);
create index if not exists connector_health_checks_checked_at_idx
  on public.connector_health_checks (checked_at desc);

-- Seed connectors (Phase 1 placeholders)
insert into public.jurisdiction_connectors (
  connector_key, name, state, county, cities, connector_type, is_active, configuration_json
) values
  (
    'ca-san-jose',
    'City of San Jose',
    'CA',
    'Santa Clara',
    '["San Jose"]'::jsonb,
    'city_gis',
    true,
    '{"phase":"mock"}'::jsonb
  ),
  (
    'ca-santa-clara-county',
    'Santa Clara County',
    'CA',
    'Santa Clara',
    '[]'::jsonb,
    'county_gis',
    true,
    '{"phase":"mock"}'::jsonb
  ),
  (
    'fallback',
    'California Fallback Links',
    'CA',
    null,
    '[]'::jsonb,
    'public_portal',
    true,
    '{"phase":"mock"}'::jsonb
  )
on conflict (connector_key) do nothing;

insert into public.connector_health_checks (
  connector_key, source_name, endpoint_url, status, response_time_ms,
  expected_schema_valid, message, checked_at
) values
  (
    'mock-attom',
    'ATTOM Property API',
    'https://api.gateway.attomdata.com/propertyapi/v1.0.0',
    'manual_review',
    null,
    false,
    'Mock mode: live ATTOM integration not enabled. Prompt 2 will connect this provider.',
    timezone('utc', now())
  ),
  (
    'mock-rentcast',
    'RentCast Property API',
    'https://api.rentcast.io/v1',
    'manual_review',
    null,
    false,
    'Mock mode: live RentCast integration not enabled. Prompt 2 will connect this provider.',
    timezone('utc', now())
  ),
  (
    'ca-san-jose',
    'San Jose ArcGIS Parcel Layer',
    'https://geo.sanjoseca.gov/server/rest/services',
    'stale',
    420,
    true,
    'Mock health check sample. Endpoint not called in Phase 1.',
    timezone('utc', now())
  ),
  (
    'ca-santa-clara-county',
    'Santa Clara County GIS / Property Profile',
    'https://www.sccassessor.org',
    'active',
    310,
    true,
    'Mock health check sample for county property profile links.',
    timezone('utc', now())
  ),
  (
    'fema',
    'FEMA Flood Map Service Center',
    'https://msc.fema.gov/portal/search',
    'active',
    280,
    true,
    'Mock health check. Live FEMA lookups arrive in Prompt 2.',
    timezone('utc', now())
  ),
  (
    'ca-fire',
    'CAL FIRE Fire Hazard Severity Zones',
    'https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones',
    'unavailable',
    null,
    false,
    'Mock unavailable optional source for Phase 1 demonstrations.',
    timezone('utc', now())
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.property_facts enable row level security;
alter table public.property_source_claims enable row level security;
alter table public.report_conflicts enable row level security;
alter table public.report_sources enable row level security;
alter table public.parcel_geometry enable row level security;
alter table public.site_observations enable row level security;
alter table public.pem_preparations enable row level security;
alter table public.jurisdiction_connectors enable row level security;
alter table public.connector_health_checks enable row level security;

-- Helper: current user is admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- profiles
create policy "Users can view all profiles"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- reports: authenticated users may create; any authenticated Acton user may view
create policy "Authenticated users can create reports"
  on public.reports for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "Authenticated users can view reports"
  on public.reports for select
  to authenticated
  using (true);

create policy "Creators can update own queued/researching/failed reports"
  on public.reports for update
  to authenticated
  using (
    auth.uid() = created_by
    and status in ('queued', 'researching', 'failed')
  )
  with check (auth.uid() = created_by);

-- Child research tables: read for authenticated users; no direct browser writes of facts
create policy "Authenticated users can view property facts"
  on public.property_facts for select to authenticated using (true);

create policy "Authenticated users can view source claims"
  on public.property_source_claims for select to authenticated using (true);

create policy "Authenticated users can view conflicts"
  on public.report_conflicts for select to authenticated using (true);

create policy "Authenticated users can view report sources"
  on public.report_sources for select to authenticated using (true);

create policy "Authenticated users can view parcel geometry"
  on public.parcel_geometry for select to authenticated using (true);

create policy "Authenticated users can view site observations"
  on public.site_observations for select to authenticated using (true);

create policy "Authenticated users can view pem preparations"
  on public.pem_preparations for select to authenticated using (true);

create policy "Authenticated users can view connectors"
  on public.jurisdiction_connectors for select to authenticated using (true);

-- Admins may view source-health information
create policy "Admins can view connector health"
  on public.connector_health_checks for select
  to authenticated
  using (public.is_admin());

create policy "Admins can view connectors fully"
  on public.jurisdiction_connectors for select
  to authenticated
  using (true);

-- Note: service-role key bypasses RLS for server-side research inserts/updates.
-- Browser clients must not hold the service role key.
