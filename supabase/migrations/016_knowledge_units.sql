-- Prompt 1 of 3: Baxter Intelligence — knowledge units for structured retrieval

create table if not exists public.knowledge_units (
  id uuid primary key default gen_random_uuid(),
  knowledge_entry_id uuid not null
    references public.knowledge_entries (id) on delete cascade,
  unit_type text not null
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
      'note'
    )),
  ordinal integer not null default 0,
  title text,
  content text not null default '',
  search_text text not null default '',
  structured_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  content_hash text,
  index_version integer not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists knowledge_units_entry_idx
  on public.knowledge_units (knowledge_entry_id, ordinal);

create index if not exists knowledge_units_type_idx
  on public.knowledge_units (unit_type);

-- Plain btree index — do not require pg_trgm / gin_trgm_ops
create index if not exists knowledge_units_search_text_idx
  on public.knowledge_units (search_text);

create index if not exists knowledge_units_structured_gin
  on public.knowledge_units using gin (structured_data);

drop trigger if exists knowledge_units_set_updated_at on public.knowledge_units;
create trigger knowledge_units_set_updated_at
  before update on public.knowledge_units
  for each row execute function public.set_updated_at();

alter table public.knowledge_units enable row level security;

-- Admins can inspect units; employees never query units directly.
drop policy if exists "Admins can read knowledge units" on public.knowledge_units;
create policy "Admins can read knowledge units"
  on public.knowledge_units for select
  to authenticated
  using (public.is_admin());

-- Service role writes units (no authenticated write policies).

-- Parent entry index metadata
alter table public.knowledge_entries
  add column if not exists index_version integer,
  add column if not exists indexed_at timestamptz,
  add column if not exists index_status text
    check (index_status is null or index_status in (
      'pending', 'ready', 'failed', 'stale', 'skipped'
    )),
  add column if not exists index_warnings text[] not null default '{}'::text[];
