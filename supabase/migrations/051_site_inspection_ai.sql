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
