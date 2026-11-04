-- Acton ADU Configurator: draft document, published releases, rendering library.
--
-- Run this by hand in the Baxter SQL editor (see README "Supabase migrations").
-- Additive and idempotent. The app reports "Configurator is not set up yet" until it runs.
--
-- Model:
--   configurator_documents  key 'draft' holds the whole editable catalog (models, shared
--                           styles, regions, prices, render mappings) as one JSON document
--                           with an optimistic `revision`. key 'import_report' holds the
--                           latest asset/data import report.
--   configurator_releases   immutable published snapshots. The public configurator reads the
--                           highest version only. Rollback re-publishes an old snapshot as a
--                           new version, so history stays linear.
--   configurator_assets     every rendering/floorplan image with provenance and the
--                           importer's classification.
--
-- Access: Baxter admins only (public.is_admin()). The public configurator never queries these
-- tables directly; Next.js route handlers read the current release with the service role and
-- strip prices before anything reaches the browser.
--
-- Storage: bucket configurator-assets is PUBLIC so rendering images are served from the
-- Supabase CDN. Object keys are content hashes (sha256), so unpublished images are not
-- discoverable; renderings are marketing images, not sensitive data.

create table if not exists public.configurator_documents (
  key text primary key check (key in ('draft', 'import_report')),
  body jsonb not null,
  revision integer not null default 1,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.configurator_documents is
  'Configurator draft catalog (key=draft) and latest import report (key=import_report).';

create table if not exists public.configurator_releases (
  id uuid primary key default gen_random_uuid(),
  version integer not null,
  snapshot jsonb not null,
  summary jsonb not null default '{}'::jsonb,
  notes text not null default '',
  published_at timestamptz not null default timezone('utc', now()),
  published_by uuid references public.profiles (id) on delete set null,
  rolled_back_from integer
);

create unique index if not exists configurator_releases_version_idx
  on public.configurator_releases (version);

comment on table public.configurator_releases is
  'Immutable published configurator snapshots. Highest version is live.';

create table if not exists public.configurator_assets (
  id uuid primary key default gen_random_uuid(),
  display_path text not null,
  thumb_path text not null,
  width integer,
  height integer,
  bytes bigint,
  sha256 text not null,
  original_name text not null,
  source text not null check (source in ('local_import', 'legacy_site', 'upload')),
  provenance text not null default '',
  classification jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid references public.profiles (id) on delete set null
);

create unique index if not exists configurator_assets_sha256_idx
  on public.configurator_assets (sha256);

comment on column public.configurator_assets.provenance is
  'Where the image came from: local Models/ folder path, legacy design.actonadu.com URL, or uploader.';
comment on column public.configurator_assets.classification is
  'Importer/admin belief about the image: kind, model, style, role, ceiling, variant, confidence.';

alter table public.configurator_documents enable row level security;
alter table public.configurator_releases enable row level security;
alter table public.configurator_assets enable row level security;

drop policy if exists "Admins manage configurator documents" on public.configurator_documents;
create policy "Admins manage configurator documents"
  on public.configurator_documents for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins manage configurator releases" on public.configurator_releases;
create policy "Admins manage configurator releases"
  on public.configurator_releases for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins manage configurator assets" on public.configurator_assets;
create policy "Admins manage configurator assets"
  on public.configurator_assets for all
  using (public.is_admin())
  with check (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'configurator-assets',
  'configurator-assets',
  true,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins write configurator assets" on storage.objects;
create policy "Admins write configurator assets"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'configurator-assets' and public.is_admin());

drop policy if exists "Admins update configurator assets" on storage.objects;
create policy "Admins update configurator assets"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'configurator-assets' and public.is_admin());

drop policy if exists "Admins delete configurator assets" on storage.objects;
create policy "Admins delete configurator assets"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'configurator-assets' and public.is_admin());
