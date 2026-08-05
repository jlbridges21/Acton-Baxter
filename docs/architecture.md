# Architecture

Acton Property Research is a Next.js App Router application with:

- Supabase Auth + Postgres + Storage
- Server-only providers for **RentCast** (required licensed property API), optional **ATTOM** (trial / sunset), ArcGIS, Google Places, AI, Slack
- Shared research orchestration used by the web UI and Slack

Live mode queries RentCast and (when `ATTOM_API_KEY` is set) ATTOM concurrently, then GIS using confirmed coordinates. Unsetting `ATTOM_API_KEY` is the cutover to RentCast-only — ATTOM code remains but is skipped cleanly.

## Request flow

1. Authenticated user selects a structured address
2. `POST /api/reports` creates a queued report
3. Processing page calls `POST /api/reports/[id]/run`
4. Run/refresh/retry **enqueue** a durable `property_research` job (same job type as Slack `/property`), then process inline via `after()` using `claimJobById` → `processJob` so cron cannot double-run an active job
5. `runPropertyResearch` chooses mock or live mode
6. Live mode queries RentCast and optional ATTOM concurrently, then GIS using confirmed coordinates
7. Claims are stored, preferred facts selected, conflicts detected
8. AI or deterministic PEM content is generated
9. Report is marked complete

Slack `/property` creates the same report and enqueues durable jobs for research + completion notification (cron processes those jobs; web also kicks `after()` for faster UX).

Stale recovery: researching reports older than 30 minutes with no live job are marked failed (retryable) by the status endpoint and the cron job sweep.

## Key modules

- `src/lib/research/` research orchestration and persistence
- `src/lib/providers/` ATTOM, RentCast, AI
- `src/lib/connectors/california/` San Jose and Santa Clara County
- `src/lib/address/` autocomplete and resolve
- `src/lib/branding/` logo and company settings
- `src/lib/slack/` signature verification and messaging
- `src/lib/jobs/` durable queue processing

## Parcel imagery

Parcel FeatureServer queries explicitly request `outSR=4326`; the ArcGIS polygon rings are normalized and persisted as GeoJSON longitude/latitude coordinates in the report’s parcel-geometry record.

`src/lib/providers/google/parcel-overlay.ts` prepares the print-safe parcel visual:

- normalizes Polygon and MultiPolygon rings (with a defensive Web Mercator conversion for legacy/unexpected geometry)
- closes and Google-polyline-encodes each ring
- computes a bounds-derived center and zoom with surrounding context
- simplifies detailed rings with Douglas-Peucker only when the Static Maps URL budget requires it

`GET /api/reports/[reportId]/imagery?view=parcel` loads the stored geometry, builds the server-keyed Google Static Maps request, and proxies the image bytes. The Parcel and public records card uses this as its primary visual; its existing standalone SVG remains the no-key/no-image fallback. The separate plain satellite and Street View requests are unchanged.

## Recorded easement workflow

Easements are not inferred from parcel GIS. `buildSiteInspectionItems()` provides an APN-first manual workflow through the Santa Clara County Assessor / Property Explorer, County Surveyor recorded-map index, preliminary title report, and Clerk-Recorder official-record research. RentCast subdivision and any available tract/map number are optional search aids, not dependencies.

## Jurisdiction building codes & ADU rules

Knowledge entries may carry a connector-aligned `jurisdiction_key` and `doc_kind` (building_code / ordinance / …). Structured, citation-required values live in `jurisdiction_rules` (admin CRUD at `/admin/jurisdictions`). Completed reports render **ADU code highlights** from those tables using the same jurisdiction resolution as live research (`selectJurisdictionConnector` / `resolveJurisdictionKeyFromReport`). This is preparation material, not a code determination.
