-- Prompt 3: conversation reset + retrieval helpers

-- Prefer active Slack conversations when looking up by external thread
create index if not exists baxter_conversations_active_external_thread_idx
  on public.baxter_conversations (external_thread_id, created_at desc)
  where status = 'active' and external_thread_id is not null;

-- Eval run history listing
create index if not exists baxter_eval_runs_created_idx
  on public.baxter_eval_runs (created_at desc);

-- Optional knowledge health counters are computed in app code; no new tables required.
