# Site Inspection Checklist — Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning is [Semantic Versioning](https://semver.org/).

For this module, the version numbers mean:

- **Major** — a change to the snapshot shape or the checklist contract. Existing inspections may no longer render the same way.
- **Minor** — new capability or a new field that existing inspections tolerate.
- **Patch** — a fix with no contract change.

> **Reconstructed history.** Entries before this document existed were reconstructed from version control, migration comments, and code comments. Dates are commit dates. From here on, this file is updated in the same commit as the change it describes.

---

## [Unreleased]

### Changed

- **Project picker shows Open projects only.** Starting or editing an inspection offers projects marked Open in column J of the Master Project Log, plus active custom jobs. Creating or re-linking an inspection to a Closed or Unknown project is rejected on the server. Inspections already linked to a project that later Closes keep their project name and address, and the edit dialog shows the link as "Current: … (Closed)". Needs migration `066_expense_jobs_project_status.sql`. The picker now says "Only Open projects from the Master Project Log are shown." Receipts and Inventory can show Closed projects; inspections cannot.

### To do

Nothing scheduled. Ten open gaps in the [Specification](./02-specification.md#gaps-to-resolve); the three launch-blocking ones should be addressed first.

---

## [1.0.0] — 2026-09-18 — initial release

Migrations `046_site_inspection_templates.sql`, `047_site_inspection_records.sql`, `048_site_inspection_media_pipeline.sql`.

### Added

- **Template hierarchy**: templates, sections, items, sub-questions, and options. Items carry internal guide notes, media and notes flags, and a cover-photo designation limited to one per template.
- **Snapshot architecture**: every inspection deep-copies the live template with fresh identifiers, so later template edits can never mutate a past visit. See [ADR-001](./05-adrs.md#adr-001).
- Sub-question types: yes/no/N-A, single select, multi select, and free text.
- **The Detached ADU checklist** as editable database rows rather than interface constants: 10 sections, 31 items, 19 sub-questions.
- Inspection records with project, address, assignee, status, and progress counters.
- Per-item responses: completion, notes, and structured answers keyed to snapshot identifiers.
- **Background media upload pipeline** with an IndexedDB-backed queue, so capture never waits for upload and uploads survive reload and backgrounding.
- Private `site-inspection-media` storage bucket with signed-URL reads and no client read policy.
- Streaming zip export with media named by section and item.
- Scoped progressive web app at `/inspections`, installable to a phone home screen without hijacking the rest of Baxter.
- Project picker over the `expense_jobs` list shared with Receipt Log.

### Security

- Row Level Security on every table: authenticated read, service-role write only.
- Storage object policies restrict uploads to each user's own `{auth.uid()}/` prefix.

---

## [1.1.0] — 2026-09-23 — transcription and AI summaries

Migrations `051_site_inspection_ai.sql`, `052_site_inspection_ai_progress.sql`, `053_site_inspection_pdf_export_job.sql`.

### Added

- **Video transcription** after an inspection is marked complete. Audio is extracted with ffmpeg to mono 16 kHz MP3 and transcribed with timestamped segments, so video is never uploaded to the transcription service. See [ADR-010](./05-adrs.md#adr-010).
- A 32 kbps re-encode fallback when extracted audio still exceeds the 25 MB transcription limit.
- **Per-item AI summaries** for checklist items that have video, instructed to use only what was said and written, and explicitly forbidden from inventing findings.
- **Summary fingerprints**: a hash of notes plus ordered video identifiers and transcript outcomes. The regenerate control is absent when the fingerprint matches, and explains in words why a summary is stale when it does not.
- Pipeline progress with distinct transcribing and summarising phases.
- Timestamped transcript display with seek.
- PDF report export, as a background job for large inspections.
- `site_inspection_ai` and `site_inspection_pdf_export` job types.

### Fixed

- **Summaries are gated on every video for an item reaching a terminal transcript state.** Previously a summary could be written while transcription was still running and would claim nothing was said. See [ADR-011](./05-adrs.md#adr-011).
- **Premature-empty repair**: summaries generated before that gate existed say "no spoken content or notes were available" and stay wrong, because their fingerprint legitimately matches the empty snapshot they came from. Such summaries are now detected regardless of fingerprint and regenerated with a flag forbidding the empty-input phrasing. See [ADR-012](./05-adrs.md#adr-012).

---

## [1.1.1] — 2026-09-23 — IndexedDB storage strategy

### Fixed

- **Queued media is stored as Blobs, not ArrayBuffers.** Resident ArrayBuffers pinned hundreds of megabytes in memory and triggered Safari IndexedDB connection reclaim under several large videos. Safari keeps IndexedDB Blobs disk-backed. Legacy rows carrying `bytes` migrate on read.
- **Files are copied once at capture, detaching from the input element.** Holding the live `File` handle went stale on iOS and failed later with no useful error.

See [ADR-003](./05-adrs.md#adr-003).

---

## [1.1.2] — 2026-09-24 — the upload loop

Migrations `049_site_inspection_media_signed_video.sql`, `050_site_inspection_media_poster.sql`.

The hardest week in this module's history. Several distinct field failures, fixed together.

### Fixed

- **Resumable upload authorisation.** Video uploads failed with `Invalid Compact JWS`. Video moved to signed URLs, the same path as photos. Preceded by a duplicated `Authorization` header producing `Bearer x, Bearer x`, and a storage policy that rejected user tokens while the service role worked. The token normaliser that strips a stray `Bearer` prefix and requires three JWT segments dates from here. See [ADR-006](./05-adrs.md#adr-006).
- **Upload size rejections.** The bucket file size limit was removed entirely so large field videos stopped being rejected. The project-wide limit had to be raised in the Supabase dashboard separately. See [ADR-008](./05-adrs.md#adr-008).
- **Completed uploads restarting at 0%.** A progress callback snapshotted a queue row, awaited IndexedDB, and committed that stale snapshot after finalize had deleted the row — resurrecting a finished upload. Fixed with a per-entry write lock, plus a generation counter for Retry all and a cancelled-identifier set. See [ADR-005](./05-adrs.md#adr-005).
- **Phantom "Uploading 0%" on other devices.** Orphaned `pending` and `uploading` rows created at enqueue time before bytes landed were deleted. **Migration 049 is destructive** — do not re-run it against a database with uploads genuinely in flight.
- **Video that would not play in Chrome.** iPhone H.264 in a QuickTime `qt  ` container shows a grey player at 0:00. Videos are now remuxed to MP4 with stream copy and `+faststart` — a container change with no re-encoding, so quality is untouched. See [ADR-009](./05-adrs.md#adr-009).
- **Black video thumbnails.** First-frame JPEG posters stored alongside each video.

### Changed

- Upload concurrency fixed at one. Parallel transfers on a phone were slower in the field and caused progress races. See [ADR-004](./05-adrs.md#adr-004).
- Media type is inferred from the file's MIME type then extension, never from which button was pressed, because "Attach file" accepts both. See [ADR-007](./05-adrs.md#adr-007).

---

## [1.2.0] — 2026-09-28 — Street View covers

Migrations `056_site_inspection_street_view_cover.sql`, `057_site_inspection_address_coordinates.sql`.

### Added

- A **cached Street View cover** fetched once per address at create time, and again if the address changes. List cards read the stored object and never call Google.
- Coordinates captured from address autocomplete, preferred over the address string so no geocoding round trip is needed.
- `site_inspection_street_view_backfill` job for inspections created before covers existed.

### Fixed

- **The metadata endpoint is checked before the image is requested.** The image endpoint returns a grey tile rather than an error when there is no coverage, and a grey tile should never reach a card. See [ADR-013](./05-adrs.md#adr-013).
- A missing Supabase environment variable can no longer turn a cover lookup into a failed inspection create — the Google key resolution falls back to `process.env`.

---

## [1.2.1] — 2026-09-30 — rename

### Changed

- Inspection details, including project and address, are editable after creation.

---

## [1.2.2] — 2026-10-01 — interface improvements

### Changed

- Runner, list, and template editor refinements at phone width.
- Single-request item save with optimistic rollback.
- Typed-DELETE confirmation for destructive actions.

### Fixed

- **Rapid checkbox stale-write race.** Toggling several items quickly could commit an older state after a newer one. Covered by `site-inspection-response-race.test.ts`.

---

## [1.3.0] — 2026-10-02 — photo zoom

### Added

- Click-to-zoom at a point, a zoom slider, and drag-to-pan in the photo viewer, alongside the existing prev/next, rotate, and touch-swipe behaviour.

---

## Earlier

The module first appears in version control on 18 September 2026. Nothing before that is documented; version control is the only source.
