-- Prompt 2 of 3: hybrid retrieval embeddings + multimodal unit types + evaluations

create extension if not exists vector;

-- Expand knowledge unit types for multimodal
alter table public.knowledge_units
  drop constraint if exists knowledge_units_unit_type_check;

alter table public.knowledge_units
  add constraint knowledge_units_unit_type_check
  check (unit_type in (
    'document_section',
    'paragraph',
    'table',
    'table_row',
    'spreadsheet_sheet',
    'spreadsheet_row',
    'key_value',
    'summary',
    'summary_metrics',
    'note',
    'image_description',
    'image_ocr',
    'pdf_page',
    'slide',
    'conflict_note'
  ));

alter table public.knowledge_units
  add column if not exists embedding vector(1536),
  add column if not exists embedding_provider text,
  add column if not exists embedding_model text,
  add column if not exists embedding_generated_at timestamptz,
  add column if not exists embedding_content_hash text;

create index if not exists knowledge_units_embedding_ivfflat
  on public.knowledge_units
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Optional semantic match helper (filters by approved entry IDs)
create or replace function public.match_knowledge_units(
  query_embedding vector(1536),
  match_count integer default 8,
  filter_entry_ids uuid[] default null
)
returns table (
  id uuid,
  knowledge_entry_id uuid,
  unit_type text,
  ordinal integer,
  title text,
  content text,
  search_text text,
  structured_data jsonb,
  metadata jsonb,
  content_hash text,
  index_version integer,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
)
language sql
stable
as $$
  select
    ku.id,
    ku.knowledge_entry_id,
    ku.unit_type,
    ku.ordinal,
    ku.title,
    ku.content,
    ku.search_text,
    ku.structured_data,
    ku.metadata,
    ku.content_hash,
    ku.index_version,
    ku.created_at,
    ku.updated_at,
    (1 - (ku.embedding <=> query_embedding))::float as similarity
  from public.knowledge_units ku
  where ku.embedding is not null
    and (
      filter_entry_ids is null
      or ku.knowledge_entry_id = any (filter_entry_ids)
    )
  order by ku.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

-- Evaluation cases (Prompt 2 foundation; Prompt 3 expands)
create table if not exists public.baxter_eval_cases (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  expected_answer text,
  expected_source_ids uuid[] not null default '{}'::uuid[],
  expected_facts jsonb not null default '[]'::jsonb,
  category text not null
    check (category in (
      'identity',
      'procedure',
      'policy',
      'structured_lookup',
      'structured_aggregation',
      'semantic_lookup',
      'cross_source',
      'multimodal',
      'general',
      'knowledge_gap'
    )),
  notes text,
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists baxter_eval_cases_category_idx
  on public.baxter_eval_cases (category, enabled);

create trigger baxter_eval_cases_set_updated_at
  before update on public.baxter_eval_cases
  for each row execute function public.set_updated_at();

alter table public.baxter_eval_cases enable row level security;

drop policy if exists "Admins can manage eval cases" on public.baxter_eval_cases;
create policy "Admins can manage eval cases"
  on public.baxter_eval_cases for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create table if not exists public.baxter_eval_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.baxter_eval_cases (id) on delete cascade,
  passed boolean not null default false,
  actual_answer text,
  sources_json jsonb not null default '[]'::jsonb,
  retrieval_mode text,
  latency_ms integer,
  provider text,
  model text,
  error_code text,
  signals jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists baxter_eval_runs_case_idx
  on public.baxter_eval_runs (case_id, created_at desc);

alter table public.baxter_eval_runs enable row level security;

drop policy if exists "Admins can read eval runs" on public.baxter_eval_runs;
create policy "Admins can read eval runs"
  on public.baxter_eval_runs for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can insert eval runs" on public.baxter_eval_runs;
create policy "Admins can insert eval runs"
  on public.baxter_eval_runs for insert
  to authenticated
  with check (public.is_admin());
