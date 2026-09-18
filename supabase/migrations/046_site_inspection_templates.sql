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
