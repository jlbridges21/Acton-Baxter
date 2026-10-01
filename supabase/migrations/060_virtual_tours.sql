-- 360° virtual tours. Shared team records (like site inspections): any app-access
-- role can read and write. Owner is attribution only.
--
-- Run this by hand in the Baxter SQL editor. Do not apply it through the
-- Cursor Supabase connector — that project is not Baxter.
--
-- Storage: private bucket tour-panoramas. Public viewing (a later prompt) must
-- use server-minted signed URLs, never a public object URL.
--
-- file_size_limit is 200MB. Supabase's project-wide Storage upload limit
-- (Dashboard → Storage → Settings) overrides this and returns
-- "413 Maximum size exceeded" when the global cap is lower. This repo cannot
-- read that live setting. Site-inspection videos upload with no bucket cap
-- (migrations 049 and 054), which means the project cap has been raised for
-- large files — confirm it is still at least 200MB before relying on panoramas.

create table if not exists public.tours (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete restrict,
  title text not null default 'Untitled Tour',
  description text,
  slug text not null,
  cover_scene_id uuid,
  is_public boolean not null default false,
  project_number text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists tours_slug_idx on public.tours (slug);
create index if not exists tours_owner_id_idx on public.tours (owner_id);

drop trigger if exists tours_set_updated_at on public.tours;
create trigger tours_set_updated_at
  before update on public.tours
  for each row execute function public.set_updated_at();

comment on table public.tours is
  '360° virtual tours. Shared across app-access users. owner_id is attribution, not a permission boundary.';
comment on column public.tours.project_number is
  'Optional Master Project Log number. No picker in the first tours UI.';
comment on column public.tours.cover_scene_id is
  'Scene whose thumbnail is the tour card. Null until the first scene is saved.';

create table if not exists public.scenes (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours (id) on delete cascade,
  name text not null default 'Scene',
  storage_path text not null,
  compat_path text,
  thumbnail_path text,
  width integer,
  height integer,
  position integer not null default 0,
  initial_yaw double precision not null default 0,
  initial_pitch double precision not null default 0,
  has_initial_view boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists scenes_tour_position_idx on public.scenes (tour_id, position);

comment on column public.scenes.storage_path is
  'Untouched original panorama bytes. Path {tour_id}/{scene_id}.{ext} where ext is jpg or png. Existing rows keep whatever path was stored.';
comment on column public.scenes.compat_path is
  '4096×2048 JPEG fallback, only when the original is wider than 4096.';
comment on column public.scenes.thumbnail_path is
  '800×400 JPEG for tour cards and the scene list.';

alter table public.tours
  drop constraint if exists fk_cover_scene;

alter table public.tours
  add constraint fk_cover_scene
  foreign key (cover_scene_id) references public.scenes (id) on delete set null;

create table if not exists public.hotspots (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  target_scene_id uuid references public.scenes (id) on delete cascade,
  type text not null default 'link' check (type in ('link', 'info')),
  yaw double precision not null,
  pitch double precision not null,
  label text,
  content text,
  style_shape text not null default 'arrow',
  style_color text not null default '#FFFFFF' check (style_color ~ '^#[0-9A-Fa-f]{6}$'),
  style_size integer not null default 48 check (style_size between 16 and 128),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists hotspots_scene_id_idx on public.hotspots (scene_id);
create index if not exists hotspots_target_scene_id_idx on public.hotspots (target_scene_id);

comment on table public.hotspots is
  'Scene links and info markers. No editor in the foundation prompt.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.tours enable row level security;
alter table public.scenes enable row level security;
alter table public.hotspots enable row level security;

-- App-access check. The uid call is wrapped in a scalar subquery so Postgres plans it once.
drop policy if exists "App users can read tours" on public.tours;
drop policy if exists "App users can insert tours" on public.tours;
drop policy if exists "App users can update tours" on public.tours;
drop policy if exists "App users can delete tours" on public.tours;
drop policy if exists "Anyone can read public tours" on public.tours;
drop policy if exists "App users can read scenes" on public.scenes;
drop policy if exists "App users can insert scenes" on public.scenes;
drop policy if exists "App users can update scenes" on public.scenes;
drop policy if exists "App users can delete scenes" on public.scenes;
drop policy if exists "Anyone can read scenes of public tours" on public.scenes;
drop policy if exists "App users can read hotspots" on public.hotspots;
drop policy if exists "App users can insert hotspots" on public.hotspots;
drop policy if exists "App users can update hotspots" on public.hotspots;
drop policy if exists "App users can delete hotspots" on public.hotspots;
drop policy if exists "Anyone can read hotspots of public tours" on public.hotspots;

create policy "App users can read tours"
  on public.tours for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "App users can insert tours"
  on public.tours for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "App users can update tours"
  on public.tours for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "App users can delete tours"
  on public.tours for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "Anyone can read public tours"
  on public.tours for select
  to anon
  using (is_public = true);

create policy "App users can read scenes"
  on public.scenes for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "App users can insert scenes"
  on public.scenes for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "App users can update scenes"
  on public.scenes for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "App users can delete scenes"
  on public.scenes for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "Anyone can read scenes of public tours"
  on public.scenes for select
  to anon
  using (
    exists (
      select 1 from public.tours t
      where t.id = tour_id and t.is_public = true
    )
  );

create policy "App users can read hotspots"
  on public.hotspots for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "App users can insert hotspots"
  on public.hotspots for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "App users can update hotspots"
  on public.hotspots for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "App users can delete hotspots"
  on public.hotspots for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

create policy "Anyone can read hotspots of public tours"
  on public.hotspots for select
  to anon
  using (
    exists (
      select 1
      from public.scenes s
      join public.tours t on t.id = s.tour_id
      where s.id = scene_id and t.is_public = true
    )
  );

-- ---------------------------------------------------------------------------
-- Private panoramas. 200MB bucket cap. Confirm the project-wide Storage limit
-- in the dashboard is at least this large before uploading full-size files.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tour-panoramas',
  'tour-panoramas',
  false,
  209715200,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "App users can read tour panoramas" on storage.objects;
create policy "App users can read tour panoramas"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'tour-panoramas'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

drop policy if exists "App users can upload tour panoramas" on storage.objects;
create policy "App users can upload tour panoramas"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'tour-panoramas'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

drop policy if exists "App users can update tour panoramas" on storage.objects;
create policy "App users can update tour panoramas"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'tour-panoramas'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  )
  with check (
    bucket_id = 'tour-panoramas'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );

drop policy if exists "App users can delete tour panoramas" on storage.objects;
create policy "App users can delete tour panoramas"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'tour-panoramas'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('user', 'admin', 'super_admin')
    )
  );
