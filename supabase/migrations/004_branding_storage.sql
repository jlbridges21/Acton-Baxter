-- Branding storage bucket setup
-- Run in Supabase SQL Editor after creating the branding-assets bucket in the dashboard,
-- or create the bucket via this insert if Storage API allows it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding-assets',
  'branding-assets',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated users can read branding assets" on storage.objects;
create policy "Authenticated users can read branding assets"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'branding-assets');

drop policy if exists "Admins can upload branding assets" on storage.objects;
create policy "Admins can upload branding assets"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'branding-assets'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "Admins can update branding assets" on storage.objects;
create policy "Admins can update branding assets"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'branding-assets'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    bucket_id = 'branding-assets'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "Admins can delete branding assets" on storage.objects;
create policy "Admins can delete branding assets"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'branding-assets'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
