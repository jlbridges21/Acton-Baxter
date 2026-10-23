/**
 * Admin-configurable AI Office animation settings, stored as one JSON column on
 * ai_workspace_settings (migration 069). Everything is optional and normalized here, so the
 * office keeps working with the defaults before the migration is applied.
 */

import { z } from "zod";
import type { AmbientIntensity } from "./ambient";
import type { HandoffSide } from "./navigation";
import { SPRITE_PACKS, STATIC_PACK_ID } from "./sprite-pack";

export type AnimationSpeed = "relaxed" | "normal" | "brisk";
export type HomeSpot = "desk" | "window" | "center";

export type AgentAnimationSettings = { sprite_pack?: string; handoff_side?: HandoffSide };

export type OfficeAnimationSettings = {
  ambient_intensity: AmbientIntensity;
  speed: AnimationSpeed;
  /** Where Baxter rests when decorative movement is off or between activities. */
  home_spot: HomeSpot;
  agents: Record<string, AgentAnimationSettings>;
};

export const DEFAULT_ANIMATION_SETTINGS: OfficeAnimationSettings = {
  ambient_intensity: "normal",
  speed: "normal",
  home_spot: "desk",
  agents: {},
};

export const SPEED_MULTIPLIER: Record<AnimationSpeed, number> = {
  relaxed: 0.8,
  normal: 1,
  brisk: 1.3,
};

const packIds = [STATIC_PACK_ID, ...Object.keys(SPRITE_PACKS)] as [string, ...string[]];

export const animationSettingsSchema = z.object({
  ambient_intensity: z.enum(["off", "low", "normal", "high"]).optional(),
  speed: z.enum(["relaxed", "normal", "brisk"]).optional(),
  home_spot: z.enum(["desk", "window", "center"]).optional(),
  agents: z
    .record(
      z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      z.object({
        sprite_pack: z.enum(packIds).optional(),
        handoff_side: z.enum(["auto", "left", "right", "front"]).optional(),
      }),
    )
    .optional(),
});

/** Accepts whatever is stored (possibly nothing, possibly from an older version). */
export function normalizeAnimationSettings(raw: unknown): OfficeAnimationSettings {
  const parsed = animationSettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) return { ...DEFAULT_ANIMATION_SETTINGS };
  return {
    ambient_intensity:
      parsed.data.ambient_intensity ?? DEFAULT_ANIMATION_SETTINGS.ambient_intensity,
    speed: parsed.data.speed ?? DEFAULT_ANIMATION_SETTINGS.speed,
    home_spot: parsed.data.home_spot ?? DEFAULT_ANIMATION_SETTINGS.home_spot,
    agents: parsed.data.agents ?? {},
  };
}
