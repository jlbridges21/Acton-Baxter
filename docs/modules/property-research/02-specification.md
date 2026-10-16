# Property Research Tool — Specification

Acton ADU · Baxter module documentation · Report version 1.0.0

---

## How to read this document

This is the complete specification for the Property Research Tool, a capability inside Baxter. It records every behaviour the module exhibits today and every gap that should be closed.

Gaps are marked in bold with the prefix **GAP** where they occur, and collected in the final section with severity and owner. This describes the system as it actually is, not as it was intended.

---

## 1. Module identity

The original Baxter module. Migration `001_initial_schema.sql` creates its tables alongside the shared `profiles` table, so its schema and Baxter's foundations are intertwined.

**Users:** Acton sales advisors and project staff, preparing for a Partnership Evaluation Meeting.

**Input:** one property address, optionally with coordinates and a Google Place identifier from address autocomplete.

**Output:** a sourced research report — parcel identity, property characteristics, ownership, planning, hazards, fire access, an approximate buildable envelope, imagery, conflicts between sources, a source inventory, and a short AI narrative.

**It is a research tool, not a determination.** It reports what sources say. It does not certify zoning compliance, approve a design, or replace a survey.

---

## 2. The governing principle: claims, then facts

This is the module's central idea and the reason for its schema shape.

**Every value a source provides is stored as a claim**, in `property_source_claims`, recording the field, the source, the source type, the raw and normalized values, the match method, a match score, and whether it was selected.

**One fact per field is then selected**, into `property_facts`, with a preferred source, a confidence level, and the normalized value.

**Where claims disagree beyond a threshold, a conflict is raised**, into `report_conflicts`, carrying every competing value with its source and a recommended resolution.

The report shows the selected fact, and shows the disagreement where one exists. Nothing is silently reconciled.

### 2.1 How a fact is selected

Deterministic, not model-driven. Each claim scores on its source type, plus a per-field bonus for sources known to be authoritative for that specific field.

**Source type weights:**

| Source type             | Weight |
| ----------------------- | ------ |
| `city_gis`              | 100    |
| `county_gis`            | 95     |
| `licensed_property_api` | 70     |
| `state_government`      | 60     |
| `federal_government`    | 55     |
| `public_portal`         | 40     |
| `manual_link`           | 20     |
| `visual_observation`    | 10     |
| `mock`                  | 0      |

**The ordering is the point: a city's own GIS outranks a commercial data provider for jurisdiction facts.** San Jose knows San Jose's zoning better than a national aggregator does.

**Per-field bonuses** then refine it. Santa Clara County parcels outrank everything for APN and lot size. ATTOM outranks RentCast for living area, bedrooms, bathrooms, and estimated value. San Jose GIS carries a decisive bonus for zoning and general plan.

The result is that a commercial provider wins on building characteristics, and official GIS wins on parcel and planning facts — which is how the underlying data quality actually distributes.

### 2.2 Conflict thresholds

| Field           | Threshold                                    |
| --------------- | -------------------------------------------- |
| Lot size        | 3%                                           |
| Living area     | 5%                                           |
| Year built      | 2 years                                      |
| Estimated value | 20%                                          |
| APN             | Any difference after canonical normalisation |

APN is compared canonically — punctuation and case stripped — so formatting differences between a county and a commercial provider do not raise a false conflict, while a genuinely different parcel does.

---

## 3. Data model

Ten tables, created by migration 001 and extended by 002, 003, and 041.

**`reports`** — the research run. Input and standardized address, jurisdiction name and type, county, state, coordinates, APN and normalized APN, summary, status (`queued`, `researching`, `complete`, `failed`), error message, timings, and report version. Later migrations add provider identifiers (`attom_id`, `rentcast_id`, `fips`), the Google Place identifier, structured address parts, `parent_report_id` for refreshes, a property-profile access type and URL, research diagnostics, and AI generation metadata (provider, model, status, prompt version, generated-at, input hash).

**`property_facts`** — one row per field per report, unique on `(report_id, field_key)`. Carries the normalized value as text, number, or boolean, a unit, the preferred source name and URL, and a confidence of `high`, `medium`, `low`, or `unavailable`.

**`property_source_claims`** — every claim from every source, with source type, match method, match score, and an `is_preferred` flag.

**`report_conflicts`** — field, severity (`information`, `warning`, `critical`), description, the competing values as JSON, and a recommended resolution.

**`report_sources`** — every source queried, its type and URL, status (`active`, `unavailable`, `error`, `stale`, `manual_review`), retrieval time, response time, endpoint name, and HTTP status. This is the report's audit trail: it records sources that failed as well as those that answered.

**`parcel_geometry`** — the parcel boundary as GeoJSON, with centroid and calculated area. One row per report.

**`site_observations`** — observations recorded against a report.

**`pem_preparations`** — the PEM-facing preparation output.

**`jurisdiction_connectors`** and **`connector_health_checks`** — connector registry and health history. Health is admin-visible only.

**`jurisdiction_rules`** (migration 041) — admin-maintained structured rules keyed by jurisdiction, rule key, and optional zone key, with **a required source citation** and an optional link to the knowledge entry it came from. This is what the buildable envelope reads its setbacks from.

### 3.1 Access control

RLS is enabled. Authenticated users may read reports and all research children. Report creation is allowed to authenticated users; updates are restricted to the creator and only while the report is `queued`, `researching`, or `failed`. Connector health and full connector detail are admin-only.

> **GAP:** every authenticated user can read every report, including owner names and mailing addresses pulled from assessor records. That is personal information about people who are not Acton customers. For a small team this may be acceptable; it should be a decision rather than a default.

> **GAP:** no retention policy. Reports and the personal information in them persist indefinitely.

---

## 4. Jurisdiction coverage

**This is the most important scope fact about the module.**

Three connectors exist:

| Connector          | Coverage                                       |
| ------------------ | ---------------------------------------------- |
| San Jose           | Parcels, zoning, general plan, city GIS layers |
| Santa Clara County | Parcels, assessor property profile access      |
| Fallback           | Generic links, for everywhere else             |

Selection prefers a matching city connector, then a county connector, then the fallback.

A property in San Jose gets city zoning and general plan from the city's own GIS, county parcel geometry, and a resolved assessor property profile. A property in Los Angeles gets commercial property data, federal flood maps, statewide fire hazard layers, and a set of generic links.

**Both are real reports. They are not comparable in depth.**

> **GAP:** the report does not distinguish coverage depth as prominently as the difference warrants. A reader unfamiliar with the module could read a fallback-connector report as equivalent to a San Jose one. A clear coverage indicator at the top of the report would fix this cheaply.

---

## 5. Data sources

### 5.1 Commercial property data

**RentCast** is the primary provider and is always queried.

**ATTOM** is optional and queried only when `ATTOM_API_KEY` is configured. When absent, the report records ATTOM as `unavailable` with an explicit message stating it is optional and RentCast is primary — so the omission is visible rather than silent.

ATTOM was evaluated at roughly **$600 per month** and dropped on cost. The integration remains complete, and the per-field bonuses still prefer ATTOM for living area, bedrooms, bathrooms, and estimated value. Re-enabling it is a configuration change, not development work. See [ADR-004](./05-adrs.md#adr-004).

Both are queried concurrently with `Promise.allSettled`, so one failing never prevents the other from contributing.

### 5.2 Hazards

| Source   | Layer                                                   | Notes                    |
| -------- | ------------------------------------------------------- | ------------------------ |
| FEMA     | National Flood Hazard Layer, MapServer layer 28         | Flood zone               |
| CAL FIRE | FHSZ State Responsibility Area, effective 1 April 2024  | Fire hazard severity     |
| CAL FIRE | FHSZ Local Responsibility Area, map dated 24 March 2025 | Fire hazard severity     |
| CAL FIRE | WUI 2025, with a fallback republish host                | Wildland-urban interface |

Each is a point-in-polygon query against a public ArcGIS endpoint, verified live before being wired in. A California bounding box distinguishes genuine out-of-coverage from a service failure, so a property in Oregon reports "outside coverage" rather than "error".

**The WUI caveat is mandatory.** CAL FIRE documents WUI as a screen-level relative-risk indicator, not a parcel-level designation, and the module attaches that caveat wherever WUI appears.

> The code comments record that the official CAL FIRE WUI MapServer and the FRAP image and feature servers are _"currently 404 or token-gated for anonymous clients"_, which is why a specific alternative host is used. This is the kind of thing that breaks without warning.

### 5.3 Fire hydrants

Three sources, searched to a maximum radius of **2,500 feet**:

| Source                 | Real coverage                                     |
| ---------------------- | ------------------------------------------------- |
| Santa Clara city SCFD  | ~3,500 hydrants, Santa Clara **city** extent only |
| Campbell Public Works  | ~1,000 hydrants, **Campbell-local**               |
| OpenStreetMap Overpass | Free fallback, patchy                             |

**The code comments correct two misleading service descriptions.** The Campbell layer claims to be sourced "from San Jose Water, fused" but its actual extent is Campbell-local, not citywide San Jose. The SCFD layer does not cover Los Altos or south San Jose. These were established by testing, not by reading documentation, and the corrections are recorded in the config file.

**The pull-distance caveat is mandatory:** actual hydrant pull distance is measured along the path of travel and will be longer than a straight line. Measure on site.

When no hydrant is found within the radius, a manual lookup link is offered rather than a silent absence.

### 5.4 Imagery and geocoding

Google Static Maps for aerial imagery and the parcel overlay, Google geocoding and Places for address resolution. Coordinates from autocomplete are preferred over re-geocoding.

### 5.5 Jurisdiction rules

Setbacks and ADU size limits come from `jurisdiction_rules`, an admin-maintained table where **every rule requires a source citation**. Rules can be scoped to a zone, and the envelope records whether it used zone-specific rules or fell back to general ones.

---

## 6. The buildable envelope

The parcel boundary, inset by the applicable ADU setbacks, drawn on a map with its approximate area.

Computed with Turf: the parcel polygon is buffered inward by a uniform inset, taken as the **maximum of the available side and rear setbacks**.

**What is modelled:** side and rear setbacks, uniformly.

**What is not, and is said so explicitly:**

- **The front-yard setback.** Listed for reference but not drawn, because identifying the street-facing edge automatically is unreliable. The code states this directly and the note appears in the report.
- Easements, existing structures, slopes, trees, and utilities.

Three failure cases are handled with specific wording rather than a blank map: setbacks consuming most of the lot, geometry that cannot produce a clean inset, and an area below a 25 square foot floor.

The disclaimer appears wherever the envelope does — the map caption, the area figure, and the section itself.

> **GAP:** the disclaimer is correct, complete, and prominent, and it is still the weakest point in the module. A shaded polygon with a square-foot number on a map carries more authority than a sentence beneath it. This is not a code defect — it is worth the owner deciding whether the envelope should be shown at all in jurisdictions where setback rules are not in `jurisdiction_rules`, since the alternative is a drawn envelope resting on general rather than zone-specific values.

---

## 7. The AI narrative

A short summary written over the gathered facts.

**Providers:** Anthropic, OpenAI, and a **deterministic provider** that composes a summary from the facts with no model at all. Selection is by `AI_PROVIDER`.

**The input is sanitized before generation.** Only gathered facts are passed; critical fields (APN, lot size, living area, year built, zoning) are tracked explicitly so the narrative can state what is missing rather than inventing it.

Each report records the provider, model, generation status (`success`, `fallback`, `skipped`, `error`), prompt version, generation time, and a hash of the input — so a narrative can always be traced to the data it was written from.

**Failure degrades to the deterministic provider**, not to an error. A report is never blocked by the narrative.

> **GAP:** no accuracy baseline. Constraining the input and falling back deterministically bounds the risk, but nobody has compared a sample of narratives against what a researcher would have written.

---

## 8. Running a report

```
queued ──▶ researching ──▶ complete
                │
                └──▶ failed ──▶ (retry) ──▶ queued
```

Creating a report saves the address and enqueues research. Status is polled. Refresh re-runs research against the same address, clearing research children first and recording a refresh reason; `parent_report_id` links a refreshed report to its predecessor.

### 8.1 Progress reporting

The interface shows six stages: confirming the address, identifying the parcel and APN, retrieving property characteristics, checking city and county GIS, comparing sources, preparing the report.

> **GAP — the stages are cosmetic.** They advance on a **fixed 400 millisecond timer**, independent of what the pipeline is actually doing, and jump to the final stage when work completes. A report stalled on a slow GIS endpoint displays the same confident march as one that is working.
>
> This is a reasonable UX choice presented as something it is not. Either wire the stages to real pipeline milestones — the pipeline has natural ones — or replace them with an honest indeterminate indicator.

> **GAP — in-flight and progress state is per-instance.** The guard preventing a duplicate run and the stage counter are module-level in-memory structures. In a serverless deployment these do not survive across invocations and are not shared between instances, so the guard does not actually prevent concurrent runs of the same report, and progress is whatever the instance serving the poll happens to believe. Durable state belongs in the database, which already has the columns for it.

---

## 9. Mock mode

When `ENABLE_MOCK_RESEARCH` is set, the pipeline returns a fabricated report about a fixed reference address rather than researching the submitted one.

> **GAP:** this defaults on outside production and the result is not prominently labelled as fabricated in the interface. Source rows carry `mock` as a source type and the weighting gives mock sources a score of zero, so the data model is honest — but someone trialling the tool in a staging environment could reasonably believe they are looking at research on their address.

---

## 10. Gaps to resolve

| #   | Gap                                                                                | Severity | Blocks launch | Owner | Status |
| --- | ---------------------------------------------------------------------------------- | -------- | ------------- | ----- | ------ |
| 1   | No module owner named                                                              | High     | Yes           | —     | Open   |
| 2   | Progress stages are a timer animation, not progress                                | High     | Yes           | —     | Open   |
| 3   | `ENABLE_MOCK_RESEARCH` defaults on outside production, not visibly labelled        | High     | Yes           | —     | Open   |
| 4   | External GIS endpoints unmonitored; several already moved or became token-gated    | High     | Yes           | —     | Open   |
| 5   | In-flight guard and progress are per-instance in-memory, ineffective in serverless | Medium   | No            | —     | Open   |
| 6   | Coverage depth outside Santa Clara County not clearly signalled in the report      | Medium   | No            | —     | Open   |
| 7   | No accuracy baseline for the AI narrative                                          | Medium   | No            | —     | Open   |
| 8   | No monitoring of source health, failure rate, latency, or cost                     | Medium   | No            | —     | Open   |
| 9   | Owner names and mailing addresses readable by every authenticated user             | Medium   | No            | —     | Open   |
| 10  | No retention policy for reports containing personal information                    | Low      | No            | —     | Open   |

**Gaps 1 through 4 should be closed first.** Gap 2 is the one a user will notice and lose trust over. Gap 4 is the one most likely to produce silently wrong reports, because a hazard layer that moves does not fail loudly — it returns nothing, and nothing looks like no hazard.

---

## 11. Rebuilding this module

1. Apply migrations 001, 002, 003, and 041. Reproduced in the [Code Reference](./03-code.md#migrations).
2. Build constants, types, and schemas — the field keys, source types, match methods, and thresholds are the vocabulary everything else speaks.
3. Build address normalisation and APN canonicalisation. Pure, testable, and the foundation of matching.
4. **Build the claim-and-fact model and `selectPreferredFact` before any provider.** The weights and per-field bonuses are the module's actual intelligence; providers are just adapters feeding them.
5. Build the conflict detector with its thresholds.
6. Build providers one at a time, starting with RentCast. Each returns claims, not facts.
7. Build the jurisdiction connector interface, then San Jose, Santa Clara County, and the fallback.
8. Build hazards and hydrants. **Verify every endpoint live before wiring it** — the existing config comments are a record of doing exactly that, and of what the service descriptions got wrong.
9. Build the jurisdiction rules store and the buildable envelope. Keep the disclaimers attached to the geometry, not bolted on at display time.
10. Build the AI layer last, deterministic provider first, so the report is complete before a model is involved.

The highest-value artifacts to preserve are the **source weights and per-field bonuses**, the **conflict thresholds**, and the **endpoint config comments recording what was verified and what the service descriptions got wrong**. The code can be rewritten from this specification. That accumulated knowledge about which source is actually right about what cannot.
