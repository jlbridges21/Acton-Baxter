# Property Research Tool — Module Record

The single-page source of truth. Everything here should be checkable in under a minute.

---

## Identity

| Field          | Value                                                              |
| -------------- | ------------------------------------------------------------------ |
| Module name    | Property Research Tool                                             |
| Registry key   | `property-research` (in `src/lib/baxter/tools.ts`)                 |
| Type           | Baxter capability                                                  |
| Status         | In production use                                                  |
| Risk tier      | **High** — output informs feasibility conversations with customers |
| Report version | 1.0.0                                                              |
| First shipped  | Migration `001_initial_schema.sql` — **Baxter's first module**     |
| Notable        | The repository is named after this tool                            |

## Ownership

| Role                     | Person              | Responsibility                                                          |
| ------------------------ | ------------------- | ----------------------------------------------------------------------- |
| Module owner             | **GAP — not named** | Data accuracy, source health, provider cost, gap closure                |
| Technical owner          | **GAP — not named** | Pipeline, providers, connectors, incidents                              |
| Jurisdiction rules owner | **GAP — not named** | The `jurisdiction_rules` table — setbacks and ADU limits with citations |
| Approver                 | **GAP — not named** | Signs off changes to fact selection or conflict thresholds              |

> Naming an owner is gap 1 and blocks the rest. The jurisdiction rules role is genuinely separate: it needs someone who can read an ordinance and cite it, not someone who writes code.

## Users

Acton sales advisors and project staff. Any signed-in Baxter user with app access can create and read any report.

## Where things live

| Thing                          | Location                                                         |
| ------------------------------ | ---------------------------------------------------------------- |
| Core code                      | `src/lib/research/`                                              |
| Live pipeline                  | `src/lib/research/live/run-live-property-research.ts`            |
| Providers                      | `src/lib/providers/`                                             |
| Jurisdiction connectors        | `src/lib/connectors/california/`, `src/lib/connectors/fallback/` |
| Jurisdiction rules             | `src/lib/jurisdictions/`                                         |
| Pages                          | `src/app/reports/`                                               |
| API routes                     | `src/app/api/reports/`                                           |
| Components                     | `src/components/reports/`                                        |
| Migrations                     | 001, 002, 003, 041                                               |
| **Live setback and ADU rules** | **Database table `jurisdiction_rules` — not in version control** |
| Tests                          | `tests/unit/` — see the [Test Plan](./06-test-plan-and-eval.md)  |

### Tables

| Table                     | Purpose                                         |
| ------------------------- | ----------------------------------------------- |
| `reports`                 | The research run and its metadata               |
| `property_facts`          | One selected fact per field                     |
| `property_source_claims`  | Every claim from every source                   |
| `report_conflicts`        | Disagreements beyond threshold                  |
| `report_sources`          | Every source queried, including failures        |
| `parcel_geometry`         | Parcel boundary GeoJSON                         |
| `site_observations`       | Observations against a report                   |
| `pem_preparations`        | PEM-facing preparation output                   |
| `jurisdiction_connectors` | Connector registry                              |
| `connector_health_checks` | Health history, admin-only                      |
| `jurisdiction_rules`      | Citation-required setbacks and ADU limits (041) |

## External data sources

| Source                                | Role                                                                           | Cost                             |
| ------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------- |
| **RentCast**                          | **Primary** property data                                                      | Paid, modest                     |
| ATTOM                                 | Optional property data; preferred for building characteristics when configured | **~$600/month — not configured** |
| Google Geocoding, Places, Static Maps | Address resolution and imagery                                                 | Per request                      |
| FEMA NFHL                             | Flood zone                                                                     | Free                             |
| CAL FIRE FHSZ (SRA, LRA)              | Fire hazard severity                                                           | Free                             |
| CAL FIRE WUI 2025                     | Wildland-urban interface                                                       | Free                             |
| Santa Clara County ArcGIS             | Parcels, assessor profile                                                      | Free                             |
| San Jose ArcGIS                       | Parcels, zoning, general plan                                                  | Free                             |
| Santa Clara city SCFD                 | Hydrants, city extent only                                                     | Free                             |
| Campbell Public Works                 | Hydrants, Campbell-local only                                                  | Free                             |
| OpenStreetMap Overpass                | Hydrant fallback                                                               | Free                             |
| OpenAI or Anthropic                   | Report narrative                                                               | Per report                       |

## Configuration

| Variable                                              | Purpose                                 | Default                         |
| ----------------------------------------------------- | --------------------------------------- | ------------------------------- |
| `RENTCAST_API_KEY`                                    | Primary property data                   | required                        |
| `RENTCAST_BASE_URL`                                   | Override                                | —                               |
| `ATTOM_API_KEY`                                       | Optional provider                       | **unset**                       |
| `ATTOM_BASE_URL`                                      | Override                                | —                               |
| `GOOGLE_MAPS_SERVER_API_KEY`                          | Geocoding and imagery                   | falls back to other Google keys |
| `AI_PROVIDER`                                         | `anthropic`, `openai`, or deterministic | —                               |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`                 | Narrative                               | —                               |
| `EXTERNAL_API_TIMEOUT_MS`, `EXTERNAL_API_MAX_RETRIES` | Outbound call limits                    | —                               |
| `ENABLE_MOCK_RESEARCH`                                | Fabricated report instead of research   | **on outside production**       |
| `ALLOW_MOCK_FALLBACK`                                 | Permit mock fallback                    | —                               |

## Coverage

| Area                              | Depth                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------- |
| San Jose                          | **Full** — city zoning, general plan, parcels, county geometry, assessor profile |
| Santa Clara County (other cities) | **Good** — county parcels and assessor profile, no city zoning                   |
| Rest of California                | **Basic** — commercial data, FEMA, CAL FIRE, generic links                       |
| Outside California                | **Minimal** — commercial data and FEMA; CAL FIRE layers report out-of-coverage   |

Hydrant coverage is narrower still: Santa Clara city and Campbell have mapped layers, everywhere else depends on OpenStreetMap.

## Key thresholds

| Setting                  | Value                              |
| ------------------------ | ---------------------------------- |
| Lot size conflict        | 3%                                 |
| Living area conflict     | 5%                                 |
| Year built conflict      | 2 years                            |
| Estimated value conflict | 20%                                |
| Hydrant search radius    | 2,500 ft                           |
| Minimum envelope area    | 25 sq ft                           |
| Progress stage advance   | 400 ms — **a timer, not progress** |

## Dependencies and blast radius

**This module depends on:** Supabase, RentCast, Google, and a dozen public GIS endpoints outside Acton's control.

**These depend on it:** PEM preparation reads its output. Baxter chat answers questions about researched properties. Admin diagnostics and launch readiness read source health.

**Shares with Baxter overall:** migration 001 creates `profiles` alongside this module's tables, so this module's schema and Baxter's foundations cannot be cleanly separated.

## Open gaps

Four launch-blocking, ten total. See the [Specification](./02-specification.md#gaps-to-resolve).

The four: no owner; the progress display is a timer animation; mock mode defaults on without visible labelling; and external GIS endpoints are unmonitored when several have already moved.

## Review

| Activity                                        | Cadence             | Last done                              |
| ----------------------------------------------- | ------------------- | -------------------------------------- |
| Documentation review                            | Quarterly           | **Never** — this document is the first |
| **External endpoint health check**              | **Monthly**         | Ad hoc                                 |
| Fact-accuracy spot check against county records | **Not established** | **Never**                              |
| Provider cost review                            | **Not established** | **Never**                              |
| Export `jurisdiction_rules` to this folder      | Quarterly           | **Never**                              |
