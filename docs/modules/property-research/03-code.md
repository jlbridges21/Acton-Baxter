# Property Research Tool — Code Reference

Acton ADU · Baxter module documentation · Generated from the repository

---

## How to use this document

This is the copy-and-paste companion to the [Specification](./02-specification.md). It contains the complete inventory of every file in the module, and the verbatim text of the artifacts that cannot be reconstructed from the specification alone.

Reproduced in full here:

1. **The core migration** — the schema the whole claims-and-facts model rests on.
2. **Constants** — field keys, source types, thresholds, and the mandatory caveats.
3. **Fact selection** — the source weights and per-field bonuses. This is the module's actual intelligence.
4. **Hazard and hydrant endpoint configuration** — including the comments recording what was verified live and what the service descriptions got wrong. **This is the hardest knowledge in the module to recover.**
5. **The buildable envelope** — the geometry and the disclaimers that must travel with it.

Everything else is listed with its path, size, and responsibility.

---

## Dependencies

| Package                                       | Used for                                        |
| --------------------------------------------- | ----------------------------------------------- |
| `@turf/area`, `@turf/buffer`, `@turf/helpers` | Buildable envelope geometry                     |
| `zod`                                         | Provider response validation and report schemas |
| `@supabase/supabase-js`                       | Database                                        |
| `@react-pdf/renderer`                         | Report PDF                                      |
| OpenAI / Anthropic SDKs                       | The report narrative                            |

External services: **RentCast** (primary property data), **ATTOM** (optional), **Google** (geocoding, Places, Static Maps), **FEMA NFHL**, **CAL FIRE FHSZ and WUI**, **Santa Clara County and San Jose ArcGIS**, **Santa Clara city and Campbell hydrant layers**, **OpenStreetMap Overpass**.

Internal Baxter modules: `@/lib/auth/session`, `@/lib/errors`, `@/lib/jobs/*`, `@/lib/env`, `@/lib/arcgis/query`, `@/lib/jurisdictions/*`, `@/lib/property/normalize`, `@/lib/connectors/*`.

---

## File manifest

### Core module — `src/lib/research/`

| File                         | Lines | Responsibility                                                                                                                           |
| ---------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `mock-research-provider.ts`  | 912   | The fabricated report returned when ENABLE_MOCK_RESEARCH is on. See Specification gap 3.                                                 |
| `report-store.ts`            | 819   | Persistence: reports, facts, claims, conflicts, sources, geometry, observations, PEM preparation. Clearing research children on refresh. |
| `buildable-envelope.ts`      | 346   | Parcel inset by setbacks via Turf, with the disclaimers and the three degenerate-case messages. Reproduced verbatim below.               |
| `schemas.ts`                 | 307   | Zod schemas for the normalized research result and every child record.                                                                   |
| `report-view-model.ts`       | 241   | Shapes stored records into what the report UI renders.                                                                                   |
| `conflict-detector.ts`       | 229   | Threshold-based disagreement detection across claims, with canonical APN comparison.                                                     |
| `db-types.ts`                | 205   | Database row types.                                                                                                                      |
| `select-preferred-fact.ts`   | 194   | Source-type weights and per-field bonuses. The module's actual intelligence. Reproduced verbatim below.                                  |
| `source-health.ts`           | 177   | Connector health checks and caching for the admin diagnostics surface.                                                                   |
| `site-inspection.ts`         | 165   | Site-inspection-required determination from the research result.                                                                         |
| `fire-access.ts`             | 127   | Hydrant distance presentation with the path-of-travel caveat.                                                                            |
| `run-property-research.ts`   | 122   | Orchestration, status transitions, retry, refresh. Contains the in-memory progress timer — see Specification gap 2 and gap 5.            |
| `types.ts`                   | 95    | Lookup inputs, claim inputs, source and match vocabularies.                                                                              |
| `constants.ts`               | 91    | Field keys, statuses, source types, conflict thresholds, and the mandatory WUI caveat. Reproduced verbatim below.                        |
| `normalize-address.ts`       | 85    | Address normalisation and standardisation.                                                                                               |
| `provider-comparison.ts`     | 80    | Side-by-side provider comparison for diagnostics.                                                                                        |
| `enqueue.ts`                 | 73    | Enqueues the research job on the durable queue.                                                                                          |
| `create-property-report.ts`  | 72    | Report creation entry point.                                                                                                             |
| `stale-recovery.ts`          | 63    | Recovers reports stuck in a non-terminal state.                                                                                          |
| `load-buildable-envelope.ts` | 43    | Loads geometry and rules, then computes the envelope.                                                                                    |
| `report-summarizer.ts`       | 35    | Short summary composition.                                                                                                               |

| `live/run-live-property-research.ts` | 1394 | The live pipeline. Queries every provider, builds claims, selects facts, detects conflicts, assembles the result. |

### Providers — `src/lib/providers/`

| Path                                  | Responsibility                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `provider-registry.ts`                | Wires hazard, permit, imagery, and AI providers; selects the jurisdiction connector |
| `property-provider.interface.ts`      | Contract every property data provider implements                                    |
| `hazard-provider.interface.ts`        | Contract for hazard lookups                                                         |
| `imagery-provider.interface.ts`       | Contract for imagery                                                                |
| `permit-provider.interface.ts`        | Contract for permit lookups                                                         |
| `ai-report-provider.interface.ts`     | Contract for the narrative                                                          |
| `jurisdiction-connector.interface.ts` | Contract every jurisdiction connector implements                                    |
| `rentcast/`                           | **Primary** property data: client, schemas, normalizer, provider, errors            |
| `attom/`                              | **Optional** property data: client, config, schemas, normalizer, provider, errors   |
| `hazards/`                            | FEMA flood, CAL FIRE FHSZ (SRA and LRA), CAL FIRE WUI, descriptions, lookup, config |
| `hydrants/`                           | SCFD, Campbell, OpenStreetMap Overpass sources, distance maths, lookup, config      |
| `google/`                             | Imagery and parcel overlay                                                          |
| `ai/`                                 | Anthropic, OpenAI, and deterministic providers, prompts, schemas, sanitisation      |

### Jurisdiction connectors — `src/lib/connectors/`

| Path                             | Responsibility                                                              |
| -------------------------------- | --------------------------------------------------------------------------- |
| `california/registry.ts`         | Selects city, then county, then fallback                                    |
| `california/san-jose/`           | Connector, config, normalizers — parcels, zoning, general plan              |
| `california/santa-clara-county/` | Connector, config, normalizers, assessor property-profile access resolution |
| `fallback/connector.ts`          | Generic links for everywhere else                                           |

### Jurisdiction rules — `src/lib/jurisdictions/`

| File                                            | Responsibility                              |
| ----------------------------------------------- | ------------------------------------------- |
| `rules-store.ts`                                | Reads admin-maintained rules                |
| `select-rules.ts`                               | Zone-specific rules with a general fallback |
| `rule-keys.ts`, `keys.ts`                       | Rule and jurisdiction vocabularies          |
| `code-highlights.ts`                            | ADU code highlights for the report          |
| `supported.ts`                                  | Which jurisdictions have rules              |
| `schemas.ts`, `types.ts`, `chat.ts`, `index.ts` | Shapes and Baxter chat integration          |

### API routes — `src/app/api/`

| Route                                 | Methods     | Responsibility                    |
| ------------------------------------- | ----------- | --------------------------------- |
| `reports/route.ts`                    | GET, POST   | List; create and enqueue research |
| `reports/[reportId]/route.ts`         | GET, DELETE | Fetch the full report; delete     |
| `reports/[reportId]/run/route.ts`     | POST        | Run research                      |
| `reports/[reportId]/status/route.ts`  | GET         | Progress poll                     |
| `reports/[reportId]/retry/route.ts`   | POST        | Retry a failed report             |
| `reports/[reportId]/refresh/route.ts` | POST        | Re-run against the same address   |
| `reports/[reportId]/imagery/route.ts` | GET         | Imagery                           |
| `slack/commands/property/route.ts`    | POST        | The `/property` Slack command     |

### Pages — `src/app/property-research/`

| Page                             | Responsibility                        |
| -------------------------------- | ------------------------------------- |
| `page.tsx`                       | Report history                        |
| `new/page.tsx`                   | New report, with address autocomplete |
| `[reportId]/page.tsx`            | The report                            |
| `[reportId]/processing/page.tsx` | Progress while researching            |

### Components — `src/components/reports/`

| Component                       | Lines | Responsibility                                  |
| ------------------------------- | ----- | ----------------------------------------------- |
| `parcel-and-public-records.tsx` | 341   | Parcel identity, APN, public record links       |
| `new-report-form.tsx`           | 257   | Address entry and autocomplete                  |
| `adu-code-highlights.tsx`       | 227   | Applicable ADU rules with citations             |
| `processing-client.tsx`         | 164   | Stage display — see Specification gap 2         |
| `report-section.tsx`            | 150   | Section shell                                   |
| `report-diagnostics.tsx`        | 139   | Provider diagnostics                            |
| `property-overview.tsx`         | 133   | Characteristics                                 |
| `report-history-client.tsx`     | 131   | History list                                    |
| `sources-section.tsx`           | 121   | Every source queried and its status             |
| `property-imagery.tsx`          | 119   | Aerial and street imagery                       |
| `report-document.tsx`           | 112   | Print and PDF document                          |
| `report-section-nav.tsx`        | 110   | In-report navigation                            |
| `planning-and-hazards.tsx`      | 108   | Zoning, general plan, flood, fire, WUI          |
| `site-inspection-required.tsx`  | 104   | What must be verified on site                   |
| `report-header.tsx`             | 102   | Address, jurisdiction, status                   |
| `fire-access.tsx`               | 97    | Hydrant distance with the path-of-travel caveat |
| `jurisdiction-report-card.tsx`  | 86    | Jurisdiction connector output                   |
| `report-summary-chips.tsx`      | 69    | At-a-glance facts                               |
| `important-inconsistencies.tsx` | 64    | Conflicts between sources                       |
| `pem-preparation.tsx`           | 59    | PEM-facing preparation                          |
| `report-toolbar.tsx`            | 42    | Actions                                         |
| `refresh-research-button.tsx`   | 41    | Refresh                                         |
| `site-observations.tsx`         | 35    | Recorded observations                           |
| `research-summary.tsx`          | 21    | The AI narrative                                |

---

## Migrations

Apply 001, 002, 003, then 041. Migration numbers are global across Baxter.

### `001_initial_schema.sql`

Creates the shared `profiles` table alongside this module's tables — the two are intertwined because this was Baxter's first module.

```sql
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
```

### `002_live_research_metadata.sql`

Provider identifiers, property-profile access, research diagnostics, claim match scores.

```sql
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
```

### `003_prompt3_production.sql`

Structured address, normalized APN, refresh lineage, AI generation metadata.

```sql
-- Prompt 3: address metadata, APN normalization, AI metadata, branding, Slack, jobs

-- Reports: structured address + refresh + AI metadata + normalized APN
alter table public.reports
  add column if not exists google_place_id text,
  add column if not exists address_line_1 text,
  add column if not exists country_code text,
  add column if not exists normalized_apn text,
  add column if not exists parent_report_id uuid references public.reports(id) on delete set null,
  add column if not exists refresh_reason text,
  add column if not exists ai_provider text,
  add column if not exists ai_model text,
  add column if not exists ai_generation_status text
    check (
      ai_generation_status is null
      or ai_generation_status in ('success', 'fallback', 'skipped', 'error')
    ),
  add column if not exists ai_prompt_version text,
  add column if not exists ai_generated_at timestamptz,
  add column if not exists ai_input_hash text;

create index if not exists reports_normalized_apn_idx on public.reports (normalized_apn);
create index if not exists reports_parent_report_id_idx on public.reports (parent_report_id);
create index if not exists reports_google_place_id_idx on public.reports (google_place_id);

update public.reports
set normalized_apn = upper(regexp_replace(coalesce(apn, ''), '[^A-Za-z0-9]', '', 'g'))
where apn is not null
  and (normalized_apn is null or normalized_apn = '');

-- Branding settings (singleton)
create table if not exists public.branding_settings (
  id uuid primary key default gen_random_uuid(),
  company_name text not null default 'Acton ADU',
  report_title text not null default 'Acton Property Research',
  logo_storage_path text,
  logo_alt_text text not null default 'Acton ADU logo',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  singleton_key boolean not null default true,
  constraint branding_settings_singleton unique (singleton_key)
);

insert into public.branding_settings (company_name, report_title, logo_alt_text, singleton_key)
values ('Acton ADU', 'Acton Property Research', 'Acton ADU logo', true)
on conflict (singleton_key) do nothing;

alter table public.branding_settings enable row level security;

drop policy if exists "Authenticated users can read branding" on public.branding_settings;
create policy "Authenticated users can read branding"
  on public.branding_settings
  for select
  to authenticated
  using (true);

drop policy if exists "Admins can update branding" on public.branding_settings;
create policy "Admins can update branding"
  on public.branding_settings
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "Admins can insert branding" on public.branding_settings;
create policy "Admins can insert branding"
  on public.branding_settings
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Slack user mappings
create table if not exists public.slack_user_mappings (
  id uuid primary key default gen_random_uuid(),
  slack_team_id text not null,
  slack_user_id text not null,
  app_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (slack_team_id, slack_user_id)
);

alter table public.slack_user_mappings enable row level security;

drop policy if exists "Admins can manage slack mappings" on public.slack_user_mappings;
create policy "Admins can manage slack mappings"
  on public.slack_user_mappings
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Durable background jobs
create table if not exists public.report_jobs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.reports(id) on delete cascade,
  job_type text not null
    check (job_type in ('property_research', 'slack_completion_notification')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists report_jobs_status_available_idx
  on public.report_jobs (status, available_at);
create index if not exists report_jobs_report_id_idx
  on public.report_jobs (report_id);

alter table public.report_jobs enable row level security;
-- Service role only for jobs (no authenticated policies)

-- Provider call logs for admin diagnostics
create table if not exists public.provider_call_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  endpoint_name text,
  report_id uuid references public.reports(id) on delete set null,
  success boolean not null default false,
  http_status integer,
  response_time_ms integer,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists provider_call_logs_provider_created_idx
  on public.provider_call_logs (provider, created_at desc);
create index if not exists provider_call_logs_report_id_idx
  on public.provider_call_logs (report_id);

alter table public.provider_call_logs enable row level security;

drop policy if exists "Admins can read provider logs" on public.provider_call_logs;
create policy "Admins can read provider logs"
  on public.provider_call_logs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
```

### `041_jurisdiction_building_codes.sql`

Jurisdiction-scoped knowledge entries and the citation-required `jurisdiction_rules` table the buildable envelope reads from.

```sql
-- Jurisdiction-aware building-code layer:
-- 1) First-class jurisdiction + doc_kind on knowledge_entries
-- 2) Admin-maintained structured jurisdiction_rules (required source citations)
--
-- Jurisdiction keys align with connector keys (ca-san-jose, ca-santa-clara-county).
-- Rule keys are application vocabulary (no DB enum) so they stay extensible without migrations.

-- ---------------------------------------------------------------------------
-- knowledge_entries: jurisdiction association + document kind
-- ---------------------------------------------------------------------------
-- One entry → one jurisdiction. Statewide / unscoped docs keep jurisdiction_key null.
-- Multi-jurisdiction reuse is rare for municipal codes; duplicate or leave unscoped.

alter table public.knowledge_entries
  add column if not exists jurisdiction_key text,
  add column if not exists doc_kind text;

alter table public.knowledge_entries
  drop constraint if exists knowledge_entries_doc_kind_check;

alter table public.knowledge_entries
  add constraint knowledge_entries_doc_kind_check
  check (
    doc_kind is null
    or doc_kind in ('building_code', 'ordinance', 'design_guideline', 'other_code')
  );

create index if not exists knowledge_entries_jurisdiction_key_idx
  on public.knowledge_entries (jurisdiction_key)
  where jurisdiction_key is not null;

create index if not exists knowledge_entries_doc_kind_idx
  on public.knowledge_entries (doc_kind)
  where doc_kind is not null;

create index if not exists knowledge_entries_jurisdiction_doc_kind_idx
  on public.knowledge_entries (jurisdiction_key, doc_kind)
  where jurisdiction_key is not null and doc_kind is not null;

comment on column public.knowledge_entries.jurisdiction_key is
  'Connector-aligned jurisdiction key (e.g. ca-san-jose). Null = not jurisdiction-scoped.';
comment on column public.knowledge_entries.doc_kind is
  'building_code | ordinance | design_guideline | other_code — marks code/ordinance documents for ADU research.';

-- ---------------------------------------------------------------------------
-- jurisdiction_rules: structured, citation-required admin values
-- ---------------------------------------------------------------------------
create table if not exists public.jurisdiction_rules (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_key text not null,
  rule_key text not null,
  zone_key text,
  value_json jsonb not null default '{}'::jsonb,
  source_citation text not null,
  source_knowledge_entry_id uuid references public.knowledge_entries (id) on delete set null,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint jurisdiction_rules_jurisdiction_key_format
    check (jurisdiction_key ~ '^[a-z][a-z0-9-]*$'),
  constraint jurisdiction_rules_rule_key_format
    check (rule_key ~ '^[a-z][a-z0-9_]*$'),
  constraint jurisdiction_rules_source_citation_required
    check (length(trim(source_citation)) > 0),
  constraint jurisdiction_rules_zone_key_format
    check (zone_key is null or length(trim(zone_key)) > 0)
);

-- Nullable zone_key: treat null as jurisdiction-general via coalesce in unique index.
create unique index if not exists jurisdiction_rules_unique_idx
  on public.jurisdiction_rules (jurisdiction_key, rule_key, (coalesce(zone_key, '')));

create index if not exists jurisdiction_rules_jurisdiction_idx
  on public.jurisdiction_rules (jurisdiction_key);

create index if not exists jurisdiction_rules_rule_key_idx
  on public.jurisdiction_rules (rule_key);

create index if not exists jurisdiction_rules_source_entry_idx
  on public.jurisdiction_rules (source_knowledge_entry_id)
  where source_knowledge_entry_id is not null;

create trigger jurisdiction_rules_set_updated_at
  before update on public.jurisdiction_rules
  for each row execute function public.set_updated_at();

comment on table public.jurisdiction_rules is
  'Admin-maintained structured ADU/building-code rule values. source_citation is required. Rule keys are app vocabulary.';
comment on column public.jurisdiction_rules.zone_key is
  'Optional zoning designation for zone-specific rules (e.g. setbacks). Null = jurisdiction-general.';
comment on column public.jurisdiction_rules.value_json is
  'Structured value: {kind:"quantity",value,unit} or {kind:"structured",fields:{...}}.';
comment on column public.jurisdiction_rules.source_citation is
  'Required human citation, e.g. "SJMC 20.30.150(b)".';

alter table public.jurisdiction_rules enable row level security;

create policy "Admins can read jurisdiction rules"
  on public.jurisdiction_rules for select to authenticated
  using (public.is_admin());

-- Authenticated employees may read rules for report/chat surfaces (writes via service role).
create policy "Authenticated can read jurisdiction rules"
  on public.jurisdiction_rules for select to authenticated
  using (true);

create policy "No client insert jurisdiction rules"
  on public.jurisdiction_rules for insert to authenticated with check (false);
create policy "No client update jurisdiction rules"
  on public.jurisdiction_rules for update to authenticated using (false);
create policy "No client delete jurisdiction rules"
  on public.jurisdiction_rules for delete to authenticated using (false);
```

---

## Domain constants

Field keys, statuses, source types, match methods, the six progress stages, the conflict thresholds, and the two mandatory caveats. The vocabulary everything else speaks.

From `src/lib/research/constants.ts`.

```typescript
export const REPORT_STATUSES = ["queued", "researching", "complete", "failed"] as const;
export const USER_ROLES = ["new_user", "user", "admin", "super_admin"] as const;
export const CONFIDENCE_LEVELS = ["high", "medium", "low", "unavailable"] as const;
export const CONFLICT_SEVERITIES = ["information", "warning", "critical"] as const;
export const SOURCE_TYPES = [
  "licensed_property_api",
  "city_gis",
  "county_gis",
  "state_government",
  "federal_government",
  "public_portal",
  "manual_link",
  "visual_observation",
  "mock",
] as const;
export const MATCH_METHODS = [
  "address",
  "apn",
  "coordinate",
  "parcel_geometry",
  "manual",
  "mock",
] as const;
export const SOURCE_STATUSES = [
  "active",
  "unavailable",
  "error",
  "stale",
  "manual_review",
] as const;

export const RESEARCH_STAGES = [
  "Confirming property address",
  "Identifying parcel and APN",
  "Retrieving property characteristics",
  "Checking city and county GIS",
  "Comparing sources",
  "Preparing PEM research report",
] as const;

export const REPORT_VERSION = "1.0.0";

export const MOCK_REFERENCE_ADDRESS = "655 13th St, San Jose, CA";

export const FIELD_KEYS = {
  apn: "apn",
  lotSqFt: "lot_sq_ft",
  livingAreaSqFt: "living_area_sq_ft",
  bedrooms: "bedrooms",
  bathrooms: "bathrooms",
  stories: "stories",
  yearBuilt: "year_built",
  propertyType: "property_type",
  estimatedValue: "estimated_value",
  assessedValue: "assessed_value",
  lastSaleDate: "last_sale_date",
  lastSalePrice: "last_sale_price",
  ownerName: "owner_name",
  ownerMailingAddress: "owner_mailing_address",
  subdivision: "subdivision",
  tractNumber: "tract_number",
  zoning: "zoning",
  generalPlan: "general_plan",
  historicStatus: "historic_status",
  floodZone: "flood_zone",
  fireZone: "fire_zone",
  wuiClassification: "wui_classification",
  nearestHydrantDistanceFt: "nearest_hydrant_distance_ft",
  latitude: "latitude",
  longitude: "longitude",
  taxRateArea: "tax_rate_area",
  buildingCount: "building_count",
  foundationType: "foundation_type",
} as const;

/** UI qualifier when ATTOM provides foundation type (assessor-derived, incomplete). */
export const FOUNDATION_TYPE_VERIFY_NOTE = "Assessor-derived — verify on site during feasibility.";

/**
 * Mandatory WUI caveat — FRAP documents this as a screen-level relative-risk
 * indicator, not a parcel-level designation. Must appear whenever WUI is shown.
 */
export const WUI_CAVEAT =
  "screen-level indicator — verify parcel-specific WUI status with the local jurisdiction";

export const CONFLICT_THRESHOLDS = {
  lotSizePercent: 3,
  livingAreaPercent: 5,
  yearBuiltYears: 2,
  valueEstimatePercent: 20,
} as const;
```

---

## Fact selection

Source-type weights and per-field bonuses. **This is the module's actual intelligence** — the encoded knowledge of which source is right about what. Preserve this above the code around it.

From `src/lib/research/select-preferred-fact.ts`.

```typescript
import type { Confidence, SourceType } from "@/lib/research/types";
import type { PropertyFact, SourceClaim } from "@/lib/research/schemas";
import { FIELD_KEYS } from "@/lib/research/constants";

/**
 * Deterministic preferred-source priorities by field.
 * Higher score wins. Official GIS outranks licensed APIs for jurisdiction facts.
 */
const SOURCE_TYPE_WEIGHT: Record<SourceType, number> = {
  city_gis: 100,
  county_gis: 95,
  licensed_property_api: 70,
  state_government: 60,
  federal_government: 55,
  public_portal: 40,
  manual_link: 20,
  visual_observation: 10,
  mock: 0,
};

const FIELD_SOURCE_BONUS: Record<string, Record<string, number>> = {
  [FIELD_KEYS.apn]: {
    "Santa Clara County Parcels (ArcGIS)": 30,
    "San Jose ArcGIS Parcels": 25,
    ATTOM: 15,
  },
  [FIELD_KEYS.lotSqFt]: {
    "Santa Clara County Parcels (ArcGIS)": 30,
    "San Jose ArcGIS Parcels": 20,
    ATTOM: 15,
    RentCast: 5,
  },
  [FIELD_KEYS.livingAreaSqFt]: {
    ATTOM: 25,
    RentCast: 10,
  },
  [FIELD_KEYS.bedrooms]: {
    ATTOM: 25,
    RentCast: 10,
  },
  [FIELD_KEYS.bathrooms]: {
    ATTOM: 25,
    RentCast: 10,
  },
  [FIELD_KEYS.estimatedValue]: {
    ATTOM: 30,
    RentCast: 5,
  },
  [FIELD_KEYS.zoning]: {
    "San Jose ArcGIS Zoning": 40,
  },
  [FIELD_KEYS.generalPlan]: {
    "San Jose ArcGIS General Plan 2040": 40,
  },
};

const FIELD_LABELS: Record<string, string> = {
  [FIELD_KEYS.apn]: "APN",
  [FIELD_KEYS.lotSqFt]: "Lot size",
  [FIELD_KEYS.livingAreaSqFt]: "Living area",
  [FIELD_KEYS.bedrooms]: "Bedrooms",
  [FIELD_KEYS.bathrooms]: "Bathrooms",
  [FIELD_KEYS.stories]: "Stories",
  [FIELD_KEYS.yearBuilt]: "Year built",
  [FIELD_KEYS.propertyType]: "Property type",
  [FIELD_KEYS.estimatedValue]: "Estimated value",
  [FIELD_KEYS.assessedValue]: "Assessed value",
  [FIELD_KEYS.lastSaleDate]: "Last sale date",
  [FIELD_KEYS.lastSalePrice]: "Last sale price",
  [FIELD_KEYS.ownerName]: "Owner name",
  [FIELD_KEYS.ownerMailingAddress]: "Owner mailing address",
  [FIELD_KEYS.subdivision]: "Subdivision",
  [FIELD_KEYS.tractNumber]: "Tract number",
  [FIELD_KEYS.zoning]: "Zoning",
  [FIELD_KEYS.generalPlan]: "General Plan",
  [FIELD_KEYS.historicStatus]: "Historic status",
  [FIELD_KEYS.floodZone]: "Flood zone",
  [FIELD_KEYS.fireZone]: "Fire zone",
  [FIELD_KEYS.wuiClassification]: "Wildland-Urban Interface (WUI)",
  [FIELD_KEYS.nearestHydrantDistanceFt]: "Nearest mapped hydrant (straight-line)",
  [FIELD_KEYS.latitude]: "Latitude",
  [FIELD_KEYS.longitude]: "Longitude",
  [FIELD_KEYS.taxRateArea]: "Tax rate area",
  [FIELD_KEYS.buildingCount]: "Building count",
  [FIELD_KEYS.foundationType]: "Foundation type",
};

function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreClaim(fieldKey: string, claim: SourceClaim): number {
  let score = SOURCE_TYPE_WEIGHT[claim.sourceType] ?? 0;
  score += FIELD_SOURCE_BONUS[fieldKey]?.[claim.sourceName] ?? 0;
  if (claim.matchMethod === "apn" || claim.matchMethod === "parcel_geometry") score += 8;
  if (claim.matchMethod === "address") score += 5;
  if (claim.matchMethod === "coordinate") score += 3;
  if (claim.confidence === "high") score += 5;
  if (claim.confidence === "medium") score += 2;
  if (claim.confidence === "low") score -= 2;
  if (claim.confidence === "unavailable") score -= 50;
  if (!claim.normalizedValue) score -= 100;
  return score;
}

export function selectPreferredClaim(fieldKey: string, claims: SourceClaim[]): SourceClaim | null {
  const candidates = claims.filter((claim) => claim.fieldKey === fieldKey && claim.normalizedValue);
  if (candidates.length === 0) return null;
  return (
    [...candidates].sort((a, b) => scoreClaim(fieldKey, b) - scoreClaim(fieldKey, a))[0] ?? null
  );
}

export function selectPreferredFact(
  fieldKey: string,
  claims: SourceClaim[],
  options?: {
    category?: string;
    unit?: string | null;
  },
): PropertyFact | null {
  const preferred = selectPreferredClaim(fieldKey, claims);
  if (!preferred?.normalizedValue) return null;

  const numericFields = new Set<string>([
    FIELD_KEYS.lotSqFt,
    FIELD_KEYS.livingAreaSqFt,
    FIELD_KEYS.bedrooms,
    FIELD_KEYS.bathrooms,
    FIELD_KEYS.stories,
    FIELD_KEYS.yearBuilt,
    FIELD_KEYS.estimatedValue,
    FIELD_KEYS.assessedValue,
    FIELD_KEYS.lastSalePrice,
    FIELD_KEYS.latitude,
    FIELD_KEYS.longitude,
    FIELD_KEYS.buildingCount,
    FIELD_KEYS.nearestHydrantDistanceFt,
  ]);

  const numberValue = numericFields.has(fieldKey) ? parseNumber(preferred.normalizedValue) : null;

  return {
    category: options?.category ?? "characteristics",
    fieldKey,
    fieldLabel: FIELD_LABELS[fieldKey] ?? fieldKey,
    normalizedValueText: preferred.normalizedValue,
    normalizedValueNumber: numberValue,
    normalizedValueBoolean: null,
    unit: options?.unit ?? null,
    preferredSourceName: preferred.sourceName,
    preferredSourceUrl: preferred.sourceUrl ?? null,
    confidence: preferred.confidence as Confidence,
  };
}

export function buildPreferredFacts(claims: SourceClaim[]): PropertyFact[] {
  const specs: Array<{ fieldKey: string; category: string; unit?: string | null }> = [
    { fieldKey: FIELD_KEYS.apn, category: "identity" },
    { fieldKey: FIELD_KEYS.lotSqFt, category: "characteristics", unit: "sq ft" },
    { fieldKey: FIELD_KEYS.livingAreaSqFt, category: "characteristics", unit: "sq ft" },
    { fieldKey: FIELD_KEYS.bedrooms, category: "characteristics" },
    { fieldKey: FIELD_KEYS.bathrooms, category: "characteristics" },
    { fieldKey: FIELD_KEYS.stories, category: "characteristics" },
    { fieldKey: FIELD_KEYS.yearBuilt, category: "characteristics" },
    { fieldKey: FIELD_KEYS.propertyType, category: "characteristics" },
    { fieldKey: FIELD_KEYS.estimatedValue, category: "characteristics", unit: "USD" },
    { fieldKey: FIELD_KEYS.assessedValue, category: "characteristics", unit: "USD" },
    { fieldKey: FIELD_KEYS.lastSaleDate, category: "characteristics" },
    { fieldKey: FIELD_KEYS.lastSalePrice, category: "characteristics", unit: "USD" },
    { fieldKey: FIELD_KEYS.ownerName, category: "characteristics" },
    { fieldKey: FIELD_KEYS.ownerMailingAddress, category: "characteristics" },
    { fieldKey: FIELD_KEYS.subdivision, category: "characteristics" },
    { fieldKey: FIELD_KEYS.tractNumber, category: "characteristics" },
    { fieldKey: FIELD_KEYS.taxRateArea, category: "characteristics" },
    { fieldKey: FIELD_KEYS.buildingCount, category: "characteristics" },
    { fieldKey: FIELD_KEYS.foundationType, category: "characteristics" },
    { fieldKey: FIELD_KEYS.zoning, category: "planning" },
    { fieldKey: FIELD_KEYS.generalPlan, category: "planning" },
    { fieldKey: FIELD_KEYS.historicStatus, category: "planning" },
    { fieldKey: FIELD_KEYS.floodZone, category: "planning" },
    { fieldKey: FIELD_KEYS.fireZone, category: "planning" },
    { fieldKey: FIELD_KEYS.wuiClassification, category: "planning" },
    { fieldKey: FIELD_KEYS.nearestHydrantDistanceFt, category: "planning", unit: "ft" },
    { fieldKey: FIELD_KEYS.latitude, category: "identity" },
    { fieldKey: FIELD_KEYS.longitude, category: "identity" },
  ];

  return specs
    .map((spec) => selectPreferredFact(spec.fieldKey, claims, spec))
    .filter((fact): fact is PropertyFact => fact !== null);
}
```

---

## Hazard endpoints

Verified-live endpoint URLs with the comments recording what was checked, which official endpoints are 404 or token-gated, and the effective dates of each hazard map.

From `src/lib/providers/hazards/config.ts`.

```typescript
/**
 * Public hazard GIS endpoints used by Property Research.
 *
 * Verified live (point-in-polygon) before wiring:
 * - FEMA NFHL Flood Hazard Zones = MapServer layer 28 (FLD_ZONE, ZONE_SUBTY, SFHA_TF, …)
 * - CAL FIRE SRA FHSZ = FHSZSRA_23_3 (effective April 1, 2024)
 * - CAL FIRE LRA FHSZ = FHSALRA25_v1_All (map dated March 24, 2025)
 * - CAL FIRE WUI 2025 = publicly queryable FeatureServer hosting WUI25_1 attributes
 *   (WUI_DESC / WUI_NUM). Official Environment/WUI/MapServer and egis FRAP WUI
 *   Image/FeatureServers are currently 404 or token-gated for anonymous clients.
 */

export const FEMA_NFHL_FLOOD_HAZARD_ZONES_URL =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28";

export const CALFIRE_FHSZ_SRA_URL =
  "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/FHSZSRA_23_3/FeatureServer/0";

export const CALFIRE_FHSZ_LRA_URL =
  "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/FHSALRA25_v1_All/FeatureServer/0";

/** Primary WUI25_1-schema layer (statewide; labeled CAL FIRE WUI 2025). */
export const CALFIRE_WUI_URL =
  "https://services5.arcgis.com/nPtzMLkb4jZLRdvG/arcgis/rest/services/CAL_FIRE_FHSZ_and_WUI_2024_2025/FeatureServer/2";

/** Fallback statewide WUI25 republish if the primary host fails. */
export const CALFIRE_WUI_FALLBACK_URL =
  "https://services1.arcgis.com/9z9tEfqo0TExR9C8/arcgis/rest/services/Wildland_Urban_Interface_2025/FeatureServer/0";

export const FEMA_VIEWER_URL = "https://msc.fema.gov/portal/search";

export const CALFIRE_FHSZ_VIEWER_URL =
  "https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones";

export const CALFIRE_WUI_VIEWER_URL =
  "https://gis.data.cnra.ca.gov/datasets/CALFIRE-Forestry::wildland-urban-interface";

export const CALFIRE_FHSZ_SRA_EFFECTIVE = "April 1, 2024";
export const CALFIRE_FHSZ_LRA_MAP_DATE = "March 24, 2025";

/** Re-export so hazard formatters stay aligned with report UI caveat copy. */
export { WUI_CAVEAT } from "@/lib/research/constants";

/** Rough California bounding box for coverage vs. true service-gap distinction. */
export const CALIFORNIA_BBOX = {
  minLon: -124.5,
  maxLon: -114.0,
  minLat: 32.4,
  maxLat: 42.1,
} as const;

export function isInCaliforniaBbox(longitude: number, latitude: number): boolean {
  return (
    longitude >= CALIFORNIA_BBOX.minLon &&
    longitude <= CALIFORNIA_BBOX.maxLon &&
    latitude >= CALIFORNIA_BBOX.minLat &&
    latitude <= CALIFORNIA_BBOX.maxLat
  );
}

export function femaViewerUrlForPoint(latitude: number, longitude: number): string {
  return `${FEMA_VIEWER_URL}?AddressQuery=${encodeURIComponent(`${latitude}, ${longitude}`)}`;
}
```

---

## Hydrant endpoints

**Read the comments.** They correct two misleading service descriptions established by testing, not by reading documentation: the Campbell layer's real extent is Campbell-local despite claiming San Jose Water fusion, and SCFD does not cover Los Altos or south San Jose.

From `src/lib/providers/hydrants/config.ts`.

```typescript
/**
 * Live-verified hydrant GIS endpoints (Aug 2026).
 *
 * SCFD (City of Santa Clara): public Feature Layer, ~3.5k hydrants, Santa Clara
 * city extent — does NOT cover Los Altos or south San Jose (Esther Dr).
 *
 * Campbell PublicWorks Fire_Hydrants: queryable despite fused map cache; ~1k
 * hydrants. Service description claims "from San Jose Water, fused" but the
 * geographic extent is Campbell-local — NOT citywide San Jose. ORIGIN field
 * is null on all features. Nearest Campbell hydrant to 15035 Esther Dr is
 * ~4,700 ft (outside useful search radius).
 *
 * OSM Overpass: free fallback; Los Altos has coverage; Esther Dr / south SJ
 * often sparse within 2,500 ft.
 */

export const HYDRANT_MAX_SEARCH_RADIUS_FT = 2500;

export const HYDRANT_PULL_DISTANCE_CAVEAT =
  "Actual hydrant pull distance is measured along the path of travel and will be longer — measure on site.";

export const SCFD_HYDRANT_LAYER_URL =
  "https://map.santaclaraca.gov/maps/rest/services/SCFD_Tablet_Command/SCFD_Fire_Hydrants/MapServer/0";

export const CAMPBELL_HYDRANT_LAYER_URL =
  "https://gis.campbellca.gov/arcgis/rest/services/PublicWorks/Fire_Hydrants/MapServer/0";

export const OVERPASS_INTERPRETER_URL = "https://overpass-api.de/api/interpreter";

export const OVERPASS_USER_AGENT =
  "ActonADU-Baxter-PropertyResearch/1.0 (fire-hydrant lookup; https://actonadu.com)";

/** Manual lookup when no mapped hydrant is found nearby. */
export const HYDRANT_MANUAL_LOOKUP_URL = "https://www.openstreetmap.org/#map=18/";

export const HYDRANT_SOURCE_KEYS = ["scfd", "campbell", "osm"] as const;
export type HydrantSourceKey = (typeof HYDRANT_SOURCE_KEYS)[number];
```

---

## The buildable envelope

Turf geometry, the uniform inset, the three degenerate-case messages, and the disclaimers that must travel with the geometry rather than being bolted on at display time.

From `src/lib/research/buildable-envelope.ts`.

```typescript
import area from "@turf/area";
import buffer from "@turf/buffer";
import { multiPolygon, polygon } from "@turf/helpers";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { selectRulesForZoning } from "@/lib/jurisdictions/select-rules";
import type { JurisdictionRule } from "@/lib/jurisdictions/types";

export const SETBACK_FRONT_KEY = "adu_setback_front_ft" as const;
export const SETBACK_SIDE_KEY = "adu_setback_side_ft" as const;
export const SETBACK_REAR_KEY = "adu_setback_rear_ft" as const;
export const ADU_MAX_SIZE_KEY = "adu_max_size_sqft" as const;

/** Shown wherever the approximate envelope appears (map caption, area figure, section). */
export const BUILDABLE_ENVELOPE_DISCLAIMER =
  "Approximate only — side/rear setbacks applied uniformly; the larger front-yard setback (street-facing) is not modeled and must be applied by eye / on site. Does not account for easements, existing structures, slopes, trees, or utilities. Not a survey or zoning determination.";

export const FRONT_YARD_NOT_MODELED_NOTE =
  "Front-yard setback is listed for reference but is not drawn into the envelope — identifying the street-facing edge automatically is unreliable.";

export const DEGENERATE_ENVELOPE_MESSAGE =
  "Setbacks may consume most of this lot — site-specific analysis required.";

export const ENVELOPE_INVALID_FALLBACK_MESSAGE =
  "Could not draw a clean inset from this parcel geometry — showing setback rules only.";

const SQ_METERS_TO_SQ_FT = 10.76391041671;
const MIN_ENVELOPE_AREA_SQ_FT = 25;

export type SetbackRuleSlice = {
  feet: number | null;
  citation: string | null;
  zoneKey: string | null;
};

export type SetbackRulesSummary = {
  front: SetbackRuleSlice;
  side: SetbackRuleSlice;
  rear: SetbackRuleSlice;
  /** Uniform inset used for the envelope (max of available side/rear). */
  insetFeet: number | null;
  usedZoneSpecificRules: boolean;
  fellBackToGeneralRules: boolean;
  scopeLabel: "zone-specific" | "general" | "none";
  zoning: string | null;
};

export type MaxSizeRuleSlice = {
  sqFt: number;
  citation: string;
  zoneKey: string | null;
};

export type BuildableEnvelopeStatus =
  "ok" | "degenerate" | "rules_only" | "no_side_rear_rules" | "no_geometry" | "no_rules";

export type BuildableEnvelopeGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
};

export type BuildableEnvelopeResult = {
  status: BuildableEnvelopeStatus;
  setbacks: SetbackRulesSummary;
  maxSize: MaxSizeRuleSlice | null;
  geometry: BuildableEnvelopeGeometry | null;
  areaSqFt: number | null;
  insetFeet: number | null;
  statusMessage: string | null;
  disclaimer: string;
  frontYardNote: string;
};

function emptySetback(): SetbackRuleSlice {
  return { feet: null, citation: null, zoneKey: null };
}

function quantityFeet(rule: JurisdictionRule | undefined): SetbackRuleSlice {
  if (!rule) return emptySetback();
  if (rule.value_json.kind !== "quantity" || !Number.isFinite(rule.value_json.value)) {
    return { feet: null, citation: rule.source_citation, zoneKey: rule.zone_key };
  }
  return {
    feet: rule.value_json.value,
    citation: rule.source_citation,
    zoneKey: rule.zone_key,
  };
}

function findRule(rules: JurisdictionRule[], key: string): JurisdictionRule | undefined {
  return rules.find((rule) => rule.rule_key === key);
}

export function extractSetbackRulesSummary(
  rules: JurisdictionRule[],
  zoning: string | null | undefined,
): SetbackRulesSummary {
  const { selected, usedZoneSpecificRules, fellBackToGeneralRules } = selectRulesForZoning(
    rules,
    zoning,
  );
  const front = quantityFeet(findRule(selected, SETBACK_FRONT_KEY));
  const side = quantityFeet(findRule(selected, SETBACK_SIDE_KEY));
  const rear = quantityFeet(findRule(selected, SETBACK_REAR_KEY));

  const insetCandidates = [side.feet, rear.feet].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
  const insetFeet = insetCandidates.length > 0 ? Math.max(...insetCandidates) : null;

  let scopeLabel: SetbackRulesSummary["scopeLabel"] = "none";
  if (front.feet != null || side.feet != null || rear.feet != null) {
    scopeLabel = usedZoneSpecificRules ? "zone-specific" : "general";
  }

  return {
    front,
    side,
    rear,
    insetFeet,
    usedZoneSpecificRules,
    fellBackToGeneralRules,
    scopeLabel,
    zoning: zoning?.trim() || null,
  };
}

export function extractMaxSizeRule(
  rules: JurisdictionRule[],
  zoning: string | null | undefined,
): MaxSizeRuleSlice | null {
  const { selected } = selectRulesForZoning(rules, zoning);
  const rule = findRule(selected, ADU_MAX_SIZE_KEY);
  if (!rule || rule.value_json.kind !== "quantity" || !Number.isFinite(rule.value_json.value)) {
    return null;
  }
  return {
    sqFt: rule.value_json.value,
    citation: rule.source_citation,
    zoneKey: rule.zone_key,
  };
}

function isFinitePosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function closeRing(ring: Position[]): Position[] {
  if (ring.length < 3) return [];
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function extractPolygons(
  geometry: { type?: unknown; coordinates?: unknown } | null | undefined,
): Position[][][] {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];

  if (geometry.type === "Polygon") {
    const rings = (geometry.coordinates as unknown[])
      .filter(Array.isArray)
      .map((ring) => closeRing((ring as unknown[]).filter(isFinitePosition)))
      .filter((ring) => ring.length >= 4);
    return rings.length > 0 ? [rings] : [];
  }

  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as unknown[])
      .filter(Array.isArray)
      .map((polygonCoords) =>
        (polygonCoords as unknown[])
          .filter(Array.isArray)
          .map((ring) => closeRing((ring as unknown[]).filter(isFinitePosition)))
          .filter((ring) => ring.length >= 4),
      )
      .filter((rings) => rings.length > 0);
  }

  return [];
}

function featureFromPolygons(polygons: Position[][][]): Feature<Polygon | MultiPolygon> | null {
  if (polygons.length === 0) return null;
  if (polygons.length === 1) {
    return polygon(polygons[0]!);
  }
  return multiPolygon(polygons);
}

function geometryFromFeature(
  feature: Feature<Polygon | MultiPolygon | null> | null | undefined,
): BuildableEnvelopeGeometry | null {
  if (!feature?.geometry || feature.geometry.type === null) return null;
  const geom = feature.geometry;
  if (geom.type === "Polygon") {
    return { type: "Polygon", coordinates: geom.coordinates };
  }
  if (geom.type === "MultiPolygon") {
    return { type: "MultiPolygon", coordinates: geom.coordinates };
  }
  return null;
}

function isUsableEnvelopeGeometry(geometry: BuildableEnvelopeGeometry | null): boolean {
  if (!geometry) return false;
  try {
    const polygons = extractPolygons(geometry);
    if (polygons.length === 0) return false;
    const feature = featureFromPolygons(polygons);
    if (!feature) return false;
    const sqFt = area(feature) * SQ_METERS_TO_SQ_FT;
    return Number.isFinite(sqFt) && sqFt >= MIN_ENVELOPE_AREA_SQ_FT;
  } catch {
    return false;
  }
}

/**
 * Deterministic approximate buildable envelope: uniform inward offset using
 * side/rear setbacks only. Front setback is never applied to the geometry.
 */
export function computeApproximateBuildableEnvelope(input: {
  geometry: { type?: unknown; coordinates?: unknown } | null | undefined;
  rules: JurisdictionRule[];
  zoning?: string | null;
}): BuildableEnvelopeResult {
  const setbacks = extractSetbackRulesSummary(input.rules, input.zoning);
  const maxSize = extractMaxSizeRule(input.rules, input.zoning);
  const base = {
    setbacks,
    maxSize,
    disclaimer: BUILDABLE_ENVELOPE_DISCLAIMER,
    frontYardNote: FRONT_YARD_NOT_MODELED_NOTE,
  };

  const hasAnySetback =
    setbacks.front.feet != null || setbacks.side.feet != null || setbacks.rear.feet != null;

  if (!hasAnySetback) {
    return {
      ...base,
      status: "no_rules",
      geometry: null,
      areaSqFt: null,
      insetFeet: null,
      statusMessage:
        "No ADU setback rules configured — an admin can add them at /admin/jurisdictions.",
    };
  }

  if (setbacks.insetFeet == null) {
    return {
      ...base,
      status: "no_side_rear_rules",
      geometry: null,
      areaSqFt: null,
      insetFeet: null,
      statusMessage:
        "Front setback is configured, but side/rear setbacks are required to draw an approximate envelope.",
    };
  }

  const polygons = extractPolygons(input.geometry);
  if (polygons.length === 0) {
    return {
      ...base,
      status: "no_geometry",
      geometry: null,
      areaSqFt: null,
      insetFeet: setbacks.insetFeet,
      statusMessage:
        "Parcel geometry is unavailable — setback rules shown without an envelope map.",
    };
  }

  try {
    const bufferedPolygons: Position[][][] = [];
    for (const rings of polygons) {
      const feature = polygon(rings);
      const buffered = buffer(feature, -setbacks.insetFeet, { units: "feet" });
      const geom = geometryFromFeature(buffered as Feature<Polygon | MultiPolygon | null>);
      if (!geom) continue;
      bufferedPolygons.push(...extractPolygons(geom));
    }

    if (bufferedPolygons.length === 0) {
      return {
        ...base,
        status: "degenerate",
        geometry: null,
        areaSqFt: null,
        insetFeet: setbacks.insetFeet,
        statusMessage: DEGENERATE_ENVELOPE_MESSAGE,
      };
    }

    const envelopeFeature = featureFromPolygons(bufferedPolygons);
    if (!envelopeFeature || !isUsableEnvelopeGeometry(geometryFromFeature(envelopeFeature))) {
      return {
        ...base,
        status: "degenerate",
        geometry: null,
        areaSqFt: null,
        insetFeet: setbacks.insetFeet,
        statusMessage: DEGENERATE_ENVELOPE_MESSAGE,
      };
    }

    const envelopeGeometry = geometryFromFeature(envelopeFeature)!;
    const areaSqFt = Math.round(area(envelopeFeature) * SQ_METERS_TO_SQ_FT);

    return {
      ...base,
      status: "ok",
      geometry: envelopeGeometry,
      areaSqFt,
      insetFeet: setbacks.insetFeet,
      statusMessage: null,
    };
  } catch {
    return {
      ...base,
      status: "rules_only",
      geometry: null,
      areaSqFt: null,
      insetFeet: setbacks.insetFeet,
      statusMessage: ENVELOPE_INVALID_FALLBACK_MESSAGE,
    };
  }
}

export function formatEnvelopeAreaDisplay(areaSqFt: number): string {
  return `approximate buildable envelope: ~${Math.round(areaSqFt).toLocaleString("en-US")} sq ft (side/rear setbacks only)`;
}

export function formatMaxSizeDisplay(maxSize: MaxSizeRuleSlice): string {
  return `jurisdiction max detached ADU size: ${Math.round(maxSize.sqFt).toLocaleString("en-US")} sq ft (${maxSize.citation})`;
}
```

---

## Extracting a complete current bundle

```bash
{
  for f in src/lib/research/*.ts \
           src/lib/research/live/*.ts \
           src/lib/providers/*.ts \
           src/lib/providers/*/*.ts \
           src/lib/connectors/*.ts \
           src/lib/connectors/*/*.ts \
           src/lib/connectors/*/*/*.ts \
           src/lib/jurisdictions/*.ts \
           src/app/api/property-research/route.ts \
           src/app/api/property-research/*/route.ts \
           src/app/api/property-research/*/*/route.ts \
           src/app/api/slack/commands/property/route.ts \
           src/app/property-research/page.tsx \
           src/app/property-research/*/page.tsx \
           src/app/property-research/*/*/page.tsx \
           src/components/reports/*.tsx \
           supabase/migrations/001_initial_schema.sql \
           supabase/migrations/002_live_research_metadata.sql \
           supabase/migrations/003_prompt3_production.sql \
           supabase/migrations/041_jurisdiction_building_codes.sql; do
    echo "===== $f ====="
    cat "$f"
    echo
  done
} > property-research-bundle.txt
```

**Export the live jurisdiction rules.** Setbacks and ADU size limits live in `jurisdiction_rules` as admin-maintained rows with required citations. They are not in version control, and the buildable envelope depends on them.

```sql
select jurisdiction_key, rule_key, zone_key, value_json,
       source_citation, notes, updated_at
from public.jurisdiction_rules
order by jurisdiction_key, rule_key, zone_key nulls first;
```

---

## Rebuild order

See [Specification § 11](./02-specification.md#rebuilding-this-module). The order that matters most: build the claim-and-fact model and `selectPreferredFact` **before** any provider. Providers are adapters; the selection logic is the product.

**Verify every external endpoint live before wiring it.** The config comments in this module are a record of doing exactly that, and of what the published service descriptions got wrong.
