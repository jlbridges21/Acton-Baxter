-- Partnership Evaluation Meeting NEAT (Prompt 1 foundation).
-- Structured sales intelligence artifact; service-role writes, authenticated team reads.

create table if not exists public.pem_neats (
  id uuid primary key default gen_random_uuid(),
  prospect_name text not null,
  salesperson_user_id uuid references public.profiles (id) on delete set null,
  salesperson_display_name text not null,
  meeting_date date,
  created_by uuid references public.profiles (id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'generating', 'completed', 'failed')),
  transcript text not null default '',
  transcript_hash text,
  transcript_char_count integer not null default 0,
  meeting_outcome text
    check (
      meeting_outcome is null
      or meeting_outcome in (
        'YES',
        'NO',
        'DECISION_DATE',
        'DECISION_DATE_NOT_SECURED'
      )
    ),
  qualification text
    check (
      qualification is null
      or qualification in (
        'STRONGLY_QUALIFIED',
        'QUALIFIED_WITH_RISKS',
        'EARLY_EXPLORATORY',
        'WEAKLY_QUALIFIED',
        'DISQUALIFIED'
      )
    ),
  neat_standard_version text not null default '1.0.0',
  generation_error text,
  generated_at timestamptz,
  regenerated_at timestamptz,
  model_provider text,
  model_name text,
  generation_latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  structured_result jsonb not null default '{}'::jsonb,
  buildertrend_fields jsonb not null default '{}'::jsonb,
  analysis_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint pem_neats_prospect_name_len check (char_length(trim(prospect_name)) between 1 and 300),
  constraint pem_neats_salesperson_name_len check (char_length(trim(salesperson_display_name)) between 1 and 200)
);

create index if not exists pem_neats_created_at_idx
  on public.pem_neats (created_at desc);

create index if not exists pem_neats_prospect_name_idx
  on public.pem_neats (lower(prospect_name));

create index if not exists pem_neats_salesperson_idx
  on public.pem_neats (salesperson_user_id, created_at desc);

create index if not exists pem_neats_status_idx
  on public.pem_neats (status, updated_at desc);

create index if not exists pem_neats_outcome_idx
  on public.pem_neats (meeting_outcome)
  where meeting_outcome is not null;

create trigger pem_neats_set_updated_at
  before update on public.pem_neats
  for each row execute function public.set_updated_at();

-- Optional generation history (keeps prior successful results on regenerate).
create table if not exists public.pem_neat_generations (
  id uuid primary key default gen_random_uuid(),
  pem_neat_id uuid not null references public.pem_neats (id) on delete cascade,
  generation_index integer not null default 1,
  status text not null check (status in ('completed', 'failed')),
  model_provider text,
  model_name text,
  neat_standard_version text not null default '1.0.0',
  structured_result jsonb not null default '{}'::jsonb,
  buildertrend_fields jsonb not null default '{}'::jsonb,
  analysis_metadata jsonb not null default '{}'::jsonb,
  error_message text,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default timezone('utc', now()),
  unique (pem_neat_id, generation_index)
);

create index if not exists pem_neat_generations_neat_idx
  on public.pem_neat_generations (pem_neat_id, generation_index desc);

alter table public.pem_neats enable row level security;
alter table public.pem_neat_generations enable row level security;

-- Authenticated Acton team members can read; writes via service role only.
create policy "Authenticated users can read pem_neats"
  on public.pem_neats for select to authenticated
  using (true);

create policy "No direct client inserts on pem_neats"
  on public.pem_neats for insert to authenticated
  with check (false);

create policy "No direct client updates on pem_neats"
  on public.pem_neats for update to authenticated
  using (false);

create policy "No direct client deletes on pem_neats"
  on public.pem_neats for delete to authenticated
  using (false);

create policy "Authenticated users can read pem_neat_generations"
  on public.pem_neat_generations for select to authenticated
  using (true);

create policy "No direct client writes on pem_neat_generations"
  on public.pem_neat_generations for all to authenticated
  using (false)
  with check (false);
