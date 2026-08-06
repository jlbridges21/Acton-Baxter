# Report limitations

This report summarizes licensed and publicly available property information for sales preparation.

It is **not**:

- a zoning determination
- a title report
- a survey
- a site measurement package
- an ADU feasibility conclusion
- an appraisal

Information must be verified during Acton’s feasibility process and with the appropriate public agencies.

## Licensed property providers

**RentCast is the primary (and soon sole) licensed property data provider.** ATTOM remains available while its trial key is configured for side-by-side comparison; the cutover is unsetting `ATTOM_API_KEY` — no other code change.

When ATTOM is absent (RentCast-only):

- Research runs cleanly with RentCast + jurisdiction GIS.
- Fields ATTOM alone claimed in the live pipeline (`foundation_type`, `tract_number`, `building_count`, `estimated_value`; APN still comes from county/city GIS when available) simply omit ATTOM claims — no blank/broken UI.
- **Foundation type** moves to the **On-site checklist** (RentCast has no equivalent).
- Estimated value / building count omit from overview when unset. The easement checklist does not require tract number; it shows one only as a supplemental search key when available.

When both keys are present, dual-source preference and conflict detection behave as before. Admin report diagnostics show an ATTOM vs RentCast comparison table for shared fields during the trial window.

## What is automated vs site inspection

- **Foundation type** may appear in Property Overview when ATTOM returns an assessor-derived value (verify on site). When absent — including RentCast-only mode — it is listed under the **On-site checklist** (formerly titled “Site inspection required”).
- **Utilities** (electric panel capacity, meter locations, service laterals) and **easements / recorded tract maps** are intentionally listed under the **On-site checklist** — not as missing data. The easement workflow is APN-first and remains complete without ATTOM’s optional tract number: use the County Assessor / Property Explorer, County Surveyor recorded-map index, preliminary title report, and Clerk-Recorder research path. Subdivision and tract/map number are supplemental search keys only.

Santa Clara County Property Profile access is currently a **generic search** into the public Property Explorer Experience unless a stable direct report endpoint is confirmed later.

## Parcel boundary imagery

Parcel geometry from the San Jose and Santa Clara County ArcGIS connectors is requested with `outSR=4326` and stored as WGS84 GeoJSON (`[longitude, latitude]`). The Parcel and public records card adds that boundary to Google satellite imagery through the authenticated imagery proxy and Google Static Maps encoded `path` parameters. The map derives its center/zoom from the full parcel bounds, draws every Polygon / MultiPolygon ring, and simplifies unusually detailed rings only when needed to stay below the Static Maps URL limit.

The overlay is an orientation aid for seeing lot lines relative to structures, trees, access, and neighboring improvements. It is **not a survey or title determination**. When a nearby mapped hydrant fits the parcel viewport, an `H` marker may appear; distant hydrants are omitted so the parcel stays readable (distance remains in the Fire access section). When setback rules support it, a teal approximate buildable envelope (side/rear inset only) may appear inside the parcel boundary — see Approximate buildable envelope below. When Google imagery is not configured or the image cannot load, the report keeps the standalone parcel-outline SVG fallback. The plain satellite image in Property imagery & maps remains unchanged.

## Flood, fire, and WUI hazards (automated)

These fields are filled from public ArcGIS point-in-polygon queries against the property’s confirmed coordinates. Timeouts/retries follow the shared ArcGIS client (`EXTERNAL_API_*`). One service failure does not block the others or the rest of the report; failures and true coverage gaps fall back to the official viewer link (manual review) without breaking the UI.

| Field                          | Source                                                                                                             | Notes                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flood zone                     | FEMA NFHL Flood Hazard Zones (MapServer layer 28)                                                                  | Zone code + plain-language description; verify on the FEMA Map Service Center                                                                                                 |
| Fire hazard severity zone      | CAL FIRE FHSZ SRA (`FHSZSRA_23_3`, effective April 1, 2024) and LRA (`FHSALRA25_v1_All`, map dated March 24, 2025) | Includes SRA vs LRA and effective/recommended date; verify on OSFM FHSZ maps                                                                                                  |
| Wildland-Urban Interface (WUI) | CAL FIRE WUI25-schema FeatureServer (`WUI_DESC` / Interface · Intermix · Influence Zone)                           | **Screen-level indicator only** — not a parcel-level designation. Always shown with: _screen-level indicator — verify parcel-specific WUI status with the local jurisdiction_ |

Official `Environment/WUI/MapServer` and egis FRAP WUI Feature/ImageServers are currently unavailable for anonymous query (404 / token-required); the live pipeline uses a publicly queryable statewide WUI25 republish with the same attribute schema.

## ADU code highlights (configured, not determined)

The **ADU code highlights** section shows admin-configured structured rules and associated Knowledge code documents for the report’s resolved jurisdiction. It is preparation material only — **not** a code determination, zoning determination, or feasibility conclusion. When nothing is configured, the section still renders with an honest empty state pointing admins to `/admin/jurisdictions`.

## Approximate buildable envelope (setbacks)

When parcel geometry and side/rear setback rules (`adu_setback_side_ft` / `adu_setback_rear_ft`) are available, the report draws a **uniform inward offset** of the parcel (negative Turf buffer) as an approximate buildable envelope. Front setback is shown with its citation but is **not** modeled in the polygon — automatic street-facing edge detection is unreliable and out of scope.

Honesty constraints (repeated on the map caption, area figure, and ADU highlights):

- Approximate; side/rear setbacks only; front yard not modeled
- Does **not** account for easements (cross-check the On-site checklist), existing structures, slopes, trees, or utilities
- **Not** a survey or zoning determination; no fits/doesn’t-fit verdict against `adu_max_size_sqft` (that max is shown adjacent for PEM prep only)

Small lots where the inset consumes the parcel show “setbacks may consume most of this lot — site-specific analysis required” instead of a broken shape. The teal envelope path is added to the parcel static map when URL budget allows; if not, the parcel boundary is kept and the envelope remains in the SVG outline / highlights text.

## Fire access — hydrant distance & sprinkler indicator

**Nearest mapped hydrant** distance is a GIS nearest-neighbor **straight-line** figure only. Fire-code hydrant pull distance is measured along the path of travel / hose lay and is longer. Every place this number appears (Fire access card, claims/facts, site inspection) states that and directs on-site measurement. The app never presents straight-line distance as pull distance.

Source ladder (verified Aug 2026): City of Santa Clara SCFD Fire Hydrants → Campbell PublicWorks Fire Hydrants → OpenStreetMap Overpass (`emergency=fire_hydrant`) → honest no-data. Official layers cover their city extents only; Campbell’s layer description mentions San Jose Water fusion, but live extent is Campbell-local (not citywide San Jose). Los Altos and much of San Jose rely on OSM or show no nearby mapped hydrant within ~2,500 ft. When a hydrant is found, the parcel-overlay map may add an `H` marker only if it fits the parcel viewport without zooming out; otherwise distance is text-only.

The **sprinkler distance indicator** reads `fire_sprinkler_hydrant_distance_max_ft` from `jurisdiction_rules` (with required citation). It compares straight-line distance to that threshold as preparation material — one factor among several sprinkler triggers — **not** a code determination. No configured rule → empty state pointing to `/admin/jurisdictions` (never a guessed threshold).

## Research reliability (web + Slack)

Web-triggered research (`/api/reports/[id]/run`, refresh, and retry) enqueues the same durable `property_research` job type Slack `/property` uses, then processes it via `after()` with queue claim/complete bookkeeping. Cron reclaim is the crash-recovery backup — a mid-run deploy or platform kill no longer leaves a report stuck in “researching” without a recoverable job.

Reports left in **researching** for more than **30 minutes** with no queued/running `property_research` job are flipped to **failed** with a retryable message (status poll and cron sweep). Use Retry research on the processing page.

## Screen vs print presentation

The report page is presentation-only for navigation: at-a-glance chips and a sticky section nav (sidebar on desktop, select on mobile) jump to the same sections that print as the card stack. Chips and nav are `print:hidden`; print CSS densifies spacing so a full report stays at or under six Letter pages. Chip values restate what each section already says — including honest “No data” / “No setback rules” states — and never invent severity or color-coding beyond what the sections express.
