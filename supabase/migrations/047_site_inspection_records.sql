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
