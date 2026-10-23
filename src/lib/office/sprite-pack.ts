/**
 * Sprite packs for animated AI Office characters.
 *
 * A pack is a normalized manifest (see scripts/normalize-baxter-sprites.mjs) plus a little
 * hand-measured metadata about its desk artwork. Agents without a pack keep their static
 * portrait, so adding a new animated agent is: drop frames in /public, normalize them, and
 * register the pack below.
 */

export const CLIP_NAMES = [
  "idle",
  "walkRight",
  "walkLeft",
  "working",
  "sitDown",
  "standUp",
  "thinking",
  "presenting",
] as const;

export type ClipName = (typeof CLIP_NAMES)[number];

export type Vec = { x: number; y: number };

export type SpriteCanvas = { width: number; height: number; anchor: Vec; standPoint?: Vec };

export type SpriteClip = {
  canvas: "character" | "desk";
  loop: boolean;
  frameDurationMs: number;
  frames: string[];
};

export type SpritePackManifest = {
  schemaVersion: 1;
  character: string;
  canvases: { character: SpriteCanvas; desk: SpriteCanvas };
  animations: Partial<Record<ClipName, SpriteClip>>;
};

export type SpritePackDefinition = {
  id: string;
  label: string;
  manifestUrl: string;
  /** World pixels per canvas pixel (keeps characters roughly the size of the office art). */
  scale: number;
  /**
   * Desk artwork, in desk-canvas pixels: the tabletop centre, the floor footprint (blocks
   * walking), and where the seated character's feet are (for hit-testing and bubbles).
   */
  desk: { focus: Vec; footprint: { x: number; y: number; w: number; h: number }; seatedFeet: Vec };
  /** World pixels moved per walk frame, so paws match the ground speed. */
  strideWorldPx: number;
};

export const SPRITE_PACKS: Record<string, SpritePackDefinition> = {
  "baxter-v3": {
    id: "baxter-v3",
    label: "Baxter voxel cat (V3)",
    manifestUrl: "/animations/baxter/v3/manifest.json",
    scale: 0.32,
    desk: {
      focus: { x: 168, y: 156 },
      footprint: { x: 85, y: 140, w: 183, h: 92 },
      seatedFeet: { x: 145, y: 222 },
    },
    strideWorldPx: 8,
  },
};

export const STATIC_PACK_ID = "none";

/** Clips a pack must have before we animate with it (everything else degrades gracefully). */
export const REQUIRED_CLIPS: ClipName[] = ["idle", "walkRight", "walkLeft"];

export class SpritePackError extends Error {}

function isVec(v: unknown): v is Vec {
  return (
    !!v &&
    typeof (v as Vec).x === "number" &&
    typeof (v as Vec).y === "number" &&
    Number.isFinite((v as Vec).x) &&
    Number.isFinite((v as Vec).y)
  );
}

function parseCanvas(v: unknown, name: string): SpriteCanvas {
  const c = v as SpriteCanvas;
  if (!c || !(c.width > 0) || !(c.height > 0) || !isVec(c.anchor)) {
    throw new SpritePackError(`canvas "${name}" is invalid`);
  }
  return {
    width: c.width,
    height: c.height,
    anchor: c.anchor,
    ...(isVec(c.standPoint) ? { standPoint: c.standPoint } : {}),
  };
}

/**
 * Validates an untrusted manifest. Unknown clips are ignored; malformed clips are dropped
 * (and reported) rather than failing the whole pack, unless a required clip is unusable.
 */
export function parseSpritePackManifest(raw: unknown): {
  manifest: SpritePackManifest;
  dropped: string[];
} {
  const m = raw as Record<string, unknown>;
  if (!m || m.schemaVersion !== 1) throw new SpritePackError("unsupported manifest version");
  const canvases = m.canvases as Record<string, unknown> | undefined;
  if (!canvases) throw new SpritePackError("manifest has no canvases");
  const parsed: SpritePackManifest = {
    schemaVersion: 1,
    character: String(m.character ?? "character"),
    canvases: {
      character: parseCanvas(canvases.character, "character"),
      desk: parseCanvas(canvases.desk, "desk"),
    },
    animations: {},
  };
  const dropped: string[] = [];
  const animations = (m.animations ?? {}) as Record<string, unknown>;
  for (const name of CLIP_NAMES) {
    const clip = animations[name] as SpriteClip | undefined;
    if (!clip) continue;
    const ok =
      (clip.canvas === "character" || clip.canvas === "desk") &&
      typeof clip.loop === "boolean" &&
      clip.frameDurationMs > 0 &&
      Array.isArray(clip.frames) &&
      clip.frames.length > 0 &&
      clip.frames.every((f) => typeof f === "string" && f.startsWith("/"));
    if (!ok) {
      dropped.push(name);
      continue;
    }
    parsed.animations[name] = {
      canvas: clip.canvas,
      loop: clip.loop,
      frameDurationMs: clip.frameDurationMs,
      frames: [...clip.frames],
    };
  }
  const missing = REQUIRED_CLIPS.filter((c) => !parsed.animations[c]);
  if (missing.length) throw new SpritePackError(`missing required clips: ${missing.join(", ")}`);
  return { manifest: parsed, dropped };
}

/** Removes clips whose frames failed to load; returns null if the pack is no longer usable. */
export function withoutBrokenFrames(
  manifest: SpritePackManifest,
  broken: Set<string>,
): SpritePackManifest | null {
  const animations: SpritePackManifest["animations"] = {};
  for (const [name, clip] of Object.entries(manifest.animations) as Array<[ClipName, SpriteClip]>) {
    if (!clip.frames.some((f) => broken.has(f))) animations[name] = clip;
  }
  if (REQUIRED_CLIPS.some((c) => !animations[c])) return null;
  return { ...manifest, animations };
}

export function allFrameUrls(manifest: SpritePackManifest): string[] {
  return [...new Set(Object.values(manifest.animations).flatMap((c) => c?.frames ?? []))];
}

/** Total one-shot duration of a clip. */
export function clipDurationMs(clip: Pick<SpriteClip, "frames" | "frameDurationMs">): number {
  return clip.frames.length * clip.frameDurationMs;
}

/** Frame index at `elapsedMs`: loops wrap, one-shots hold their last frame. */
export function frameAt(
  clip: Pick<SpriteClip, "frames" | "frameDurationMs" | "loop">,
  elapsedMs: number,
): number {
  const n = clip.frames.length;
  const raw = Math.floor(Math.max(0, elapsedMs) / clip.frameDurationMs);
  return clip.loop ? raw % n : Math.min(raw, n - 1);
}

/** Which pack an agent uses: an explicit admin choice, else Baxter gets his own pack. */
export function resolvePackId(
  agent: { id: string; kind: "orchestrator" | "specialist" },
  assignments: Record<string, { sprite_pack?: string } | undefined>,
): string | null {
  const chosen = assignments[agent.id]?.sprite_pack;
  if (chosen === STATIC_PACK_ID) return null;
  if (chosen && SPRITE_PACKS[chosen]) return chosen;
  return agent.kind === "orchestrator" ? "baxter-v3" : null;
}
