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
- **Foundation type** moves to **Site inspection required** (RentCast has no equivalent).
- Estimated value / building count omit from overview when unset; tract number is called out in the easements site-inspection checklist when not auto-filled.

When both keys are present, dual-source preference and conflict detection behave as before. Admin report diagnostics show an ATTOM vs RentCast comparison table for shared fields during the trial window.

## What is automated vs site inspection

- **Foundation type** may appear in Property Overview when ATTOM returns an assessor-derived value (verify on site). When absent — including RentCast-only mode — it is listed under **Site inspection required**.
- **Utilities** (electric panel capacity, meter locations, service laterals) and **easements / recorded tract maps** are intentionally listed under **Site inspection required** — not as missing data. Use the APN, tract/subdivision identifiers, and assessor / Property Profile links there to start recorder and title review.

Santa Clara County Property Profile access is currently a **generic search** into the public Property Explorer Experience unless a stable direct report endpoint is confirmed later.

## Flood, fire, and WUI hazards (automated)

These fields are filled from public ArcGIS point-in-polygon queries against the property’s confirmed coordinates. Timeouts/retries follow the shared ArcGIS client (`EXTERNAL_API_*`). One service failure does not block the others or the rest of the report; failures and true coverage gaps fall back to the official viewer link (manual review) without breaking the UI.

| Field                          | Source                                                                                                             | Notes                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flood zone                     | FEMA NFHL Flood Hazard Zones (MapServer layer 28)                                                                  | Zone code + plain-language description; verify on the FEMA Map Service Center                                                                                                 |
| Fire hazard severity zone      | CAL FIRE FHSZ SRA (`FHSZSRA_23_3`, effective April 1, 2024) and LRA (`FHSALRA25_v1_All`, map dated March 24, 2025) | Includes SRA vs LRA and effective/recommended date; verify on OSFM FHSZ maps                                                                                                  |
| Wildland-Urban Interface (WUI) | CAL FIRE WUI25-schema FeatureServer (`WUI_DESC` / Interface · Intermix · Influence Zone)                           | **Screen-level indicator only** — not a parcel-level designation. Always shown with: _screen-level indicator — verify parcel-specific WUI status with the local jurisdiction_ |

Official `Environment/WUI/MapServer` and egis FRAP WUI Feature/ImageServers are currently unavailable for anonymous query (404 / token-required); the live pipeline uses a publicly queryable statewide WUI25 republish with the same attribute schema.

## Research reliability (web + Slack)

Web-triggered research (`/api/reports/[id]/run`, refresh, and retry) enqueues the same durable `property_research` job type Slack `/property` uses, then processes it via `after()` with queue claim/complete bookkeeping. Cron reclaim is the crash-recovery backup — a mid-run deploy or platform kill no longer leaves a report stuck in “researching” without a recoverable job.

Reports left in **researching** for more than **30 minutes** with no queued/running `property_research` job are flipped to **failed** with a retryable message (status poll and cron sweep). Use Retry research on the processing page.
