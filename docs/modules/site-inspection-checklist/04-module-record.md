# Site Inspection Checklist — Module Record

The single-page source of truth. Everything here should be checkable in under a minute.

---

## Identity

| Field                   | Value                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Module name             | Site Inspection Checklist                                                                    |
| Short name              | Site Inspections                                                                             |
| Registry key            | `site-inspections` (in `src/lib/baxter/tools.ts`)                                            |
| Type                    | Baxter capability, plus a scoped progressive web app                                         |
| Status                  | In production field use                                                                      |
| Risk tier               | **High** — primary capture tool for work that cannot be repeated without a second site visit |
| Replaces                | Company Cam, roughly **$50 per user per month**                                              |
| First shipped           | Migration 046, mid-2026                                                                      |
| Last substantive change | Migration 057 — address coordinates and Street View backfill                                 |

## Ownership

| Role                    | Person              | Responsibility                                                           |
| ----------------------- | ------------------- | ------------------------------------------------------------------------ |
| Module owner            | **GAP — not named** | Checklist content, AI summary quality, cost, storage growth, gap closure |
| Technical owner         | **GAP — not named** | Code, upload pipeline, AI pipeline, incidents                            |
| Checklist content owner | **GAP — not named** | The Detached ADU template and any others — Acton's field methodology     |
| Approver                | **GAP — not named** | Signs off changes to checklist structure                                 |

> Naming an owner is gap 1 in the [Specification](./02-specification.md#gaps-to-resolve) and blocks the rest. The sensible split is a field or operations lead owning the checklist content and a technical owner owning the pipelines.

## Users

Acton field inspectors, project staff, and administrators. **Any signed-in Baxter user can create, read, edit, complete, and delete any inspection.** There is no role gate on completion or deletion — gap 2.

## Where things live

| Thing                        | Location                                             |
| ---------------------------- | ---------------------------------------------------- |
| Core code                    | `src/lib/inspections/`                               |
| AI pipeline                  | `src/lib/inspections/ai/`                            |
| Pages                        | `src/app/inspections/`                               |
| API routes                   | `src/app/api/inspections/`                           |
| Components                   | `src/components/inspections/`                        |
| Database tables              | 9 — see below                                        |
| Storage bucket               | `site-inspection-media` (private, no size limit)     |
| Migrations                   | 046, 047, 048, 049, 050, 051, 052, 053, 056, 057     |
| **Live checklist templates** | **Database — editable rows, not in version control** |
| Seed template                | `src/lib/inspections/detached-adu-seed.ts`           |
| Tests                        | `tests/unit/site-inspection-*`                       |

### Tables

| Table                                      | Purpose                                             |
| ------------------------------------------ | --------------------------------------------------- |
| `inspection_templates`                     | Reusable checklists, archived not deleted           |
| `inspection_template_sections`             | Sections within a template                          |
| `inspection_template_items`                | Checklist steps; null `section_id` means standalone |
| `inspection_template_sub_questions`        | Structured questions on an item                     |
| `inspection_template_sub_question_options` | Choices for select-type questions                   |
| `site_inspections`                         | A visit, carrying its frozen `snapshot_json`        |
| `site_inspection_responses`                | Per-item completion, notes, and answers             |
| `site_inspection_media`                    | Photos and video, with transcripts                  |
| `site_inspection_item_summaries`           | AI summary per item that has video                  |

### Background job types

`site_inspection_ai`, `site_inspection_pdf_export`, `site_inspection_street_view_backfill` — all on Baxter's shared durable queue.

## Configuration

| Variable                                 | Purpose                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                         | Transcription and summaries. Without it both fail                            |
| `OPENAI_MODEL`                           | Summary model; **falls back to a hardcoded `gpt-4o-mini`**                   |
| `GOOGLE_MAPS_SERVER_API_KEY`             | Street View covers. Falls back to `GOOGLE_MAPS_API_KEY`, then the public key |
| Supabase URL, anon key, service-role key | Database and storage                                                         |

**Runtime binary:** `ffmpeg`, via `ffmpeg-static`. Required for audio extraction and video remuxing. If absent, transcription fails and some videos stay unplayable in Chrome. Not verified at startup — gap 6.

## Key constants

| Constant                    | Value    | Why                                                                 |
| --------------------------- | -------- | ------------------------------------------------------------------- |
| `TUS_CHUNK_SIZE_BYTES`      | 6 MiB    | **Supabase requires exactly this**                                  |
| `MEDIA_UPLOAD_CONCURRENCY`  | 1        | Parallel transfers were slower on a phone and caused progress races |
| `MAX_UPLOAD_ATTEMPTS`       | 8        | —                                                                   |
| `UPLOAD_STALL_TIMEOUT_MS`   | 120 s    | Fail an upload with no activity                                     |
| `QUEUE_STALL_WATCHDOG_MS`   | 3 min    | Surface a stall, offer Retry all                                    |
| `TUS_UPLOAD_TIMEOUT_MS`     | 3 h      | Large video on cell signal                                          |
| `WHISPER_UPLOAD_MAX_BYTES`  | 25 MB    | Transcription service limit                                         |
| `ZIP_FULL_EXPORT_MAX_BYTES` | 200 MB   | Above this, photos only                                             |
| Storage file size limit     | **none** | Removed in 049 so field video stopped being rejected                |

## Cost

Per completed inspection: one audio extraction and one transcription per video, plus one short summary per checklist item that has video. Audio is extracted and compressed before transcription, so cost scales with recording duration rather than file size.

Storage grows without bound and is never purged.

**Nothing is monitored.** The [Runbook](./08-runbook.md) has the queries.

## Dependencies and blast radius

**This module depends on:** Supabase (Postgres, RLS, Storage), OpenAI, Google Street View, ffmpeg, the Baxter durable job queue, Baxter authentication, and the shared `expense_jobs` project list.

**Shares with Receipt Log:** the `expense_jobs` project list. A change to that table affects both modules.

**Nothing depends on this module.** No other Baxter capability reads inspection data. If it stops working, nothing else breaks — but field work stops being captured.

## Open gaps

Three launch-blocking, ten total. See the [Specification](./02-specification.md#gaps-to-resolve).

The three that matter most: no owner named; any authenticated user can complete or delete any inspection; and no storage limit, retention policy, or monitoring on a bucket that grows without bound.

## Review

| Activity                             | Cadence                | Last done                              |
| ------------------------------------ | ---------------------- | -------------------------------------- |
| Documentation review                 | Quarterly              | **Never** — this document is the first |
| AI summary quality review            | **Not established**    | **Never**                              |
| Storage growth review                | **Not established**    | **Never**                              |
| Export live templates to this folder | Quarterly              | **Never**                              |
| Field verification on a real phone   | Per upload-path change | Ad hoc                                 |
