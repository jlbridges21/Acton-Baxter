/**
 * Sprite packs for animated AI Office characters.
 *
 * A pack is a normalized manifest (see scripts/normalize-sprite-packs.mjs) plus a small
 * character definition: scale, desk metrics, which clips are its "thinking" and "task"
 * emotes, its idle routine, and whether it leaves its desk to the right. Clip lists and
 * timings always come from the manifest. Agents without a pack keep their static portrait.
 */

/** Clips every character shares; role-specific emotes (e.g. "hrTask") are extra names. */
export const CORE_CLIPS = ["idle", "walkRight", "walkLeft", "working", "sitDown", "standUp"] as const;

/** Baxter's original clip names, kept for the clips that have them. */
export const CLIP_NAMES = [...CORE_CLIPS, "thinking", "presenting"] as const;

export type ClipName = (typeof CLIP_NAMES)[number] | (string & {});

export type Vec = { x: number; y: number };

export type SpriteCanvas = { width: number; height: number; anchor: Vec; standPoint?: Vec };

export type SpriteClip = {
  canvas: "character" | "desk";
  loop: boolean;
  frameDurationMs: number;
  frames: string[];
};

/**
 * Desk artwork, in desk-canvas pixels: the tabletop centre, the floor footprint (blocks
 * walking), and where the seated character's feet are (for hit-testing and bubbles).
 */
export type DeskMetrics = {
  focus: Vec;
  footprint: { x: number; y: number; w: number; h: number };
  seatedFeet: Vec;
};

export type SpritePackManifest = {
  schemaVersion: 1;
  character: string;
  canvases: { character: SpriteCanvas; desk: SpriteCanvas };
  animations: Record<string, SpriteClip>;
  /** Baxter-compatible names → this character's clips (e.g. thinking → peopleThinking). */
  aliases?: Record<string, string>;
  desk?: DeskMetrics;
  /** The desk without the character, shown while they're away from it. */
  deskProp?: string;
};

export type AmbientWeights = { desk: number; look: number; think: number; task: number; wander: number };

export type SpritePackDefinition = {
  id: string;
  label: string;
  manifestUrl: string;
  /** World pixels per canvas pixel (keeps characters roughly the size of the office art). */
  scale: number;
  /** Desk metrics; when omitted they come from the manifest. */
  desk?: DeskMetrics;
  /** World pixels moved per walk frame, so paws match the ground speed. */
  strideWorldPx: number;
  /** Role emotes: `think` for analysis/receiving, `task` for the character's work gesture. */
  emotes: { think: string; present: string; task: string | null };
  /**
   * "right": autonomous routes from the desk start at a waypoint to its right, and returns
   * approach from there. null: no rule (Baxter, whose sit/stand art is beside the desk).
   */
  deskExit: "right" | null;
  /** Idle routine: activity weights and which room hotspots suit each activity. */
  ambient: {
    weights?: Partial<AmbientWeights>;
    spots: { look: string[]; think: string[]; task: string[] };
  };
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
    // Presenting is reserved for real results, so Baxter has no idle "task" gesture.
    emotes: { think: "thinking", present: "presenting", task: null },
    deskExit: null,
    ambient: {
      spots: {
        look: ["bookcase", "model", "window"],
        think: ["strategy", "visitors", "center"],
        task: [],
      },
    },
  },
  "sam-v1": {
    id: "sam-v1",
    label: "Sam tuxedo cat (HR)",
    manifestUrl: "/animations/sam/v1/manifest.json",
    scale: 0.32,
    strideWorldPx: 8,
    emotes: { think: "peopleThinking", present: "hrTask", task: "hrTask" },
    deskExit: "right",
    ambient: {
      weights: { desk: 3, look: 2, think: 2, task: 3, wander: 1 },
      spots: {
        look: ["tree", "policy", "files"],
        think: ["conversation", "center"],
        task: ["onboarding", "files", "policy"],
      },
    },
  },
  "dexter-v1": {
    id: "dexter-v1",
    label: "Dexter voxel dog (analytics)",
    manifestUrl: "/animations/dexter/v1/manifest.json",
    scale: 0.32,
    strideWorldPx: 9,
    emotes: { think: "dataThinking", present: "analyticsTask", task: "analyticsTask" },
    deskExit: "right",
    ambient: {
      weights: { desk: 3, look: 2, think: 3, task: 3, wander: 2 },
      spots: {
        look: ["dashboard", "datacab", "printer"],
        think: ["whiteboard", "dashboard"],
        task: ["reports", "whiteboard", "printer"],
      },
    },
  },
};

/** Default pack per agent slug (admins can override per agent). */
export const DEFAULT_PACK_BY_SLUG: Record<string, string> = { sam: "sam-v1", dexter: "dexter-v1" };

export const STATIC_PACK_ID = "none";

/** Clips a pack must have before we animate with it (everything else degrades gracefully). */
export const REQUIRED_CLIPS: ClipName[] = ["idle", "walkRight", "walkLeft"];

const CLIP_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

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
  for (const name of Object.keys(animations)) {
    const clip = animations[name] as SpriteClip | undefined;
    if (!clip) continue;
    const ok =
      CLIP_NAME_RE.test(name) &&
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
  if (m.aliases && typeof m.aliases === "object") {
    parsed.aliases = Object.fromEntries(
      Object.entries(m.aliases as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === "string" && CLIP_NAME_RE.test(e[0]),
      ),
    );
  }
  const desk = m.desk as DeskMetrics | undefined;
  if (desk && isVec(desk.focus) && isVec(desk.seatedFeet) && desk.footprint?.w > 0) {
    parsed.desk = desk;
  }
  if (typeof m.deskProp === "string" && m.deskProp.startsWith("/")) parsed.deskProp = m.deskProp;
  return { manifest: parsed, dropped };
}

/** Removes clips whose frames failed to load; returns null if the pack is no longer usable. */
export function withoutBrokenFrames(
  manifest: SpritePackManifest,
  broken: Set<string>,
): SpritePackManifest | null {
  const animations: SpritePackManifest["animations"] = {};
  for (const [name, clip] of Object.entries(manifest.animations)) {
    if (!clip.frames.some((f) => broken.has(f))) animations[name] = clip;
  }
  if (REQUIRED_CLIPS.some((c) => !animations[c])) return null;
  const deskProp = manifest.deskProp && broken.has(manifest.deskProp) ? undefined : manifest.deskProp;
  return { ...manifest, animations, deskProp };
}

export function allFrameUrls(manifest: SpritePackManifest): string[] {
  const urls = Object.values(manifest.animations).flatMap((c) => c?.frames ?? []);
  if (manifest.deskProp) urls.push(manifest.deskProp);
  return [...new Set(urls)];
}

/** A clip by its own name or a Baxter-compatible alias (thinking → dataThinking). */
export function resolveClip(
  manifest: Pick<SpritePackManifest, "animations" | "aliases">,
  name: string,
): { name: string; clip: SpriteClip } | null {
  const direct = manifest.animations[name];
  if (direct) return { name, clip: direct };
  const alias = manifest.aliases?.[name];
  const aliased = alias ? manifest.animations[alias] : undefined;
  return alias && aliased ? { name: alias, clip: aliased } : null;
}

/** Desk metrics for a pack: its definition first, then what the manifest measured. */
export function deskMetrics(def: SpritePackDefinition, manifest: SpritePackManifest): DeskMetrics | null {
  return def.desk ?? manifest.desk ?? null;
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

/** Which pack an agent uses: an explicit admin choice, else the character's own pack. */
export function resolvePackId(
  agent: { id: string; kind: "orchestrator" | "specialist"; slug?: string },
  assignments: Record<string, { sprite_pack?: string } | undefined>,
): string | null {
  const chosen = assignments[agent.id]?.sprite_pack;
  if (chosen === STATIC_PACK_ID) return null;
  if (chosen && SPRITE_PACKS[chosen]) return chosen;
  if (agent.kind === "orchestrator") return "baxter-v3";
  return (agent.slug && DEFAULT_PACK_BY_SLUG[agent.slug]) || null;
}
