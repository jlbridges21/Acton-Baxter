-- Receipt Log foundation: expense jobs + receipts + private photo bucket.
-- Amounts stored as integer cents. Writes go through the service role (no client mutations).

-- ---------------------------------------------------------------------------
-- expense_jobs — selectable job list (Master Project Log + admin custom)
-- ---------------------------------------------------------------------------
create table if not exists public.expense_jobs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  project_number text,
  source text not null
    check (source in ('project', 'custom')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint expense_jobs_label_required check (length(trim(label)) > 0),
  constraint expense_jobs_project_number_when_project check (
    (source = 'project' and project_number is not null and length(trim(project_number)) > 0)
    or (source = 'custom' and project_number is null)
  )
);

-- One project-sourced row per Master Project Log project number.
create unique index if not exists expense_jobs_project_number_uidx
  on public.expense_jobs (project_number)
  where source = 'project' and project_number is not null;

create index if not exists expense_jobs_active_sort_idx
  on public.expense_jobs (is_active, sort_order, label);

create index if not exists expense_jobs_source_idx
  on public.expense_jobs (source);

create trigger expense_jobs_set_updated_at
  before update on public.expense_jobs
  for each row execute function public.set_updated_at();

comment on table public.expense_jobs is
  'Jobs available when logging receipts. Project rows sync from Master Project Log; custom rows are admin-managed.';
comment on column public.expense_jobs.is_active is
  'False = hidden from employee dropdown. Persists across Master Project Log refreshes.';
comment on column public.expense_jobs.sort_order is
  'Lower sorts first. Persists across Master Project Log refreshes.';

alter table public.expense_jobs enable row level security;

-- App-access roles (authenticated Acton users) can read jobs for the dropdown.
create policy "Authenticated users can read expense jobs"
  on public.expense_jobs for select
  to authenticated
  using (true);

-- Mutations only via service role (admin API).
create policy "No client insert expense jobs"
  on public.expense_jobs for insert
  to authenticated
  with check (false);

create policy "No client update expense jobs"
  on public.expense_jobs for update
  to authenticated
  using (false);

create policy "No client delete expense jobs"
  on public.expense_jobs for delete
  to authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- receipts — employee expense submissions
-- ---------------------------------------------------------------------------
create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references public.profiles (id) on delete restrict,
  job_id uuid not null references public.expense_jobs (id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  vendor text not null,
  purchased_on date not null,
  items text,
  description text,
  photo_storage_path text,
  extraction jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint receipts_vendor_required check (length(trim(vendor)) > 0)
);

create index if not exists receipts_submitted_by_idx
  on public.receipts (submitted_by, created_at desc)
  where deleted_at is null;

create index if not exists receipts_job_id_idx
  on public.receipts (job_id)
  where deleted_at is null;

create index if not exists receipts_purchased_on_idx
  on public.receipts (purchased_on desc)
  where deleted_at is null;

create trigger receipts_set_updated_at
  before update on public.receipts
  for each row execute function public.set_updated_at();

comment on table public.receipts is
  'Employee receipt / expense log entries. amount_cents is integer cents (never float).';
comment on column public.receipts.photo_storage_path is
  'Path inside receipt-photos bucket. Null for manual entries.';
comment on column public.receipts.extraction is
  'Reserved for OCR confidence/raw output (next prompt).';
comment on column public.receipts.deleted_at is
  'Soft-delete timestamp. Null = active.';

alter table public.receipts enable row level security;

-- Users read only their own receipts; admins/super_admins read all.
create policy "Users can read own receipts"
  on public.receipts for select
  to authenticated
  using (
    (submitted_by = auth.uid() and deleted_at is null)
    or public.is_admin()
  );

-- Mutations only via service role (API after authz).
create policy "No client insert receipts"
  on public.receipts for insert
  to authenticated
  with check (false);

create policy "No client update receipts"
  on public.receipts for update
  to authenticated
  using (false);

create policy "No client delete receipts"
  on public.receipts for delete
  to authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- Private storage bucket for receipt photos (no public URLs)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipt-photos',
  'receipt-photos',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public = false;

-- No authenticated client access — service role creates short-lived signed URLs.
drop policy if exists "No client read receipt photos" on storage.objects;
create policy "No client read receipt photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'receipt-photos' and false);

drop policy if exists "No client insert receipt photos" on storage.objects;
create policy "No client insert receipt photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'receipt-photos' and false);

drop policy if exists "No client update receipt photos" on storage.objects;
create policy "No client update receipt photos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'receipt-photos' and false);

drop policy if exists "No client delete receipt photos" on storage.objects;
create policy "No client delete receipt photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'receipt-photos' and false);
