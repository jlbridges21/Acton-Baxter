-- AI Office animation settings (Baxter V3 sprites).
--
-- One JSON column on the singleton workspace settings row. Shape (all keys optional,
-- normalized in src/lib/office/animation-settings.ts):
--   {
--     "ambient_intensity": "off" | "low" | "normal" | "high",
--     "speed": "relaxed" | "normal" | "brisk",
--     "home_spot": "desk" | "window" | "center",
--     "agents": { "<agent id>": { "sprite_pack": "none" | "baxter-v3",
--                                 "handoff_side": "auto" | "left" | "right" | "front" } }
--   }
--
-- Purely presentational: decorative movement is never stored per frame, and no task data
-- lives here. Existing RLS on ai_workspace_settings (service role writes, admins via API)
-- applies unchanged. Safe to re-run.

alter table public.ai_workspace_settings
  add column if not exists animation_settings jsonb not null default '{}'::jsonb;
