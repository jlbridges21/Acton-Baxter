# Property Research Tool — Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning is [Semantic Versioning](https://semver.org/) against the report version.

For this module, the version numbers mean:

- **Major** — a change to the claims-and-facts contract, the field key vocabulary, or the report schema. Existing stored reports may no longer render the same way.
- **Minor** — a new data source, a new report section, or a new field.
- **Patch** — a fix with no contract change.

> **Reconstructed history.** Entries before this document existed were reconstructed from version control, migration comments, and code comments. Dates are commit dates. From here on, this file is updated in the same commit as the change it describes.

---

## [Unreleased]

### To do

Nothing scheduled. Ten open gaps in the [Specification](./02-specification.md#gaps-to-resolve); the four launch-blocking ones should be addressed first.

---

## [1.0.0] — 2026-07-23 — initial release

Migration `001_initial_schema.sql`. **Baxter's first module** — the repository is named after it.

### Added

- **The claims-and-facts model**: every value from every source stored as a claim, one fact selected per field, disagreements recorded as conflicts. The decision the whole module rests on. See [ADR-001](./05-adrs.md#adr-001).
- **Deterministic fact selection** by source-type weight plus per-field bonus, with official GIS outranking licensed APIs for jurisdiction facts. See [ADR-002](./05-adrs.md#adr-002).
- **Conflict detection** with per-field thresholds and canonical APN comparison, so formatting differences do not raise false conflicts. See [ADR-003](./05-adrs.md#adr-003).
- Core tables: `reports`, `property_facts`, `property_source_claims`, `report_conflicts`, `report_sources`, `parcel_geometry`, `site_observations`, `pem_preparations`, `jurisdiction_connectors`, `connector_health_checks` — alongside the shared `profiles` table.
- **Jurisdiction connectors** for San Jose and Santa Clara County, with a generic fallback so an address outside coverage still produces a report. See [ADR-009](./05-adrs.md#adr-009).
- A source inventory recording **every source queried, including the ones that failed**.
- Report pages: history, new report with address autocomplete, the report itself, and a processing view.

### Security

- Row Level Security: authenticated read, creator-only updates while a report is not complete, admin-only connector health.

---

## [1.0.0] — 2026-07-23 — imagery and new-user handling

Migration `005_new_user_role_and_maps.sql`.

### Added

- Aerial and street-level imagery.
- The `new_user` role, gating access until an admin grants it.

---

## [1.0.0] — 2026-07-25 — admin role management

### Added

- Admin role management, including the `admin_set_profile_role` function.

---

## [1.1.0] — 2026-08-05 — reliability foundation

Migrations `002_live_research_metadata.sql`, `003_prompt3_production.sql`.

### Added

- Provider identifiers on reports: `attom_id`, `rentcast_id`, `fips`.
- Structured address parts and the Google Place identifier, so coordinates from autocomplete are used directly rather than re-geocoded.
- `normalized_apn` with a backfill, and an index, so APN matching is canonical throughout.
- **Refresh lineage**: `parent_report_id` and `refresh_reason`, so a refreshed report is linked to its predecessor rather than overwriting it. See [ADR-011](./05-adrs.md#adr-011).
- **AI narrative** with Anthropic, OpenAI, and deterministic providers; input sanitised to gathered facts; generation status, prompt version, and an input hash recorded so a narrative is always traceable to its data. See [ADR-010](./05-adrs.md#adr-010).
- Property-profile access type and URL for the county assessor, recording whether access was a direct report, a deep link, a generic search, recreated from layers, or unavailable.
- Research diagnostics JSON, per-claim match scores, and an `is_preferred` flag.
- Endpoint name and HTTP status on source rows.

---

## [1.2.0] — 2026-08-05 — RentCast replaces ATTOM as primary

### Changed

- **RentCast is now the primary property data provider.** ATTOM runs only when `ATTOM_API_KEY` is configured, which it is not by default.
- When ATTOM is absent, the report records it as `unavailable` with an explicit message saying it is optional and RentCast is primary — the omission is visible, not silent.
- Per-field bonuses still prefer ATTOM for living area, bedrooms, bathrooms, and estimated value, so re-enabling it is a configuration change rather than development work.

### Why

ATTOM was evaluated at roughly **$600 per month** and dropped on cost. See [ADR-004](./05-adrs.md#adr-004).

---

## [1.3.0] — 2026-08-05 — real hazard data

### Added

- **FEMA** National Flood Hazard Layer flood zone lookup.
- **CAL FIRE** Fire Hazard Severity Zone for both State and Local Responsibility Areas, recording each map's effective date — SRA effective 1 April 2024, LRA map dated 24 March 2025.
- **CAL FIRE WUI 2025**, with a fallback host because the official MapServer and the FRAP image and feature servers are 404 or token-gated for anonymous clients.
- A California bounding box so a property outside the state reports "outside coverage" rather than an error.
- **The mandatory WUI caveat** as a constant attached to the data: a screen-level relative-risk indicator, not a parcel-level designation. See [ADR-006](./05-adrs.md#adr-006).

### Notes

Every endpoint was verified live with a point-in-polygon query before being wired in, and the findings recorded as comments in the config. See [ADR-005](./05-adrs.md#adr-005).

---

## [1.4.0] — 2026-08-05 — parcel map visualization

### Added

- Parcel boundary geometry stored as GeoJSON with centroid and calculated area.
- Google Static Maps parcel overlay.
- APN-first easement and tract-map workflow.

---

## [1.5.0] — 2026-08-05 — fire hydrants

### Added

- Hydrant lookup across three sources with a priority ladder: Santa Clara city SCFD, Campbell Public Works, and OpenStreetMap Overpass as a free fallback.
- A 2,500 foot search radius, with a manual lookup link when nothing is found.
- **The mandatory pull-distance caveat**: actual distance is measured along the path of travel and will be longer. Measure on site.

### Notes

The config comments correct two misleading service descriptions established by testing: the Campbell layer claims to be sourced from San Jose Water but its real extent is Campbell-local, and SCFD does not cover Los Altos or south San Jose. Neither is discoverable from documentation, and both would have produced silently wrong reports.

---

## [1.6.0] — 2026-08-05 — setback rules and the buildable envelope

Migration `041_jurisdiction_building_codes.sql`.

### Added

- **`jurisdiction_rules`**: admin-maintained setbacks and ADU size limits, keyed by jurisdiction, rule key, and optional zone, with **`source_citation` required by the database**. See [ADR-008](./05-adrs.md#adr-008).
- Jurisdiction-scoped knowledge entries with a document kind, so code and ordinance documents are identifiable.
- **The approximate buildable envelope**: the parcel inset by the maximum of the available side and rear setbacks, drawn on the map with its area.
- Three degenerate-case messages rather than a blank map: setbacks consuming the lot, geometry that will not inset cleanly, and an area below 25 square feet.
- ADU code highlights with citations.

### Notes

**The front-yard setback is listed but not drawn**, because identifying the street-facing edge automatically is unreliable. The disclaimer travels with the geometry and appears wherever the envelope does. See [ADR-007](./05-adrs.md#adr-007).

---

## [1.6.1] — 2026-08-05 — report UI and failure handling

### Changed

- Report section navigation, at-a-glance summary chips, and section presentation.

### Fixed

- Failure handling and recovery for reports stuck in `researching`.

---

## Earlier

The module first appears in version control on 23 July 2026 as "Complete Acton Property Research app". Nothing before that is documented; version control is the only source.
