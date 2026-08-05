-- Jurisdiction-aware building-code layer:
-- 1) First-class jurisdiction + doc_kind on knowledge_entries
-- 2) Admin-maintained structured jurisdiction_rules (required source citations)
--
-- Jurisdiction keys align with connector keys (ca-san-jose, ca-santa-clara-county).
-- Rule keys are application vocabulary (no DB enum) so they stay extensible without migrations.

-- ---------------------------------------------------------------------------
-- knowledge_entries: jurisdiction association + document kind
-- ---------------------------------------------------------------------------
-- One entry → one jurisdiction. Statewide / unscoped docs keep jurisdiction_key null.
-- Multi-jurisdiction reuse is rare for municipal codes; duplicate or leave unscoped.

alter table public.knowledge_entries
  add column if not exists jurisdiction_key text,
  add column if not exists doc_kind text;

alter table public.knowledge_entries
  drop constraint if exists knowledge_entries_doc_kind_check;

alter table public.knowledge_entries
  add constraint knowledge_entries_doc_kind_check
  check (
    doc_kind is null
    or doc_kind in ('building_code', 'ordinance', 'design_guideline', 'other_code')
  );

create index if not exists knowledge_entries_jurisdiction_key_idx
  on public.knowledge_entries (jurisdiction_key)
  where jurisdiction_key is not null;

create index if not exists knowledge_entries_doc_kind_idx
  on public.knowledge_entries (doc_kind)
  where doc_kind is not null;

create index if not exists knowledge_entries_jurisdiction_doc_kind_idx
  on public.knowledge_entries (jurisdiction_key, doc_kind)
  where jurisdiction_key is not null and doc_kind is not null;

comment on column public.knowledge_entries.jurisdiction_key is
  'Connector-aligned jurisdiction key (e.g. ca-san-jose). Null = not jurisdiction-scoped.';
comment on column public.knowledge_entries.doc_kind is
  'building_code | ordinance | design_guideline | other_code — marks code/ordinance documents for ADU research.';

-- ---------------------------------------------------------------------------
-- jurisdiction_rules: structured, citation-required admin values
-- ---------------------------------------------------------------------------
create table if not exists public.jurisdiction_rules (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_key text not null,
  rule_key text not null,
  zone_key text,
  value_json jsonb not null default '{}'::jsonb,
  source_citation text not null,
  source_knowledge_entry_id uuid references public.knowledge_entries (id) on delete set null,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint jurisdiction_rules_jurisdiction_key_format
    check (jurisdiction_key ~ '^[a-z][a-z0-9-]*$'),
  constraint jurisdiction_rules_rule_key_format
    check (rule_key ~ '^[a-z][a-z0-9_]*$'),
  constraint jurisdiction_rules_source_citation_required
    check (length(trim(source_citation)) > 0),
  constraint jurisdiction_rules_zone_key_format
    check (zone_key is null or length(trim(zone_key)) > 0)
);

-- Nullable zone_key: treat null as jurisdiction-general via coalesce in unique index.
create unique index if not exists jurisdiction_rules_unique_idx
  on public.jurisdiction_rules (jurisdiction_key, rule_key, (coalesce(zone_key, '')));

create index if not exists jurisdiction_rules_jurisdiction_idx
  on public.jurisdiction_rules (jurisdiction_key);

create index if not exists jurisdiction_rules_rule_key_idx
  on public.jurisdiction_rules (rule_key);

create index if not exists jurisdiction_rules_source_entry_idx
  on public.jurisdiction_rules (source_knowledge_entry_id)
  where source_knowledge_entry_id is not null;

create trigger jurisdiction_rules_set_updated_at
  before update on public.jurisdiction_rules
  for each row execute function public.set_updated_at();

comment on table public.jurisdiction_rules is
  'Admin-maintained structured ADU/building-code rule values. source_citation is required. Rule keys are app vocabulary.';
comment on column public.jurisdiction_rules.zone_key is
  'Optional zoning designation for zone-specific rules (e.g. setbacks). Null = jurisdiction-general.';
comment on column public.jurisdiction_rules.value_json is
  'Structured value: {kind:"quantity",value,unit} or {kind:"structured",fields:{...}}.';
comment on column public.jurisdiction_rules.source_citation is
  'Required human citation, e.g. "SJMC 20.30.150(b)".';

alter table public.jurisdiction_rules enable row level security;

create policy "Admins can read jurisdiction rules"
  on public.jurisdiction_rules for select to authenticated
  using (public.is_admin());

-- Authenticated employees may read rules for report/chat surfaces (writes via service role).
create policy "Authenticated can read jurisdiction rules"
  on public.jurisdiction_rules for select to authenticated
  using (true);

create policy "No client insert jurisdiction rules"
  on public.jurisdiction_rules for insert to authenticated with check (false);
create policy "No client update jurisdiction rules"
  on public.jurisdiction_rules for update to authenticated using (false);
create policy "No client delete jurisdiction rules"
  on public.jurisdiction_rules for delete to authenticated using (false);
