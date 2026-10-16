# Site Inspection Checklist — Code Reference

Acton ADU · Baxter module documentation · Generated from the repository

---

## How to use this document

This is the copy-and-paste companion to the [Specification](./02-specification.md). It contains the complete inventory of every file in the module, and the verbatim text of the artifacts that cannot be reconstructed from the specification alone.

Reproduced in full here:

1. **The database migrations** — schema, constraints, indexes, storage policies, and the one destructive data migration.
2. **The snapshot module** — small, pure, and the foundation the whole module rests on.
3. **Media limits and naming** — the upload constants that were each set for a reason, with those reasons in the comments.
4. **The transcript gate** — the rules that stop a summary being written against a half-finished transcript.
5. **Video remuxing** — the fix for video Chrome refuses to play.
6. **Fingerprinting** — what makes a summary stale.

Everything else is listed with its path, size, and responsibility. The last section gives the commands to extract a complete current bundle.

---

## Dependencies

| Package                 | Used for                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `tus-js-client`         | Resumable chunked uploads for large video                                             |
| `ffmpeg-static`         | Audio extraction for transcription, and QuickTime to MP4 remuxing                     |
| `archiver`              | Streaming zip export — **v8 exports `ZipArchive` as a class**, not a callable factory |
| `@react-pdf/renderer`   | PDF report export                                                                     |
| `@supabase/supabase-js` | Database and storage                                                                  |
| `zod`                   | Input and record validation                                                           |
| `@dnd-kit/*`            | Template editor reordering                                                            |

External services: **OpenAI** (`whisper-1` for transcription, `gpt-4o-mini` by default for summaries) and **Google Street View Static API** plus its metadata endpoint.

Browser APIs the module depends on: **IndexedDB** for the durable upload queue, and the **File** and **Blob** APIs for detached capture copies.

Internal Baxter modules: `@/lib/auth/session`, `@/lib/errors`, `@/lib/jobs/*`, `@/lib/env`, `@/lib/supabase/*`, `@/lib/receipts/client-image` (shared image processing).

---

## File manifest

### Core module — `src/lib/inspections/`

| File                      | Lines | Responsibility                                                                                                                                                                               |
| ------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `records-store.ts`        | 2306  | Inspection records: create with snapshot, read, list, update responses, media rows, completion, soft delete, progress counters. The largest file in the module.                              |
| `media-queue.ts`          | 2158  | The durable client-side upload queue. IndexedDB-backed Blobs, one-at-a-time drain, resumable uploads, stall detection, and the three concurrency defences. Read the ADRs before changing it. |
| `store.ts`                | 1863  | Template store: templates, sections, items, sub-questions, options, reordering, archiving, and seeding.                                                                                      |
| `detached-adu-seed.ts`    | 317   | The canonical Detached ADU checklist, inserted as editable database rows rather than interface constants. 10 sections, 31 items, 19 sub-questions.                                           |
| `media-storage.ts`        | 311   | Server-side storage: signed upload targets, signed read URLs in batch, byte download, Chrome-playable video conversion, object deletion.                                                     |
| `record-types.ts`         | 193   | Status unions, media types, transcript statuses, AI phases, and the record shapes.                                                                                                           |
| `media-limits.ts`         | 192   | Upload constants and naming. Every value here has a comment explaining why it is that value. Reproduced verbatim below.                                                                      |
| `photo-zoom.ts`           | 165   | Zoom and pan maths for the photo viewer: click-to-point, clamping, bounds.                                                                                                                   |
| `street-view-cover.ts`    | 164   | Street View cover lookup. Checks the metadata endpoint before requesting the image so a grey tile never reaches a card.                                                                      |
| `schemas.ts`              | 155   | Zod schemas for template input.                                                                                                                                                              |
| `snapshot.ts`             | 153   | The frozen checklist copy. Deep-copies a live template with fresh identifiers. Reproduced verbatim below.                                                                                    |
| `video-poster.ts`         | 137   | Client-side first-frame poster capture.                                                                                                                                                      |
| `index.ts`                | 134   | Public exports.                                                                                                                                                                              |
| `record-schemas.ts`       | 114   | Zod schemas for inspection records and responses.                                                                                                                                            |
| `types.ts`                | 96    | Template-side types.                                                                                                                                                                         |
| `video-poster-server.ts`  | 86    | Server-side poster generation.                                                                                                                                                               |
| `street-view-backfill.ts` | 86    | Background backfill of covers for inspections created before covers existed.                                                                                                                 |
| `client-autosave.ts`      | 86    | Debounced autosave for notes and answers.                                                                                                                                                    |
| `response-sync.ts`        | 81    | Response synchronisation and conflict handling.                                                                                                                                              |
| `video-remux.ts`          | 64    | QuickTime to MP4 remux without re-encoding. Reproduced verbatim below.                                                                                                                       |
| `ensure-video-poster.ts`  | 63    | Ensures a video has a poster, generating one if absent.                                                                                                                                      |
| `view-preference.ts`      | 30    | Card versus list view preference.                                                                                                                                                            |
| `project-label.ts`        | 19    | Project display label helper.                                                                                                                                                                |

### AI pipeline — `src/lib/inspections/ai/`

| File                   | Lines | Responsibility                                                                                                                 |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| `export-pdf.tsx`       | 650   | PDF report rendering with @react-pdf/renderer.                                                                                 |
| `run-job.ts`           | 555   | The AI job: audio extraction, transcription, gating, per-item summaries, progress, and the premature-empty repair. Idempotent. |
| `store.ts`             | 306   | AI persistence: transcript updates, summary upserts, progress patches.                                                         |
| `summarize.ts`         | 135   | Per-item summary with the grounding rules. Reproduced verbatim below.                                                          |
| `audio-extract.ts`     | 131   | ffmpeg audio extraction, mono 16 kHz MP3, with a 32 kbps re-encode fallback under the 25 MB transcription cap.                 |
| `export-text.ts`       | 129   | AI notes as text files for the zip export.                                                                                     |
| `enqueue.ts`           | 114   | Enqueues the AI job on complete, reusing an active job unless forced. Inline via after(), with the queue as backup.            |
| `transcribe.ts`        | 106   | Whisper transcription with timestamped segments.                                                                               |
| `pipeline-progress.ts` | 82    | Progress calculation for the single pipeline progress bar.                                                                     |
| `transcript-gate.ts`   | 76    | Terminal-status gating and premature-empty detection. Reproduced verbatim below.                                               |
| `fingerprint.ts`       | 62    | Summary fingerprint and the stale-reason wording. Reproduced verbatim below.                                                   |

### Components — `src/components/inspections/`

| Component                             | Lines | Responsibility                                                          |
| ------------------------------------- | ----- | ----------------------------------------------------------------------- |
| `inspection-runner-client.tsx`        | 1783  | The runner: checklist, autosave, capture, queue integration, completion |
| `template-editor-client.tsx`          | 1140  | Template editor: sections, items, sub-questions, reordering             |
| `inspections-list-client.tsx`         | 724   | List and card views, search, status filter                              |
| `template-item-modal.tsx`             | 662   | Item editing with guide notes and sub-questions                         |
| `inspection-media-gallery.tsx`        | 519   | Media viewer: prev/next, rotate, delete, signed-URL refresh             |
| `photo-zoom-stage.tsx`                | 498   | Photo zoom and pan                                                      |
| `templates-list-client.tsx`           | 277   | Template list and archiving                                             |
| `inspection-upload-queue-bar.tsx`     | 251   | Live upload progress, stall warning, Retry all                          |
| `edit-inspection-dialog.tsx`          | 224   | Edit project, address, assignee                                         |
| `inspection-project-picker.tsx`       | 173   | Project picker over the shared `expense_jobs` list                      |
| `inspection-ai-summary.tsx`           | 147   | Summary display with stale reason and regenerate                        |
| `inspection-ai-pipeline-progress.tsx` | 125   | Transcription and summarisation progress                                |
| `inspection-video-transcript.tsx`     | 90    | Timestamped transcript with seek                                        |
| `inspections-shell.tsx`               | 82    | Shared layout                                                           |
| `inspections-page-client.tsx`         | 63    | Page composition                                                        |
| `inspection-view-toggle.tsx`          | 14    | Card/list toggle                                                        |

### API routes — `src/app/api/inspections/`

| Route                                | Methods            | Responsibility                                           |
| ------------------------------------ | ------------------ | -------------------------------------------------------- |
| `route.ts`                           | GET, POST          | List; create with snapshot and Street View cover         |
| `[id]/route.ts`                      | GET, PATCH, DELETE | Fetch; update fields, responses, completion; soft delete |
| `[id]/media/route.ts`                | GET, POST, DELETE  | Media rows                                               |
| `[id]/media/prepare/route.ts`        | POST               | Issue a signed upload target                             |
| `[id]/media/complete/route.ts`       | POST               | Mark a row ready after bytes land                        |
| `[id]/media/bytes/route.ts`          | POST               | Direct in-memory upload path                             |
| `[id]/media/status/route.ts`         | GET                | Upload progress poll                                     |
| `[id]/media/signed-urls/route.ts`    | POST               | Batch signed read URLs                                   |
| `[id]/media/rotate/route.ts`         | POST               | Rotate a photo                                           |
| `[id]/media/[mediaId]/file/route.ts` | GET                | Stream one object                                        |
| `[id]/export/route.ts`               | GET                | Streaming zip. `runtime = "nodejs"`, `maxDuration = 300` |
| `[id]/export-pdf/route.ts`           | GET/POST           | PDF report, background job for large inspections         |
| `[id]/summaries/regenerate/route.ts` | POST               | Regenerate one item summary                              |
| `templates/route.ts`                 | GET, POST          | Template list and create                                 |
| `templates/[id]/route.ts`            | GET, PATCH, DELETE | Template detail, edit, archive                           |

### Pages — `src/app/inspections/`

| Page                            | Responsibility          |
| ------------------------------- | ----------------------- |
| `page.tsx`                      | Inspection list         |
| `[id]/page.tsx`                 | The runner              |
| `templates/page.tsx`            | Template list           |
| `templates/[id]/page.tsx`       | Template editor         |
| `layout.tsx`                    | Layout and PWA metadata |
| `manifest.webmanifest/route.ts` | Scoped PWA manifest     |

---

## Migrations

Apply in order. Migration numbers are global across Baxter, so gaps are other modules' migrations.

> **Migration 049 is destructive.** It deletes every `pending` and `uploading` media row. That was correct at the time — those rows were orphans created at enqueue time before bytes ever landed, which showed as phantom "Uploading 0%" entries on other devices. Do not re-run it against a database with uploads genuinely in flight.

### `046_site_inspection_templates.sql`

```sql
-- Site Inspection Checklist — template hierarchy (runner/responses in a later migration).
-- Shared project list remains public.expense_jobs (Receipt Log + future inspection project picker).

comment on table public.expense_jobs is
  'Shared project list for Receipt Log and Site Inspection Checklist. Project rows sync from Master Project Log; custom rows are admin-managed.';

-- ---------------------------------------------------------------------------
-- inspection_templates
-- ---------------------------------------------------------------------------
create table if not exists public.inspection_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inspection_templates_name_required check (length(trim(name)) > 0)
);

create index if not exists inspection_templates_active_name_idx
  on public.inspection_templates (name)
  where archived_at is null;

create index if not exists inspection_templates_archived_idx
  on public.inspection_templates (archived_at);

create trigger inspection_templates_set_updated_at
  before update on public.inspection_templates
  for each row execute function public.set_updated_at();

comment on table public.inspection_templates is
  'Reusable site inspection checklist templates. Archive (soft-delete) instead of hard-delete so past inspections stay meaningful.';
comment on column public.inspection_templates.archived_at is
  'Null = active. Set when retiring a template; structure remains readable.';

alter table public.inspection_templates enable row level security;

create policy "Authenticated users can read inspection templates"
  on public.inspection_templates for select
  to authenticated
  using (true);

create policy "No client insert inspection templates"
  on public.inspection_templates for insert
  to authenticated
  with check (false);

create policy "No client update inspection templates"
  on public.inspection_templates for update
  to authenticated
  using (false);

create policy "No client delete inspection templates"
  on public.inspection_templates for delete
  to authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- inspection_template_sections
-- ---------------------------------------------------------------------------
create table if not exists public.inspection_template_sections (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.inspection_templates (id) on delete cascade,
  title text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inspection_template_sections_title_required check (length(trim(title)) > 0)
);

create index if not exists inspection_template_sections_template_sort_idx
  on public.inspection_template_sections (template_id, sort_order);

create trigger inspection_template_sections_set_updated_at
  before update on public.inspection_template_sections
  for each row execute function public.set_updated_at();

comment on column public.inspection_template_sections.sort_order is
  'Stable display order within a template. Lower sorts first. Reindexed 0..n-1 on reorder.';

alter table public.inspection_template_sections enable row level security;

create policy "Authenticated users can read inspection template sections"
  on public.inspection_template_sections for select
  to authenticated
  using (true);

create policy "No client insert inspection template sections"
  on public.inspection_template_sections for insert
  to authenticated
  with check (false);

create policy "No client update inspection template sections"
  on public.inspection_template_sections for update
  to authenticated
  using (false);

create policy "No client delete inspection template sections"
  on public.inspection_template_sections for delete
  to authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- inspection_template_items
-- ---------------------------------------------------------------------------
create table if not exists public.inspection_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.inspection_templates (id) on delete cascade,
  -- Null = standalone item (e.g. cover photo) rendered above sections.
  section_id uuid references public.inspection_template_sections (id) on delete cascade,
  title text not null,
  guide_notes text not null default '',
  allows_media boolean not null default true,
  allows_notes boolean not null default true,
  is_cover_photo_source boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inspection_template_items_title_required check (length(trim(title)) > 0)
);

create index if not exists inspection_template_items_template_sort_idx
  on public.inspection_template_items (template_id, sort_order);

create index if not exists inspection_template_items_section_sort_idx
  on public.inspection_template_items (section_id, sort_order)
  where section_id is not null;

-- At most one cover-photo source item per template.
create unique index if not exists inspection_template_items_cover_photo_uidx
  on public.inspection_template_items (template_id)
  where is_cover_photo_source = true;

create trigger inspection_template_items_set_updated_at
  before update on public.inspection_template_items
  for each row execute function public.set_updated_at();

comment on table public.inspection_template_items is
  'Composite checklist items: title, internal guide notes, completion checkbox, optional media/notes, sub-questions.';
comment on column public.inspection_template_items.guide_notes is
  'Internal inspector guidance — UI must mark as internal-only.';
comment on column public.inspection_template_items.allows_media is
  'Schema hook for photo/video attachments (upload pipeline in a later prompt).';
comment on column public.inspection_template_items.is_cover_photo_source is
  'When true, first uploaded photo on this item becomes the inspection card image (later prompt).';
comment on column public.inspection_template_items.sort_order is
  'Order among siblings (same section_id, or all standalone items when section_id is null).';

alter table public.inspection_template_items enable row level security;

create policy "Authenticated users can read inspection template items"
  on public.inspection_template_items for select
  to authenticated
  using (true);

create policy "No client insert inspection template items"
  on public.inspection_template_items for insert
  to authenticated
  with check (false);

create policy "No client update inspection template items"
  on public.inspection_template_items for update
  to authenticated
  using (false);

create policy "No client delete inspection template items"
  on public.inspection_template_items for delete
  to authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- inspection_template_sub_questions
-- ---------------------------------------------------------------------------
create table if not exists public.inspection_template_sub_questions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inspection_template_items (id) on delete cascade,
  prompt text not null,
  question_type text not null
    check (question_type in ('yes_no_na', 'single_select', 'multi_select', 'text')),
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inspection_template_sub_questions_prompt_required check (length(trim(prompt)) > 0)
);

create index if not exists inspection_template_sub_questions_item_sort_idx
  on public.inspection_template_sub_questions (item_id, sort_order);

create trigger inspection_template_sub_questions_set_updated_at
  before update on public.inspection_template_sub_questions
  for each row execute function public.set_updated_at();

comment on column public.inspection_template_sub_questions.sort_order is
  'Stable order within an item. Lower sorts first.';

alter table public.inspection_template_sub_questions enable row level security;

create policy "Authenticated users can read inspection template sub questions"
  on public.inspection_template_sub_questions for select
  to authenticated
  using (true);

create policy "No client insert inspection template sub questions"
  on public.inspection_template_sub_questions for insert
  to authenticated
  with check (false);

create policy "No client update inspection template sub questions"
  on public.inspection_template_sub_questions for update
  to authenticated
  using (false);

create policy "No client delete inspection template sub questions"
  on public.inspection_template_sub_questions for delete
  to authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- inspection_template_sub_question_options
-- ---------------------------------------------------------------------------
create table if not exists public.inspection_template_sub_question_options (
  id uuid primary key default gen_random_uuid(),
  sub_question_id uuid not null
    references public.inspection_template_sub_questions (id) on delete cascade,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inspection_template_sub_question_options_label_required check (length(trim(label)) > 0)
);

create index if not exists inspection_template_sub_question_options_sort_idx
  on public.inspection_template_sub_question_options (sub_question_id, sort_order);

create trigger inspection_template_sub_question_options_set_updated_at
  before update on public.inspection_template_sub_question_options
  for each row execute function public.set_updated_at();

comment on column public.inspection_template_sub_question_options.sort_order is
  'Stable option order for single_select / multi_select. Lower sorts first.';

alter table public.inspection_template_sub_question_options enable row level security;

create policy "Authenticated users can read inspection template sub question options"
  on public.inspection_template_sub_question_options for select
  to authenticated
  using (true);

create policy "No client insert inspection template sub question options"
  on public.inspection_template_sub_question_options for insert
  to authenticated
  with check (false);

create policy "No client update inspection template sub question options"
  on public.inspection_template_sub_question_options for update
  to authenticated
  using (false);

create policy "No client delete inspection template sub question options"
  on public.inspection_template_sub_question_options for delete
  to authenticated
  using (false);
```

### `047_site_inspection_records.sql`

```sql
-- Site Inspection Checklist — inspection records, responses, and media attachment points.
-- Template tables remain in 046. Runner media queue / zip export land in a later migration.

-- ---------------------------------------------------------------------------
-- Private storage bucket for inspection media (interim photo path + future queue)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-inspection-media',
  'site-inspection-media',
  false,
  52428800,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime'
  ]
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public = false;

drop policy if exists "No client read site inspection media" on storage.objects;
create policy "No client read site inspection media"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'site-inspection-media' and false);

drop policy if exists "No client insert site inspection media" on storage.objects;
create policy "No client insert site inspection media"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'site-inspection-media' and false);

drop policy if exists "No client update site inspection media" on storage.objects;
create policy "No client update site inspection media"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'site-inspection-media' and false);

drop policy if exists "No client delete site inspection media" on storage.objects;
create policy "No client delete site inspection media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'site-inspection-media' and false);

-- ---------------------------------------------------------------------------
-- site_inspections
-- ---------------------------------------------------------------------------
create table if not exists public.site_inspections (
  id uuid primary key default gen_random_uuid(),
  project_name text not null,
  address text not null,
  job_id uuid references public.expense_jobs (id) on delete set null,
  assigned_to uuid references public.profiles (id) on delete set null,
  -- Reference only — structure lives in snapshot_json so template edits cannot mutate past visits.
  source_template_id uuid references public.inspection_templates (id) on delete set null,
  snapshot_json jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'complete')),
  cover_media_id uuid,
  total_item_count integer not null default 0 check (total_item_count >= 0),
  completed_item_count integer not null default 0 check (completed_item_count >= 0),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint site_inspections_project_name_required check (length(trim(project_name)) > 0),
  constraint site_inspections_address_required check (length(trim(address)) > 0),
  constraint site_inspections_progress_bounds check (completed_item_count <= total_item_count)
);

create index if not exists site_inspections_created_at_idx
  on public.site_inspections (created_at desc)
  where deleted_at is null;

create index if not exists site_inspections_status_idx
  on public.site_inspections (status)
  where deleted_at is null;

create index if not exists site_inspections_project_name_idx
  on public.site_inspections (lower(project_name))
  where deleted_at is null;

create index if not exists site_inspections_assigned_to_idx
  on public.site_inspections (assigned_to)
  where deleted_at is null;

create trigger site_inspections_set_updated_at
  before update on public.site_inspections
  for each row execute function public.set_updated_at();

comment on table public.site_inspections is
  'Field site inspection visits. snapshot_json freezes the checklist at create time.';
comment on column public.site_inspections.snapshot_json is
  'Full copied template structure (sections/items/sub-questions/options). Never re-read from live templates.';
comment on column public.site_inspections.source_template_id is
  'Provenance only. Edits to the live template must not mutate this row.';
comment on column public.site_inspections.cover_media_id is
  'First ready photo on the cover-photo-source item (card image).';

alter table public.site_inspections enable row level security;

-- Shared team record: any authenticated Acton user can read non-deleted inspections.
create policy "Authenticated users can read site inspections"
  on public.site_inspections for select
  to authenticated
  using (deleted_at is null);

create policy "No client insert site inspections"
  on public.site_inspections for insert
  to authenticated
  with check (false);

create policy "No client update site inspections"
  on public.site_inspections for update
  to authenticated
  using (false);

create policy "No client delete site inspections"
  on public.site_inspections for delete
  to authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- site_inspection_responses — one row per snapshotted item
-- ---------------------------------------------------------------------------
create table if not exists public.site_inspection_responses (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.site_inspections (id) on delete cascade,
  snapshot_item_id uuid not null,
  is_complete boolean not null default false,
  notes text not null default '',
  -- Map of snapshot_sub_question_id → { type, value } (string | string[] | null)
  answers jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint site_inspection_responses_item_unique unique (inspection_id, snapshot_item_id)
);

create index if not exists site_inspection_responses_inspection_idx
  on public.site_inspection_responses (inspection_id);

create trigger site_inspection_responses_set_updated_at
  before update on public.site_inspection_responses
  for each row execute function public.set_updated_at();

comment on table public.site_inspection_responses is
  'Per-item answers for a snapshotted checklist. Keys are snapshot ids, never live template ids.';

alter table public.site_inspection_responses enable row level security;

create policy "Authenticated users can read site inspection responses"
  on public.site_inspection_responses for select
  to authenticated
  using (true);

create policy "No client insert site inspection responses"
  on public.site_inspection_responses for insert
  to authenticated
  with check (false);

create policy "No client update site inspection responses"
  on public.site_inspection_responses for update
  to authenticated
  using (false);

create policy "No client delete site inspection responses"
  on public.site_inspection_responses for delete
  to authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- site_inspection_media — attachment points for the interim upload + future queue
-- ---------------------------------------------------------------------------
create table if not exists public.site_inspection_media (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.site_inspections (id) on delete cascade,
  snapshot_item_id uuid not null,
  storage_path text,
  media_type text not null default 'photo'
    check (media_type in ('photo', 'video')),
  sort_order integer not null default 0,
  -- pending/uploading/failed reserved for the background queue; interim sync path writes ready.
  upload_status text not null default 'ready'
    check (upload_status in ('pending', 'uploading', 'ready', 'failed')),
  mime_type text,
  byte_size integer,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists site_inspection_media_item_sort_idx
  on public.site_inspection_media (inspection_id, snapshot_item_id, sort_order);

create index if not exists site_inspection_media_status_idx
  on public.site_inspection_media (upload_status);

create trigger site_inspection_media_set_updated_at
  before update on public.site_inspection_media
  for each row execute function public.set_updated_at();

comment on table public.site_inspection_media is
  'Photo/video attachments keyed to snapshotted items. Interim sync upload writes ready rows; next prompt swaps in a background queue writing the same columns.';
comment on column public.site_inspection_media.upload_status is
  'Queue lifecycle. Interim path: ready after upload. Future: pending → uploading → ready|failed.';

alter table public.site_inspection_media enable row level security;

create policy "Authenticated users can read site inspection media"
  on public.site_inspection_media for select
  to authenticated
  using (true);

create policy "No client insert site inspection media"
  on public.site_inspection_media for insert
  to authenticated
  with check (false);

create policy "No client update site inspection media"
  on public.site_inspection_media for update
  to authenticated
  using (false);

create policy "No client delete site inspection media"
  on public.site_inspection_media for delete
  to authenticated
  using (false);

-- Cover media FK after both tables exist.
alter table public.site_inspections
  drop constraint if exists site_inspections_cover_media_fk;

alter table public.site_inspections
  add constraint site_inspections_cover_media_fk
  foreign key (cover_media_id)
  references public.site_inspection_media (id)
  on delete set null;
```

### `048_site_inspection_media_pipeline.sql`

```sql
-- Site inspection media pipeline: client media ids + authenticated direct-to-storage uploads.

alter table public.site_inspection_media
  add column if not exists client_media_id uuid;

alter table public.site_inspection_media
  add column if not exists upload_progress real
    check (upload_progress is null or (upload_progress >= 0 and upload_progress <= 1));

create unique index if not exists site_inspection_media_client_id_uidx
  on public.site_inspection_media (inspection_id, client_media_id)
  where client_media_id is not null;

comment on column public.site_inspection_media.client_media_id is
  'Client-generated id for optimistic UI reconciliation with the persistent upload queue.';
comment on column public.site_inspection_media.upload_progress is
  '0..1 progress while uploading (especially video). Null when idle/ready/failed.';

-- Allow authenticated users to upload/update objects under {auth.uid()}/… in the
-- site-inspection-media bucket (direct signed + TUS uploads). Reads still via signed URLs.
drop policy if exists "Users can upload own site inspection media" on storage.objects;
create policy "Users can upload own site inspection media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'site-inspection-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update own site inspection media" on storage.objects;
create policy "Users can update own site inspection media"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'site-inspection-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'site-inspection-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

### `049_site_inspection_media_signed_video.sql`

```sql
-- Video uploads now use signed URLs (same path as photos) because TUS Authorization
-- is unreliable in this client (Invalid Compact JWS). Remove the bucket size cap so
-- field videos are not rejected after client size caps were removed.
-- Also reap orphaned pending/uploading media rows created at enqueue time before
-- bytes ever landed (phantom "Uploading 0%" on other devices).

update storage.buckets
set file_size_limit = null
where id = 'site-inspection-media';

delete from public.site_inspection_media
where upload_status in ('pending', 'uploading');
```

### `050_site_inspection_media_poster.sql`

```sql
-- Video posters (first-frame JPEG captured on-device) + remux note for QuickTime.
alter table public.site_inspection_media
  add column if not exists poster_storage_path text;

comment on column public.site_inspection_media.poster_storage_path is
  'Optional JPEG poster for videos, captured on the recording device at upload time.';
```

### `051_site_inspection_ai.sql`

```sql
-- Site inspection AI: video transcripts + per-item summaries (generated on complete).

-- ---------------------------------------------------------------------------
-- Progress fields on the inspection
-- ---------------------------------------------------------------------------
alter table public.site_inspections
  add column if not exists ai_processing_status text not null default 'idle'
    check (ai_processing_status in ('idle', 'queued', 'processing', 'complete', 'failed'));

alter table public.site_inspections
  add column if not exists ai_processing_message text;

alter table public.site_inspections
  add column if not exists ai_processing_videos_total integer not null default 0
    check (ai_processing_videos_total >= 0);

alter table public.site_inspections
  add column if not exists ai_processing_videos_done integer not null default 0
    check (ai_processing_videos_done >= 0);

alter table public.site_inspections
  add column if not exists ai_processing_started_at timestamptz;

alter table public.site_inspections
  add column if not exists ai_processing_finished_at timestamptz;

comment on column public.site_inspections.ai_processing_status is
  'Background transcription/summary job lifecycle after Complete.';
comment on column public.site_inspections.ai_processing_message is
  'Human-readable progress, e.g. "Transcribing 3 of 8 videos".';

-- ---------------------------------------------------------------------------
-- Per-video transcript columns
-- ---------------------------------------------------------------------------
alter table public.site_inspection_media
  add column if not exists transcript_status text
    check (
      transcript_status is null
      or transcript_status in (
        'pending',
        'processing',
        'complete',
        'failed',
        'no_speech_detected'
      )
    );

alter table public.site_inspection_media
  add column if not exists transcript_text text;

alter table public.site_inspection_media
  add column if not exists transcript_segments jsonb;

alter table public.site_inspection_media
  add column if not exists transcript_error text;

alter table public.site_inspection_media
  add column if not exists transcript_updated_at timestamptz;

comment on column public.site_inspection_media.transcript_status is
  'Video transcription lifecycle. Null for photos / never queued.';
comment on column public.site_inspection_media.transcript_segments is
  'Timestamped Whisper segments: [{start, end, text}] seconds.';

-- ---------------------------------------------------------------------------
-- Per-checklist-item AI summary (only items that have video)
-- ---------------------------------------------------------------------------
create table if not exists public.site_inspection_item_summaries (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.site_inspections (id) on delete cascade,
  snapshot_item_id uuid not null,
  summary_text text not null default '',
  content_fingerprint text not null default '',
  -- Inputs used for the fingerprint (notes + video ids) so the UI can say *why* a summary is stale.
  source_notes text not null default '',
  source_video_ids jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'complete', 'failed')),
  error text,
  generated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (inspection_id, snapshot_item_id)
);

create index if not exists site_inspection_item_summaries_inspection_idx
  on public.site_inspection_item_summaries (inspection_id);

create trigger site_inspection_item_summaries_set_updated_at
  before update on public.site_inspection_item_summaries
  for each row execute function public.set_updated_at();

comment on table public.site_inspection_item_summaries is
  'AI summaries for checklist items that have video. Fingerprint drives regenerate visibility.';
comment on column public.site_inspection_item_summaries.content_fingerprint is
  'SHA-256 of notes + video ids + transcript texts used to generate this summary.';

alter table public.site_inspection_item_summaries
  add column if not exists source_notes text not null default '';

alter table public.site_inspection_item_summaries
  add column if not exists source_video_ids jsonb not null default '[]'::jsonb;

alter table public.site_inspection_item_summaries enable row level security;

create policy "Authenticated users can read site inspection item summaries"
  on public.site_inspection_item_summaries for select
  to authenticated
  using (true);

create policy "No client insert site inspection item summaries"
  on public.site_inspection_item_summaries for insert
  to authenticated
  with check (false);

create policy "No client update site inspection item summaries"
  on public.site_inspection_item_summaries for update
  to authenticated
  using (false);

create policy "No client delete site inspection item summaries"
  on public.site_inspection_item_summaries for delete
  to authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- Job type for background transcription + summarization
-- ---------------------------------------------------------------------------
alter table public.report_jobs
  drop constraint if exists report_jobs_job_type_check;

alter table public.report_jobs
  add constraint report_jobs_job_type_check
  check (job_type in (
    'property_research',
    'slack_completion_notification',
    'google_knowledge_sync',
    'slack_baxter_reply',
    'baxter_monitor_sweep',
    'baxter_alert_delivery',
    'slack_monitoring_reaction',
    'pem_neat_generate',
    'project_setup',
    'knowledge_drive_ingest',
    'expense_jobs_sync',
    'site_inspection_ai'
  ));
```

### `052_site_inspection_ai_progress.sql`

```sql
-- Site inspection AI: track summarization progress for a single pipeline progress bar.

alter table public.site_inspections
  add column if not exists ai_processing_summaries_total integer not null default 0
    check (ai_processing_summaries_total >= 0);

alter table public.site_inspections
  add column if not exists ai_processing_summaries_done integer not null default 0
    check (ai_processing_summaries_done >= 0);

alter table public.site_inspections
  add column if not exists ai_processing_phase text
    check (
      ai_processing_phase is null
      or ai_processing_phase in ('transcribing', 'summarizing', 'complete', 'failed')
    );

comment on column public.site_inspections.ai_processing_summaries_total is
  'Checklist items with video that need AI summaries.';
comment on column public.site_inspections.ai_processing_phase is
  'Current AI pipeline phase for UI progress (transcribing | summarizing).';
```

### `053_site_inspection_pdf_export_job.sql`

```sql
-- Allow background PDF export jobs for large site inspections.

alter table public.report_jobs
  drop constraint if exists report_jobs_job_type_check;

alter table public.report_jobs
  add constraint report_jobs_job_type_check
  check (job_type in (
    'property_research',
    'slack_completion_notification',
    'google_knowledge_sync',
    'slack_baxter_reply',
    'baxter_monitor_sweep',
    'baxter_alert_delivery',
    'slack_monitoring_reaction',
    'pem_neat_generate',
    'project_setup',
    'knowledge_drive_ingest',
    'expense_jobs_sync',
    'site_inspection_ai',
    'site_inspection_pdf_export'
  ));
```

### `056_site_inspection_street_view_cover.sql`

```sql
-- Cached Street View default cover for site inspections.
-- Fetched once per address (at create, and again if the address changes).
-- List cards read this path from storage; they do not call Google.

alter table public.site_inspections
  add column if not exists street_view_storage_path text,
  add column if not exists street_view_address text,
  add column if not exists street_view_status text,
  add column if not exists street_view_captured_on text;

alter table public.site_inspections
  drop constraint if exists site_inspections_street_view_status_check;

alter table public.site_inspections
  add constraint site_inspections_street_view_status_check
  check (
    street_view_status is null
    or street_view_status in ('available', 'unavailable')
  );
```

### `057_site_inspection_address_coordinates.sql`

```sql
-- Coordinates from Places autocomplete, preferred over the address string
-- for Street View. Nullable so a typed address that Google cannot resolve
-- can still be saved.

alter table public.site_inspections
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

-- Background backfill of Street View covers for inspections created before
-- covers were fetched at create time.

alter table public.report_jobs
  drop constraint if exists report_jobs_job_type_check;

alter table public.report_jobs
  add constraint report_jobs_job_type_check
  check (job_type in (
    'property_research',
    'slack_completion_notification',
    'google_knowledge_sync',
    'slack_baxter_reply',
    'baxter_monitor_sweep',
    'baxter_alert_delivery',
    'slack_monitoring_reaction',
    'pem_neat_generate',
    'project_setup',
    'knowledge_drive_ingest',
    'expense_jobs_sync',
    'site_inspection_ai',
    'site_inspection_pdf_export',
    'site_inspection_street_view_backfill'
  ));
```

---

## The snapshot module

The foundation. A live template is deep-copied with fresh identifiers; everything downstream keys off snapshot ids. Small, pure, and the first thing to port and test.

From `src/lib/inspections/snapshot.ts`.

```typescript
/**
 * Frozen checklist structure copied into each site inspection at create time.
 * Live template edits must never mutate these shapes.
 */

import { randomUUID } from "node:crypto";
import type { InspectionSubQuestionType, InspectionTemplateDetail } from "./types";

export type SnapshotOption = {
  id: string;
  label: string;
  sortOrder: number;
};

export type SnapshotSubQuestion = {
  id: string;
  prompt: string;
  questionType: InspectionSubQuestionType;
  sortOrder: number;
  options: SnapshotOption[];
};

export type SnapshotItem = {
  id: string;
  /** Provenance only — may be deleted from the live template later. */
  sourceTemplateItemId: string;
  title: string;
  guideNotes: string;
  allowsMedia: boolean;
  allowsNotes: boolean;
  isCoverPhotoSource: boolean;
  sortOrder: number;
  subQuestions: SnapshotSubQuestion[];
};

export type SnapshotSection = {
  id: string;
  sourceTemplateSectionId: string;
  title: string;
  sortOrder: number;
  items: SnapshotItem[];
};

export type InspectionSnapshot = {
  version: 1;
  sourceTemplateId: string;
  sourceTemplateName: string;
  snapshottedAt: string;
  standaloneItems: SnapshotItem[];
  sections: SnapshotSection[];
};

function snapshotItem(item: InspectionTemplateDetail["standaloneItems"][number]): SnapshotItem {
  return {
    id: randomUUID(),
    sourceTemplateItemId: item.id,
    title: item.title,
    guideNotes: item.guideNotes,
    allowsMedia: item.allowsMedia,
    allowsNotes: item.allowsNotes,
    isCoverPhotoSource: item.isCoverPhotoSource,
    sortOrder: item.sortOrder,
    subQuestions: item.subQuestions
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((sq) => ({
        id: randomUUID(),
        prompt: sq.prompt,
        questionType: sq.questionType,
        sortOrder: sq.sortOrder,
        options: sq.options
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((opt) => ({
            id: randomUUID(),
            label: opt.label,
            sortOrder: opt.sortOrder,
          })),
      })),
  };
}

/** Deep-copy a live template into an inspection-local snapshot with fresh ids. */
export function buildInspectionSnapshot(
  template: InspectionTemplateDetail,
  snapshottedAt = new Date().toISOString(),
): InspectionSnapshot {
  return {
    version: 1,
    sourceTemplateId: template.id,
    sourceTemplateName: template.name,
    snapshottedAt,
    standaloneItems: template.standaloneItems
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(snapshotItem),
    sections: template.sections
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((section) => ({
        id: randomUUID(),
        sourceTemplateSectionId: section.id,
        title: section.title,
        sortOrder: section.sortOrder,
        items: section.items
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(snapshotItem),
      })),
  };
}

/**
 * Resolve a queue entry to its checklist step. Media is stored on the item.
 * If the id is a sub-question, the label includes that prompt.
 */
export function findSnapshotMediaStep(
  snapshot: InspectionSnapshot,
  snapshotItemId: string,
  snapshotSubQuestionId?: string | null,
): { stepTitle: string; subQuestionPrompt: string | null } {
  const items = listSnapshotItems(snapshot);
  const byItem = items.find((item) => item.id === snapshotItemId);
  if (byItem) {
    const sub = snapshotSubQuestionId
      ? byItem.subQuestions.find((sq) => sq.id === snapshotSubQuestionId)
      : undefined;
    return { stepTitle: byItem.title, subQuestionPrompt: sub?.prompt ?? null };
  }
  for (const item of items) {
    const sub = item.subQuestions.find((sq) => sq.id === snapshotItemId);
    if (sub) return { stepTitle: item.title, subQuestionPrompt: sub.prompt };
  }
  return { stepTitle: "Checklist item", subQuestionPrompt: null };
}

export function listSnapshotItems(snapshot: InspectionSnapshot): SnapshotItem[] {
  return [
    ...snapshot.standaloneItems.slice().sort((a, b) => a.sortOrder - b.sortOrder),
    ...snapshot.sections
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .flatMap((section) => section.items.slice().sort((a, b) => a.sortOrder - b.sortOrder)),
  ];
}

export function countSnapshotItems(snapshot: InspectionSnapshot): number {
  return listSnapshotItems(snapshot).length;
}

export function findCoverPhotoItem(snapshot: InspectionSnapshot): SnapshotItem | null {
  return listSnapshotItems(snapshot).find((item) => item.isCoverPhotoSource) ?? null;
}
```

---

## Media limits and naming

Every constant here has a comment saying why it is that value. The 6 MiB chunk size is a hard Supabase requirement. The concurrency of 1 and the removed size caps were both field decisions.

From `src/lib/inspections/media-limits.ts`.

```typescript
/**
 * Media upload caps and naming helpers for the background upload pipeline.
 */

/**
 * Soft pre-capture warning only — not a hard reject.
 * Large videos are allowed; they just take longer on job-site cell signal.
 */
export const VIDEO_WARN_MESSAGE =
  "Large videos can take a while to upload on cell signal. Keep the app open until the upload finishes — it will resume if the signal drops.";

/**
 * Route Attach-file / capture results by the file itself (MIME, then extension).
 * Do not infer from which button was pressed — Attach file accepts both.
 */
export function inferInspectionMediaType(file: File): "photo" | "video" | null {
  const mime = (file.type || "").trim().toLowerCase();
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";

  const name = (file.name || "").trim().toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (
    ext &&
    ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff"].includes(ext)
  ) {
    return "photo";
  }
  if (ext && ["mp4", "mov", "m4v", "webm", "avi", "mkv", "3gp", "3gpp"].includes(ext)) {
    return "video";
  }
  return null;
}

/**
 * @deprecated Soft guidance only — no longer enforced as a hard upload cap.
 * Kept so older call sites / tests can read a number if needed.
 */
export const VIDEO_MAX_BYTES = Number.POSITIVE_INFINITY;
/** @deprecated Duration is no longer enforced client-side. */
export const VIDEO_MAX_DURATION_SECONDS = Number.POSITIVE_INFINITY;

/**
 * One upload at a time. Parallel transfers on a phone share one connection and
 * were slower in the field, and overlapping progress writes could resurrect a
 * finished upload at 0%.
 */
export const MEDIA_UPLOAD_CONCURRENCY = 1;

/** Supabase TUS requires exactly 6 MiB chunks — any other value fails. */
export const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024;

/**
 * Zip export: above this, offer photos-only instead of failing mid-stream.
 * Large videos will hit this often — revisit separately if field exports need full video zips.
 */
export const ZIP_FULL_EXPORT_MAX_BYTES = 200 * 1024 * 1024; // 200 MB

export function sanitizeFilenamePart(value: string): string {
  return (
    value
      .trim()
      .replace(/[^\w\s.-]+/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 60) || "item"
  );
}

/** Checklist step plus media type, e.g. "Access — photo". */
export function formatInspectionMediaStepLabel(input: {
  stepTitle: string;
  subQuestionPrompt?: string | null;
  mediaType: "photo" | "video";
}): string {
  const kind = input.mediaType === "video" ? "video" : "photo";
  const step = input.stepTitle.trim() || "Checklist item";
  const sub = input.subQuestionPrompt?.trim();
  if (sub) return `${step} — ${sub} — ${kind}`;
  return `${step} — ${kind}`;
}

/** Failure copy that names the checklist step so the inspector knows what to retake. */
export function formatInspectionMediaFailure(stepLabel: string, reason: string): string {
  const detail = reason.trim() || "Upload failed";
  return `${stepLabel} failed — ${detail}`;
}

/**
 * Device-export name an inspector can match back to the checklist.
 * `Access__photo.jpg`, or `Access__photo_02.jpg` when several share a step.
 */
export function buildQueuedMediaDeviceFilename(input: {
  stepTitle: string;
  subQuestionPrompt?: string | null;
  mediaType: "photo" | "video";
  ext: string;
  /** 1-based index within the same step + type. */
  index: number;
  total: number;
}): string {
  const step = sanitizeFilenamePart(input.stepTitle);
  const sub = input.subQuestionPrompt?.trim() ? sanitizeFilenamePart(input.subQuestionPrompt) : "";
  const kind = input.mediaType === "video" ? "video" : "photo";
  const base = sub ? `${step}__${sub}__${kind}` : `${step}__${kind}`;
  const suffix = input.total > 1 ? `_${String(input.index).padStart(2, "0")}` : "";
  const ext = input.ext.replace(/^\./, "") || "bin";
  return `${base}${suffix}.${ext}`;
}

export function buildMediaExportFilename(input: {
  sectionTitle: string | null;
  itemTitle: string;
  index: number;
  mediaType: "photo" | "video";
  ext: string;
}): string {
  const section = sanitizeFilenamePart(input.sectionTitle ?? "standalone");
  const item = sanitizeFilenamePart(input.itemTitle);
  const n = String(input.index + 1).padStart(2, "0");
  const kind = input.mediaType === "video" ? "video" : "photo";
  return `${section}__${item}__${kind}_${n}.${input.ext}`;
}

/**
 * Prefer the direct storage hostname for resumable uploads (Supabase guidance).
 * https://project.supabase.co → https://project.storage.supabase.co
 */
export function supabaseResumableUploadEndpoint(supabaseUrl: string): string {
  const url = new URL(supabaseUrl);
  if (url.hostname.endsWith(".supabase.co") && !url.hostname.includes(".storage.")) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  return `${url.origin.replace(/\/$/, "")}/storage/v1/upload/resumable`;
}

/** Strip accidental Bearer prefix / whitespace; require three JWT segments. */
export function normalizeAccessToken(raw: string): string {
  let token = raw.trim();
  if (/^bearer\s+/i.test(token)) {
    token = token.replace(/^bearer\s+/i, "").trim();
  }
  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((s) => !s)) {
    throw new Error("Sign in again to upload video (session token looks invalid)");
  }
  return token;
}

export function redactAuthorizationForLog(authorizationHeader: string): {
  hasBearerPrefix: boolean;
  bearerPrefixCount: number;
  tokenSegmentCount: number;
  firstSegmentPrefix: string | null;
  tokenLength: number;
} {
  const trimmed = authorizationHeader.trim();
  const bearerPrefixCount = (trimmed.match(/bearer\s+/gi) ?? []).length;
  const hasBearerPrefix = /^bearer\s+/i.test(trimmed);
  const token = hasBearerPrefix ? trimmed.replace(/^bearer\s+/i, "").trim() : trimmed;
  const segments = token ? token.split(".") : [];
  return {
    hasBearerPrefix,
    bearerPrefixCount,
    tokenSegmentCount: segments.length,
    firstSegmentPrefix: segments[0] ? segments[0].slice(0, 20) : null,
    tokenLength: token.length,
  };
}

/** Redact apikey the same way (structure only — never log the secret). */
export function redactApiKeyForLog(apikeyHeader: string): {
  hasBearerPrefix: boolean;
  bearerPrefixCount: number;
  tokenSegmentCount: number;
  firstSegmentPrefix: string | null;
  tokenLength: number;
  format: "legacy_jwt" | "sb_publishable" | "sb_secret" | "other";
} {
  const base = redactAuthorizationForLog(apikeyHeader);
  const raw = apikeyHeader
    .trim()
    .replace(/^bearer\s+/i, "")
    .trim();
  const format = raw.startsWith("sb_publishable_")
    ? "sb_publishable"
    : raw.startsWith("sb_secret_")
      ? "sb_secret"
      : raw.startsWith("eyJ")
        ? "legacy_jwt"
        : "other";
  return { ...base, format };
}
```

---

## Video remuxing

The fix for iPhone video that Safari plays and Chrome refuses. Stream-copy only, so quality is untouched.

From `src/lib/inspections/video-remux.ts`.

```typescript
/**
 * Remux QuickTime (.mov) → MP4 (isom) without re-encoding.
 *
 * iPhone H.264 often lands in a classic QuickTime `qt  ` brand container that
 * Safari plays but Chrome on desktop refuses (grey player, 0:00, disabled play).
 * Stream-copy remux keeps quality and fixes Chrome.
 */

import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function looksLikeQuickTimeContainer(input: {
  storagePath?: string | null;
  mimeType?: string | null;
}): boolean {
  const path = (input.storagePath ?? "").toLowerCase();
  const mime = (input.mimeType ?? "").toLowerCase();
  return path.endsWith(".mov") || mime.includes("quicktime");
}

export async function remuxQuickTimeToMp4(input: Buffer): Promise<Buffer> {
  const ffmpegPath = (await import("ffmpeg-static")).default;
  if (!ffmpegPath) {
    throw new Error("ffmpeg binary unavailable");
  }

  const dir = await mkdtemp(join(tmpdir(), "baxter-remux-"));
  const inPath = join(dir, "in.mov");
  const outPath = join(dir, "out.mp4");
  try {
    await writeFile(inPath, input);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        ffmpegPath,
        ["-y", "-i", inPath, "-c", "copy", "-movflags", "+faststart", "-f", "mp4", outPath],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg remux failed (code ${code}): ${stderr.slice(-500)}`));
      });
    });
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Companion poster path for a video object: `…/id.mov` → `…/id.poster.jpg`. */
export function posterStoragePathForVideo(videoStoragePath: string): string {
  const trimmed = videoStoragePath.trim();
  const dot = trimmed.lastIndexOf(".");
  const base = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  return `${base}.poster.jpg`;
}
```

---

## The transcript gate

What makes a transcript terminal, and how a premature empty summary is detected.

From `src/lib/inspections/ai/transcript-gate.ts`.

```typescript
/**
 * Terminal-transcript gating and premature-empty summary detection.
 */

import type { SiteInspectionMedia, TranscriptSegment, TranscriptStatus } from "../record-types";

export const TERMINAL_TRANSCRIPT_STATUSES: ReadonlyArray<TranscriptStatus> = [
  "complete",
  "no_speech_detected",
  "failed",
];

export function isTerminalTranscriptStatus(
  status: TranscriptStatus | null | undefined,
): status is "complete" | "no_speech_detected" | "failed" {
  return status === "complete" || status === "no_speech_detected" || status === "failed";
}

/** Prefer flat text; fall back to joining timestamped segments. */
export function effectiveTranscriptText(input: {
  transcriptText?: string | null;
  transcriptSegments?: TranscriptSegment[] | null;
}): string {
  const direct = (input.transcriptText ?? "").trim();
  if (direct) return direct;
  return (input.transcriptSegments ?? [])
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function hasUsableSpeechTranscript(
  videos: Array<{
    transcriptStatus?: TranscriptStatus | null;
    transcriptText?: string | null;
    transcriptSegments?: TranscriptSegment[] | null;
  }>,
): boolean {
  return videos.some(
    (v) => v.transcriptStatus === "complete" && effectiveTranscriptText(v).length > 0,
  );
}

export function allItemTranscriptsTerminal(
  videos: Array<{ transcriptStatus?: TranscriptStatus | null }>,
): boolean {
  if (videos.length === 0) return false;
  return videos.every((v) => isTerminalTranscriptStatus(v.transcriptStatus));
}

/** LLM empty-input boilerplate (and close variants). */
export function looksLikeEmptyInputSummary(summaryText: string): boolean {
  const t = summaryText.trim().toLowerCase();
  if (!t) return false;
  return (
    /no spoken content or notes were available/.test(t) ||
    /no spoken content.*(?:and|or).*notes/.test(t) ||
    /no spoken content was available/.test(t)
  );
}

/**
 * Summary claims empty input while at least one video has usable speech.
 * These are stuck: fingerprints may match the *current* empty-text snapshot
 * that was wrong, or match after a race — either way regenerate is required.
 */
export function isPrematureEmptySummary(input: {
  summaryText: string;
  status: string;
  videos: SiteInspectionMedia[];
}): boolean {
  if (input.status !== "complete") return false;
  if (!looksLikeEmptyInputSummary(input.summaryText)) return false;
  return hasUsableSpeechTranscript(input.videos);
}
```

---

## Summary fingerprinting

What makes a summary stale, and the wording that explains why.

From `src/lib/inspections/ai/fingerprint.ts`.

```typescript
/**
 * Content fingerprint for item AI summaries.
 * Drives regenerate-button visibility: button is absent when fingerprints match.
 */

import { createHash } from "node:crypto";
import type { TranscriptSegment, TranscriptStatus } from "../record-types";
import { effectiveTranscriptText } from "./transcript-gate";

export type FingerprintVideoInput = {
  mediaId: string;
  transcriptStatus: TranscriptStatus | null | undefined;
  transcriptText: string | null | undefined;
  transcriptSegments?: TranscriptSegment[] | null;
};

/**
 * Stable SHA-256 of the inputs a summary was (or will be) generated from:
 * inspector notes + ordered video ids + their transcript outcomes/text.
 * Adding/removing a video or editing notes changes the hash.
 */
export function buildItemSummaryFingerprint(input: {
  notes: string;
  videos: FingerprintVideoInput[];
}): string {
  const videos = input.videos
    .slice()
    .sort((a, b) => a.mediaId.localeCompare(b.mediaId))
    .map((v) => ({
      id: v.mediaId,
      status: v.transcriptStatus ?? null,
      text: effectiveTranscriptText({
        transcriptText: v.transcriptText,
        transcriptSegments: v.transcriptSegments,
      }),
    }));
  const payload = JSON.stringify({
    notes: input.notes.trim(),
    videos,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function describeSummaryStaleReason(input: {
  previousNotes: string;
  currentNotes: string;
  previousVideoIds: string[];
  currentVideoIds: string[];
}): string {
  const notesChanged = input.previousNotes.trim() !== input.currentNotes.trim();
  const prev = new Set(input.previousVideoIds);
  const curr = new Set(input.currentVideoIds);
  const added = [...curr].some((id) => !prev.has(id));
  const removed = [...prev].some((id) => !curr.has(id));

  if (notesChanged && (added || removed)) return "notes and videos changed since this summary";
  if (notesChanged) return "notes changed since this summary";
  if (added && removed) return "videos changed since this summary";
  if (added) return "a video was added since this summary";
  if (removed) return "a video was deleted since this summary";
  return "content changed since this summary";
}
```

---

## The summary prompt

The grounding rules that forbid invented findings.

From `src/lib/inspections/ai/summarize.ts`.

```typescript
/**
 * Per-item AI summary from transcripts + inspector notes.
 * Evidence discipline: state only what was said/written — no invented findings.
 */

import "server-only";

import { getEnv } from "@/lib/env";
import { buildOpenAiJsonRequest, extractOpenAiResponsesText } from "@/lib/openai/json-request";

export type SummarizeItemInput = {
  itemTitle: string;
  guideNotes: string | null;
  inspectorNotes: string;
  transcripts: Array<{ mediaId: string; text: string; status: string }>;
  /** When true, forbid empty-input boilerplate — transcripts are known usable. */
  forceUseTranscripts?: boolean;
};

export type SummarizeItemResult =
  { kind: "complete"; summary: string } | { kind: "failed"; message: string };

const SYSTEM = `You write short field-inspection summaries for Acton ADU site visits.

Rules:
- Use ONLY what appears in the video transcript(s) and the inspector's typed notes.
- Do NOT invent findings, measurements, defects, or recommendations that nobody stated.
- If transcripts say "no speech" / are empty and notes are empty, say that no spoken content or notes were available.
- Ground the summary in the checklist item title (and guide notes for context about what the item is about).
- 2–5 concise sentences. Plain language. No markdown headings.
- Return JSON: { "summary": "..." }`;

/**
 * Generate a read-only AI summary for one checklist item that has video.
 */
export async function summarizeInspectionItem(
  input: SummarizeItemInput,
  options?: { fetchImpl?: typeof fetch },
): Promise<SummarizeItemResult> {
  const env = getEnv();
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    return { kind: "failed", message: "OPENAI_API_KEY is not configured" };
  }

  const model = (env.OPENAI_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini";
  const transcriptBlock =
    input.transcripts.length === 0
      ? "(no transcripts)"
      : input.transcripts
          .map((t, i) => {
            if (t.status === "pending" || t.status === "processing" || !t.status) {
              return `Video ${i + 1}: [transcript not ready]`;
            }
            if (t.status === "failed") {
              return `Video ${i + 1}: [transcription failed]`;
            }
            if (t.status === "no_speech_detected" || !t.text.trim()) {
              return `Video ${i + 1}: [no speech detected]`;
            }
            return `Video ${i + 1}:\n${t.text.trim()}`;
          })
          .join("\n\n");

  const userPrompt = [
    `Checklist item: ${input.itemTitle}`,
    input.guideNotes?.trim()
      ? `Guide notes (what this item is about):\n${input.guideNotes.trim()}`
      : null,
    `Inspector notes:\n${input.inspectorNotes.trim() || "(none)"}`,
    `Video transcripts:\n${transcriptBlock}`,
    input.forceUseTranscripts
      ? "IMPORTANT: Usable transcript text is provided above. Do NOT say that no spoken content was available. Summarize what was actually said."
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const built = buildOpenAiJsonRequest({
    model,
    maxOutputTokens: 400,
    temperature: 0.2,
    jsonObject: true,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });

  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(built.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(built.body),
    });
    const raw = await response.text();
    if (!response.ok) {
      return { kind: "failed", message: `Summary HTTP ${response.status}: ${raw.slice(0, 200)}` };
    }
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      data = null;
    }
    const content =
      (data ? extractOpenAiResponsesText(data) : null) ||
      (typeof (data as { choices?: Array<{ message?: { content?: string } }> } | null)?.choices?.[0]
        ?.message?.content === "string"
        ? (data as { choices: Array<{ message: { content: string } }> }).choices[0]!.message.content
        : null);
    if (!content?.trim()) {
      return { kind: "failed", message: "Empty summary response" };
    }
    let summary = content.trim();
    try {
      const parsed = JSON.parse(content) as { summary?: unknown };
      if (typeof parsed.summary === "string" && parsed.summary.trim()) {
        summary = parsed.summary.trim();
      }
    } catch {
      // plain text fallback
    }
    return { kind: "complete", summary };
  } catch (error) {
    return {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
```

---

## Extracting a complete current bundle

```bash
{
  for f in src/lib/inspections/*.ts \
           src/lib/inspections/ai/* \
           src/app/api/inspections/route.ts \
           src/app/api/inspections/*/route.ts \
           src/app/api/inspections/*/*/route.ts \
           src/app/api/inspections/*/*/*/route.ts \
           src/app/api/inspections/*/*/*/*/route.ts \
           src/app/inspections/page.tsx \
           src/app/inspections/layout.tsx \
           src/app/inspections/*/page.tsx \
           src/app/inspections/*/*/page.tsx \
           src/app/inspections/manifest.webmanifest/route.ts \
           src/components/inspections/*.tsx \
           supabase/migrations/04[6-9]_site_inspection*.sql \
           supabase/migrations/05[0-3]_site_inspection*.sql \
           supabase/migrations/056_site_inspection*.sql \
           supabase/migrations/057_site_inspection*.sql; do
    echo "===== $f ====="
    cat "$f"
    echo
  done
} > site-inspection-bundle.txt
```

Test bundle:

```bash
{
  for f in tests/unit/site-inspection-*.test.ts tests/unit/site-inspection-*.test.tsx; do
    echo "===== $f ====="
    cat "$f"
    echo
  done
} > site-inspection-tests.txt
```

**Export the live templates.** The Detached ADU checklist ships as a seed, but templates are editable database rows and the live versions are the ones inspectors actually use. Export the template hierarchy to this folder on every quarterly review — it is Acton's field methodology, and unlike the code it is not in version control.

```sql
select t.name, s.title as section, i.title as item, i.guide_notes,
       q.prompt, q.question_type, o.label
from public.inspection_templates t
left join public.inspection_template_sections s on s.template_id = t.id
left join public.inspection_template_items i on i.template_id = t.id
     and (i.section_id = s.id or (i.section_id is null and s.id is null))
left join public.inspection_template_sub_questions q on q.item_id = i.id
left join public.inspection_template_sub_question_options o on o.sub_question_id = q.id
where t.archived_at is null
order by s.sort_order nulls first, i.sort_order, q.sort_order, o.sort_order;
```

---

## Rebuild order

See [Specification § 11](./02-specification.md#rebuilding-this-module). Briefly: migrations, then types and the snapshot module, then the template store and editor, then records and the runner, then the media queue, then server media routes and video handling, then the AI pipeline, then Street View and exports.

**Verify on a real phone on real cell signal.** Every upload bug this module has had was invisible on a desktop browser with good wifi.
