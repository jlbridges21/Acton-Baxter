-- Author-controlled scene transition and idle autorotate.
--
-- Run this by hand in the Baxter SQL editor. Do not apply it through the
-- Cursor Supabase connector — that project is not Baxter.
--
-- Existing rows receive the column defaults: fade, fast, directional motion
-- off, autorotate off.

alter table public.tours
  add column if not exists transition_effect text not null default 'fade',
  add column if not exists transition_speed text not null default 'fast',
  add column if not exists transition_directional boolean not null default false,
  add column if not exists autorotate boolean not null default false;

alter table public.tours
  drop constraint if exists tours_transition_effect_check;

alter table public.tours
  add constraint tours_transition_effect_check
  check (transition_effect in ('none', 'fade', 'black', 'white'));

alter table public.tours
  drop constraint if exists tours_transition_speed_check;

alter table public.tours
  add constraint tours_transition_speed_check
  check (transition_speed in ('fast', 'normal', 'slow'));

comment on column public.tours.transition_effect is
  'Scene change: none (instant cut), fade, black, or white.';
comment on column public.tours.transition_speed is
  'fast = 500ms (Photo Sphere Viewer floor), normal = 1000ms, slow = 1500ms. The editor always previews fast.';
comment on column public.tours.transition_directional is
  'When true, a link click turns and zooms toward that hotspot during the change.';
comment on column public.tours.autorotate is
  'When true, a published tour drifts after the view sits idle. Never used in the editor.';
