/**
 * Ambient (decorative) behaviour: what an animated character does while it has no real
 * work. Entirely client-side and deterministic given an RNG — it never calls a model,
 * never writes to the database, and never implies a task is running.
 */

import type { Action } from "./character-brain";
import type { Hotspot } from "./navigation";
import type { Vec } from "./sprite-pack";

export type AmbientIntensity = "off" | "low" | "normal" | "high";
export type AmbientActivity = "desk" | "look" | "think" | "wander" | "rest";

export type AmbientMemory = {
  last: AmbientActivity | null;
  lastSpot: string | null;
  /** Time (ms) the last desk routine was planned; desk visits are spaced out. */
  lastDeskAt: number;
};

export const EMPTY_AMBIENT_MEMORY: AmbientMemory = {
  last: null,
  lastSpot: null,
  lastDeskAt: -Infinity,
};

type Profile = {
  pause: [number, number];
  seated: [number, number];
  deskCooldown: number;
  weights: Record<Exclude<AmbientActivity, "rest">, number>;
};

export const AMBIENT_PROFILES: Record<Exclude<AmbientIntensity, "off">, Profile> = {
  low: {
    pause: [7000, 14000],
    seated: [26000, 48000],
    deskCooldown: 60000,
    weights: { desk: 4, look: 2, think: 1, wander: 1 },
  },
  normal: {
    pause: [3500, 8000],
    seated: [14000, 28000],
    deskCooldown: 40000,
    weights: { desk: 3, look: 3, think: 2, wander: 3 },
  },
  high: {
    pause: [2000, 4500],
    seated: [8000, 15000],
    deskCooldown: 25000,
    weights: { desk: 2, look: 3, think: 2, wander: 4 },
  },
};

export type AmbientContext = {
  rng: () => number;
  now: number;
  intensity: AmbientIntensity;
  position: Vec;
  seated: boolean;
  canSit: boolean;
  /** Idle hotspots inside the character's own office. */
  spots: Hotspot[];
  randomPoint: () => Vec | null;
  memory: AmbientMemory;
};

export type AmbientPlan = { activity: AmbientActivity; actions: Action[]; memory: AmbientMemory };

const between = (rng: () => number, [a, b]: [number, number]) => Math.round(a + rng() * (b - a));
const far = (a: Vec, b: Vec, d: number) => Math.hypot(a.x - b.x, a.y - b.y) >= d;

export function planAmbient(ctx: AmbientContext): AmbientPlan {
  const { rng, memory } = ctx;
  if (ctx.intensity === "off") {
    // Decorative movement disabled: sit quietly at the desk (or stand still).
    return {
      activity: "rest",
      actions: [
        ctx.canSit
          ? { kind: "seated", mode: "idle", ms: null, micro: false }
          : { kind: "idle", ms: null, micro: false },
      ],
      memory: { ...memory, last: "rest" },
    };
  }
  const profile = AMBIENT_PROFILES[ctx.intensity];

  // Already seated (e.g. after waiting on a specialist): stay a while before getting up,
  // so the character never stands up the moment it sat down.
  if (ctx.seated) {
    return {
      activity: "desk",
      actions: [
        { kind: "seated", mode: "idle", ms: between(rng, profile.seated) / 2 },
        { kind: "stand" },
        { kind: "idle", ms: between(rng, profile.pause) },
      ],
      memory: { ...memory, last: "desk", lastDeskAt: ctx.now },
    };
  }

  const spots = ctx.spots.filter((s) => s.id !== memory.lastSpot && far(s, ctx.position, 40));
  const options = (Object.keys(profile.weights) as Array<keyof Profile["weights"]>).filter((a) => {
    if (a === memory.last) return false; // no immediate repeats
    if (a === "desk") return ctx.canSit && ctx.now - memory.lastDeskAt >= profile.deskCooldown;
    if (a === "look" || a === "think") return spots.length > 0;
    return true;
  });
  const pool = options.length ? options : (["wander"] as const);
  const total = pool.reduce((s, a) => s + profile.weights[a], 0);
  let roll = rng() * total;
  const activity = pool.find((a) => (roll -= profile.weights[a]) < 0) ?? pool[0]!;
  const pause = between(rng, profile.pause);

  switch (activity) {
    case "desk": {
      const seated = between(rng, profile.seated);
      // A short, decorative typing burst — the status UI stays "Available".
      const burst = Math.round(seated * (0.2 + rng() * 0.15));
      return {
        activity,
        actions: [
          { kind: "sit" },
          { kind: "seated", mode: "idle", ms: Math.round((seated - burst) * 0.5) },
          { kind: "seated", mode: "work", ms: burst },
          { kind: "seated", mode: "idle", ms: Math.round((seated - burst) * 0.5) },
          { kind: "stand" },
          { kind: "idle", ms: Math.round(pause * 0.6) },
        ],
        memory: { ...memory, last: activity, lastDeskAt: ctx.now },
      };
    }
    case "look": {
      const spot = pickSpot(spots, rng, ["window", "shelf", "plant"]);
      return {
        activity,
        actions: [
          { kind: "walk", to: spot },
          { kind: "idle", ms: 600, micro: false },
          { kind: "pose", visual: "look_around", ms: 1500 },
          { kind: "idle", ms: Math.round(pause / 2) },
          { kind: "pose", visual: "tail_flick", ms: 800 },
          { kind: "idle", ms: Math.round(pause / 2) },
        ],
        memory: { ...memory, last: activity, lastSpot: spot.id },
      };
    }
    case "think": {
      const spot = pickSpot(spots, rng, ["center", "corner", "window"]);
      return {
        activity,
        actions: [
          { kind: "walk", to: spot },
          { kind: "idle", ms: 500, micro: false },
          { kind: "emote", clip: "thinking", holdMs: 700 },
          { kind: "idle", ms: pause },
        ],
        memory: { ...memory, last: activity, lastSpot: spot.id },
      };
    }
    default: {
      let target: Vec | null = null;
      for (let i = 0; i < 6 && !target; i++) {
        const p = ctx.randomPoint();
        if (p && far(p, ctx.position, 70)) target = p;
      }
      return {
        activity: "wander",
        actions: target
          ? [
              { kind: "walk", to: target },
              { kind: "idle", ms: pause },
            ]
          : [{ kind: "idle", ms: pause }],
        memory: { ...memory, last: "wander", lastSpot: null },
      };
    }
  }
}

function pickSpot(spots: Hotspot[], rng: () => number, prefer: string[]): Hotspot {
  const preferred = spots.filter((s) => prefer.some((p) => s.id.endsWith(`:${p}`)));
  const pool = preferred.length ? preferred : spots;
  return pool[Math.floor(rng() * pool.length) % pool.length]!;
}
