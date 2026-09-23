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
