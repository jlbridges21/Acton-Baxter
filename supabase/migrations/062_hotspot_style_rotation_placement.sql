-- Rotation is degrees. Placement chooses a camera-facing badge or a ground-plane marker.

alter table public.hotspots
  add column if not exists style_rotation integer not null default 0,
  add column if not exists style_placement text not null default 'billboard';

alter table public.hotspots
  drop constraint if exists hotspots_style_rotation_check;

alter table public.hotspots
  add constraint hotspots_style_rotation_check
  check (style_rotation >= 0 and style_rotation <= 359);

alter table public.hotspots
  drop constraint if exists hotspots_style_placement_check;

alter table public.hotspots
  add constraint hotspots_style_placement_check
  check (style_placement in ('billboard', 'floor'));
