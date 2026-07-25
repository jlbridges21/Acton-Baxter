-- Prompt 1 Knowledge Management Rework: uploads + safer citation FK for deletes

-- Allow hard-delete of knowledge entries while preserving conversation citation rows.
-- Citation rows keep historical titles via message content; entry link becomes null.
alter table public.baxter_message_sources
  alter column knowledge_entry_id drop not null;

alter table public.baxter_message_sources
  drop constraint if exists baxter_message_sources_knowledge_entry_id_fkey;

alter table public.baxter_message_sources
  add constraint baxter_message_sources_knowledge_entry_id_fkey
  foreign key (knowledge_entry_id)
  references public.knowledge_entries (id)
  on delete set null;

create index if not exists baxter_message_sources_entry_idx
  on public.baxter_message_sources (knowledge_entry_id);

-- ---------------------------------------------------------------------------
-- knowledge_uploads — original uploaded documents for Knowledge Base imports
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_uploads (
  id uuid primary key default gen_random_uuid(),
  knowledge_entry_id uuid references public.knowledge_entries (id) on delete set null,
  storage_bucket text not null default 'knowledge-uploads',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  extension text,
  size_bytes bigint not null check (size_bytes >= 0),
  content_hash text not null,
  extraction_status text not null
    check (extraction_status in (
      'uploaded', 'parsing', 'ready', 'imported', 'failed', 'deleted',
      'success', 'partial', 'empty', 'unsupported'
    )),
  extraction_warnings jsonb not null default '[]'::jsonb,
  extracted_character_count integer,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  unique (storage_bucket, storage_path)
);

create index if not exists knowledge_uploads_entry_idx
  on public.knowledge_uploads (knowledge_entry_id);

create index if not exists knowledge_uploads_hash_idx
  on public.knowledge_uploads (content_hash);

create index if not exists knowledge_uploads_uploaded_by_idx
  on public.knowledge_uploads (uploaded_by, created_at desc);

create trigger knowledge_uploads_set_updated_at
  before update on public.knowledge_uploads
  for each row execute function public.set_updated_at();

alter table public.knowledge_uploads enable row level security;

create policy "Admins can read knowledge uploads"
  on public.knowledge_uploads for select
  to authenticated
  using (public.is_admin());

create policy "Admins can insert knowledge uploads"
  on public.knowledge_uploads for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update knowledge uploads"
  on public.knowledge_uploads for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete knowledge uploads"
  on public.knowledge_uploads for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Private storage bucket for knowledge document originals
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'knowledge-uploads',
  'knowledge-uploads',
  false,
  20971520,
  array[
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public = false;

drop policy if exists "Admins can read knowledge uploads storage" on storage.objects;
create policy "Admins can read knowledge uploads storage"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'knowledge-uploads'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "Admins can upload knowledge uploads storage" on storage.objects;
create policy "Admins can upload knowledge uploads storage"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'knowledge-uploads'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "Admins can update knowledge uploads storage" on storage.objects;
create policy "Admins can update knowledge uploads storage"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'knowledge-uploads'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    bucket_id = 'knowledge-uploads'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "Admins can delete knowledge uploads storage" on storage.objects;
create policy "Admins can delete knowledge uploads storage"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'knowledge-uploads'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
