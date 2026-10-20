# Site Inspection Checklist — Specification

Acton ADU · Baxter module documentation

---

## How to read this document

This is the complete specification for the Site Inspection Checklist module, a capability inside Baxter. It records every behaviour the module exhibits today and every gap that should be closed.

Gaps are marked in bold with the prefix **GAP** where they occur, and collected in the final section with severity and owner. This describes the system as it actually is, not as it was intended.

If you are rebuilding this module, read it in order. The [Code Reference](./03-code.md) supplies the implementation.

---

## 1. Module identity

One capability inside Baxter. Shares Baxter's authentication, navigation, database, storage, and background job queue. It additionally installs as a scoped progressive web app so inspectors can run it full-screen from a phone home screen.

**Users:** Acton field inspectors, project staff, and administrators. Any signed-in Baxter user with app access can use every part of it.

**Purpose:** capture a structured site visit in the field — checklist completion, typed notes, structured answers, photos, and video — then transcribe and summarise the video afterwards.

**It replaced Company Cam**, roughly $50 per user per month.

---

## 2. The central architectural idea: snapshots

**Every inspection carries its own frozen copy of the checklist.**

When an inspection is created, the whole live template is deep-copied into the inspection's `snapshot_json`: sections, items, guide notes, media and notes flags, the cover-photo designation, sub-questions, and options. Every copied element gets a **fresh identifier**. The original template identifiers are kept only as provenance fields and are never used for lookup.

Everything downstream keys off snapshot identifiers. Responses are stored against `snapshot_item_id`. Media is attached to `snapshot_item_id`. AI summaries are keyed to `snapshot_item_id`.

**Why.** A site inspection is a record of what was checked on a particular day. If editing the template changed historical inspections, a checklist item added in November would silently appear as "missed" on an inspection from September, and an item reworded would change what a past inspector appeared to have answered. The database comment states the rule plainly: structure lives in the snapshot _"so template edits cannot mutate past visits."_

**Consequences.** Templates can be edited and archived freely without consulting anything historical. The cost is that an inspection cannot pick up a template improvement after it is created, and a checklist structure is duplicated per inspection. Both are correct trades for a historical record. See [ADR-001](./05-adrs.md#adr-001).

---

## 3. Data model

Nine tables and one storage bucket, created by migrations 046 through 057.

### 3.1 Template hierarchy (migration 046)

Five tables, each cascade-deleting into the next.

**`inspection_templates`** — `name`, `description`, `archived_at`, created/updated by. Archived rather than deleted, so past inspections stay meaningful. Unique partial index on name among active templates.

**`inspection_template_sections`** — belongs to a template, has `title` and `sort_order`. Sort order is reindexed `0..n-1` on reorder.

**`inspection_template_items`** — the checklist steps. Belongs to a template, and optionally to a section: **a null `section_id` means a standalone item rendered above all sections**, which is how the cover photo step works. Carries:

- `title`
- `guide_notes` — internal inspector guidance, which the interface must mark as internal-only
- `allows_media`, `allows_notes`
- `is_cover_photo_source` — **at most one per template**, enforced by a unique partial index. The first ready photo on this item becomes the inspection's card image.

**`inspection_template_sub_questions`** — belongs to an item. `prompt` plus `question_type`, one of `yes_no_na`, `single_select`, `multi_select`, `text`.

**`inspection_template_sub_question_options`** — the choices for select-type sub-questions.

### 3.2 Inspection records (migration 047)

**`site_inspections`**

- `project_name`, `address`, both required and non-empty
- `job_id` → `expense_jobs`, the project list shared with Receipt Log. The picker offers only Open projects (Master Project Log column J, `expense_jobs.project_status = 'open'`) and active custom jobs. The server rejects a new link to a Closed or Unknown project, but an inspection may keep a link to a project that has since Closed; the edit dialog shows it as "Current: … (Closed)".
- `assigned_to` → `profiles`
- `source_template_id` → provenance only
- **`snapshot_json`** — the frozen structure
- `status` — `pending` or `complete`
- `cover_media_id` → the chosen photo
- `total_item_count`, `completed_item_count`, with a constraint that completed never exceeds total
- `created_by` — **`on delete restrict`**, so a profile cannot be deleted while it has inspections
- `deleted_at` — soft delete
- Street View fields (056): `street_view_storage_path`, `street_view_address`, `street_view_status`, `street_view_captured_on`
- Coordinates (057): `latitude`, `longitude`, nullable
- AI progress fields (051, 052): status, message, videos total and done, summaries total and done, phase, started and finished timestamps

**`site_inspection_responses`** — one row per snapshotted item, unique on `(inspection_id, snapshot_item_id)`. Holds `is_complete`, `notes`, and `answers`, a map of snapshot sub-question identifier to `{ type, value }` where value is a string, an array of strings, or null.

**`site_inspection_media`** — photo and video attachments keyed to `snapshot_item_id`.

- `storage_path`, `media_type` (`photo` or `video`), `sort_order`
- `upload_status` — `pending` → `uploading` → `ready` or `failed`
- `mime_type`, `byte_size`
- `client_media_id` (048) — the client-generated identifier used to reconcile optimistic interface state with the queue, unique per inspection
- `upload_progress` (048) — 0 to 1, null when idle
- `poster_storage_path` (050) — a first-frame JPEG for videos
- Transcript fields (051): `transcript_status`, `transcript_text`, `transcript_segments`, `transcript_error`, `transcript_updated_at`

`transcript_status` is one of `pending`, `processing`, `complete`, `failed`, `no_speech_detected`. The last is a success, not a failure: a video with no speech is a legitimate outcome and must not be retried forever.

**`site_inspection_item_summaries`** (051) — one AI summary per checklist item that has video, unique on `(inspection_id, snapshot_item_id)`. Holds `summary_text`, `status`, `error`, `generated_at`, and three fields that drive staleness:

- `content_fingerprint` — SHA-256 of the notes, ordered video identifiers, and their transcript outcomes
- `source_notes` and `source_video_ids` — the inputs that produced it, so the interface can say _why_ a summary is stale rather than just that it is

### 3.3 Storage

One private bucket, `site-inspection-media`.

MIME allow-list: JPEG, PNG, WebP, HEIC, HEIF, MP4, QuickTime.

**No file size limit.** Migration 047 set 50 MB; migration 049 removed it entirely so large field videos would stop being rejected.

Object policies grant authenticated users `insert` and `update` on objects under their own `{auth.uid()}/` prefix only. There is no client `select` and no client `delete`; reads go through short-lived signed URLs issued by the server.

### 3.4 Access control

RLS is enabled on all nine tables. Every table follows the same pattern: `authenticated` may `select`, and all client inserts, updates, and deletes are denied. Writes go through the service-role client in server code after a `requireActiveUser()` check.

`site_inspections` additionally filters soft-deleted rows out of reads.

> **GAP:** every signed-in Baxter user can read every inspection, every response, every photo and video, and every transcript. For a small team this may be correct, but it is a default rather than a decision.

> **GAP:** there is no role check on completing or deleting an inspection. Both routes require only an active user. Deleting a site inspection destroys the record of a visit that cannot be repeated without sending someone back to the property. At minimum, deletion should be restricted to administrators or the inspection's creator.

> **GAP:** combined with the removed size limit, the storage upload policy lets any authenticated user write unbounded data under their own prefix. The MIME allow-list constrains file type but not volume. Nothing monitors storage growth.

> **GAP:** no retention or purge policy. Soft delete hides an inspection; its media objects stay in the bucket indefinitely.

---

## 4. User-facing surfaces

| Route                               | Purpose                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| `/inspections`                      | List of inspections, with search, status filter, card and list views |
| `/inspections/[id]`                 | The runner — the checklist itself                                    |
| `/inspections/templates`            | Template list                                                        |
| `/inspections/templates/[id]`       | Template editor                                                      |
| `/inspections/manifest.webmanifest` | Scoped PWA manifest                                                  |

### 4.1 Progressive web app

The manifest is scoped to `/inspections` only, so installing from this page launches standalone on the inspections list without hijacking the rest of Baxter. Display is standalone, orientation portrait.

On iOS, a standalone app has its own cookie jar separate from Safari, so the inspector signs in once inside the installed app and that session persists across launches.

### 4.2 The runner

Each checklist step shows its title, guide notes marked internal-only, a completion checkbox, a notes field, sub-questions, and capture controls.

Notes and answers autosave. Media capture is immediate and does not block.

Marking the inspection complete sets status to `complete` and enqueues the AI job.

---

## 5. The media upload pipeline

This is the most intricate part of the module, and its shape is the result of fixing real field failures. Read [ADR-003](./05-adrs.md#adr-003) through [ADR-006](./05-adrs.md#adr-006) before changing it.

### 5.1 On capture

1. The file is **copied once into a fresh Blob**, detaching it from the input element. Keeping the live `File` handle was an iOS bug: the handle went stale and the upload failed later with no useful error.
2. The Blob is persisted to IndexedDB under the database `baxter-site-inspection-uploads`. **Blobs, not ArrayBuffers** — Safari keeps IndexedDB Blobs disk-backed, whereas resident ArrayBuffers pinned hundreds of megabytes in memory and triggered connection reclaim under several large videos. Legacy rows carrying `bytes` are migrated on read.
3. A queue entry is written with a client-generated identifier, and the interface shows the item optimistically.

Media type is inferred **from the file itself** — MIME first, then extension — never from which button was pressed, because "Attach file" accepts both.

### 5.2 Draining the queue

**One upload at a time.** Parallel transfers on a phone share one connection, were slower in the field, and overlapping progress writes could resurrect a finished upload at zero per cent.

Per-entry state: `queued` → `uploading` → `finalizing` → `uploaded`, or `failed`. Up to **8 attempts** with backoff.

Timings:

| Constant                    | Value | Purpose                                                                   |
| --------------------------- | ----- | ------------------------------------------------------------------------- |
| `UPLOAD_STALL_TIMEOUT_MS`   | 120 s | Fail an upload with no activity                                           |
| `UPLOAD_REQUEST_TIMEOUT_MS` | 90 s  | Ceiling for prepare/complete calls, which have no progress events         |
| `QUEUE_STALL_WATCHDOG_MS`   | 3 min | Surface a stall in the interface and offer Retry all                      |
| `DRAIN_POLL_INTERVAL_MS`    | 15 s  | Periodic tick, recovers when backoff expires or a drain loop exited early |
| `TUS_UPLOAD_TIMEOUT_MS`     | 3 h   | Large video on cell signal                                                |
| `TUS_CHUNK_SIZE_BYTES`      | 6 MiB | **Supabase requires exactly this**; any other value fails                 |

A resumable upload keeps its `tusUploadUrl` so a retry continues at the server's offset rather than byte zero.

### 5.3 Three concurrency defences

Each exists because of a specific observed failure:

1. **A per-entry write lock.** A progress callback snapshots a row, then awaits IndexedDB. Without the lock that stale snapshot commits _after_ finalize deleted the row, resurrecting a finished upload at 0%.
2. **A generation counter**, bumped by Retry all, so superseded handlers cannot corrupt state.
3. **A cancelled-identifier set**, so a cancelled upload is not re-queued or marked failed by a handler already in flight.

### 5.4 Server side

Routes: `prepare` issues a signed upload target, `complete` marks the row ready, `bytes` accepts a direct in-memory upload, `status` reports progress, `signed-urls` issues batch read URLs, `rotate` rotates a photo, and `[mediaId]/file` streams one object.

Reads always go through short-lived signed URLs. The bucket is private and has no client read policy.

### 5.5 Video handling

**Container conversion.** iPhone H.264 often lands in a classic QuickTime `qt  ` brand container that Safari plays and Chrome refuses, showing a grey player stuck at 0:00. Such videos are remuxed to MP4 with `-c copy` and `+faststart` — a container change with **no re-encoding**, so quality is untouched.

**Posters.** A first-frame JPEG is stored alongside each video at `…/id.poster.jpg`, so the gallery shows a frame rather than a black rectangle.

---

## 6. The AI pipeline

Runs as a background job after an inspection is marked complete. The job is **idempotent**: completed transcripts and matching fingerprints are skipped, so re-running costs nothing and loses nothing.

### 6.1 Phase one — transcription

For each ready video, in order:

1. **Extract audio with ffmpeg** — mono, 16 kHz, MP3. Video is never uploaded to the transcription service; only the audio track is, which is what keeps payloads under the 25 MB limit.
2. If the extracted audio still exceeds 25 MB, **re-encode at 32 kbps** and try again. If it is still too large, the video fails with an explicit message.
3. A video with no audio track is marked accordingly rather than retried.
4. Transcribe with Whisper, requesting timestamped segments. Store both the flat text and the segments.

Outcomes are `complete`, `no_speech_detected`, or `failed`. **All three are terminal.** A video with no speech is a legitimate result.

### 6.2 Phase two — summaries

One summary per checklist item that has video.

**Summaries are strictly gated on every video for that item reaching a terminal transcript state.** An item is not summarised while any of its videos is still pending or processing, because a summary written against a half-finished transcript would claim nothing was said.

The summary model is given the item title, the guide notes for context, the inspector's typed notes, and the transcripts. Its instructions:

> Use ONLY what appears in the video transcript(s) and the inspector's typed notes. Do NOT invent findings, measurements, defects, or recommendations that nobody stated.

Two to five sentences, plain language, no headings.

### 6.3 Staleness and regeneration

Each summary stores a fingerprint: a SHA-256 of the trimmed notes plus the ordered video identifiers and their transcript outcomes and text. Adding a video, deleting one, or editing the notes changes the hash.

**The regenerate control is absent when the fingerprint matches** — there is nothing to regenerate. When it differs, the interface explains why, in words, derived by comparing the stored `source_notes` and `source_video_ids` against the current ones: _"a video was added since this summary"_, _"notes changed since this summary"_, and so on.

### 6.4 The premature-empty repair

A specific failure is detected and repaired. If a summary was generated before transcripts were ready, it says some variant of _"no spoken content or notes were available"_ — and then stays wrong, because its fingerprint may legitimately match the empty snapshot it was generated from.

The module detects a summary whose text matches that boilerplate while at least one of the item's videos has usable speech, and treats it as stuck regardless of fingerprint. On regeneration, the summary prompt is passed a flag that explicitly forbids the empty-input phrasing.

> This is a repair for a bug, carried as permanent machinery. It is correct to keep it — the condition is cheap to detect and the failure is invisible to a user who does not know the transcript existed. It is worth knowing it is there.

### 6.5 Model configuration

Transcription uses `whisper-1`. Summaries use `OPENAI_MODEL`, defaulting to `gpt-4o-mini`, at temperature 0.2 with a 400-token ceiling.

> **GAP:** the summary model falls back to a hardcoded `gpt-4o-mini` rather than Baxter's configured default. That is a deliberate cost choice for a short grounded summary, but it is undocumented in the code and will silently persist if Baxter's model configuration moves on.

> **GAP:** AI summary quality is unmeasured. The grounding instruction is strong and the premature-empty case is handled, but nobody has compared a set of summaries against what the inspector would have written. The summaries are read-only reference, which bounds the risk, but accuracy is unknown. See the [Test Plan](./06-test-plan-and-eval.md#proposed-evaluation-set).

---

## 7. Street View covers

A list card needs an image even before any photo is taken.

At create time, and again if the address changes, the module fetches a Street View image once and stores the JPEG. **The metadata endpoint is checked before the image request** — skipping that check returns a grey tile, which should never appear on a card.

Coordinates from address autocomplete are preferred when available; otherwise the address string is passed directly, avoiding a geocoding round trip. Status is `available` or `unavailable`, and the capture date is recorded.

List cards read the stored object. **They never call Google.** A background backfill job (057) fills covers for inspections created before this existed.

A cover-photo-source item's first ready photo takes precedence over the Street View image.

---

## 8. Exports

**Zip** — streams media named `section__item__photo_01.jpg`, with AI notes included as text files. Above **200 MB** the export offers photos only rather than failing mid-stream. `maxDuration` 300 seconds.

**PDF** — a rendered report. Large inspections run it as a background job (053).

> **GAP:** the 200 MB zip threshold is acknowledged in the code as something large videos will hit often. An inspection with substantial video cannot be exported whole. There is no alternative path — no chunked export, no direct links — so an inspector who needs the full set must fetch items individually.

---

## 9. Background jobs

Three job types on Baxter's shared durable queue:

| Job type                               | Purpose                                 | Added |
| -------------------------------------- | --------------------------------------- | ----- |
| `site_inspection_ai`                   | Transcribe and summarise after complete | 051   |
| `site_inspection_pdf_export`           | PDF export for large inspections        | 053   |
| `site_inspection_street_view_backfill` | Backfill covers for older inspections   | 057   |

The AI job is enqueued on complete and also dispatched inline via `after()`, with the queue acting as the backup path. Enqueueing checks for an existing queued or running job for the same inspection and reuses it unless forced.

> **GAP:** there is no sweeper for an AI job that dies mid-flight. The inspection stays in `processing` with a progress message that will never advance. Regenerating a summary is the manual recovery.

---

## 10. Gaps to resolve

| #   | Gap                                                                     | Severity | Blocks launch | Owner | Status |
| --- | ----------------------------------------------------------------------- | -------- | ------------- | ----- | ------ |
| 1   | No module owner named                                                   | High     | Yes           | —     | Open   |
| 2   | Any authenticated user can complete or delete any inspection            | High     | Yes           | —     | Open   |
| 3   | No storage size limit, no retention policy, no storage monitoring       | High     | Yes           | —     | Open   |
| 4   | AI summary quality unmeasured                                           | Medium   | No            | —     | Open   |
| 5   | No monitoring of upload failures, transcription failures, or job health | Medium   | No            | —     | Open   |
| 6   | ffmpeg availability not verified at startup or surfaced in diagnostics  | Medium   | No            | —     | Open   |
| 7   | Stuck AI jobs are never swept                                           | Medium   | No            | —     | Open   |
| 8   | Zip export cannot include large video                                   | Low      | No            | —     | Open   |
| 9   | Every authenticated user reads every inspection and all its media       | Low      | No            | —     | Open   |
| 10  | Summary model fallback hardcoded, diverging from Baxter's configuration | Low      | No            | —     | Open   |

**Gaps 1 through 3 should be closed first.** Gap 1 blocks the rest. Gap 2 is the one most likely to cause irreversible loss — a deleted inspection means another site visit. Gap 3 is unbounded by construction and nobody is watching it.

---

## 11. Rebuilding this module

1. Apply migrations 046 through 057 in order. Reproduced verbatim in the [Code Reference](./03-code.md#migrations).
2. Build the types and schemas, then **the snapshot module** — it is small, pure, and the foundation of everything else. Test it first.
3. Build the template store and the template editor. Seed the Detached ADU template as editable database rows, not interface constants.
4. Build the records store, the runner, autosave, and response sync.
5. **Build the media queue.** Budget the most time here, and read [ADR-003](./05-adrs.md#adr-003) through [ADR-006](./05-adrs.md#adr-006) first — the three concurrency defences and the Blob-over-ArrayBuffer choice each exist because of a specific field failure, and each is easy to drop by accident.
6. Build the server media routes, signed URL issuance, remuxing, and posters.
7. Build the AI pipeline: audio extraction, transcription, the transcript gate, fingerprints, summaries.
8. Build Street View covers, then exports.

Verify on a real phone on real cell signal, not on desktop. Every upload bug this module has had was invisible on a desktop browser with good wifi.
