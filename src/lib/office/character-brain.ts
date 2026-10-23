/**
 * Visual state machine for one animated office character.
 *
 * The brain runs a prioritized plan of small actions (walk, sit, work, emote, …) and turns
 * it into a render state each tick. It knows nothing about tasks, React, or the network:
 * callers decide *what* the character should do (from real task state or the ambient
 * planner) and the brain decides *how* it looks while doing it — standing up before
 * walking, walking to the desk before sitting, finishing a sit/stand transition before
 * honouring an interruption, and so on.
 */

import type { ClipName, Vec } from "./sprite-pack";

export type VisualState =
  | "idle"
  | "blink"
  | "look_around"
  | "tail_flick"
  | "walking_left"
  | "walking_right"
  | "sitting_down"
  | "seated_idle"
  | "working"
  | "standing_up"
  | "thinking"
  | "presenting";

export type Facing = "left" | "right";

export type Action =
  | { kind: "walk"; to: Vec; speed?: "stroll" | "hurry" }
  | { kind: "idle"; ms: number | null; micro?: boolean }
  | { kind: "pose"; visual: "look_around" | "tail_flick" | "blink"; ms: number }
  /** A one-shot emote clip, by the character's own clip name (e.g. "hrTask"). */
  | { kind: "emote"; clip: string; repeat?: number; holdMs?: number }
  | { kind: "sit" }
  | { kind: "stand" }
  | { kind: "seated"; mode: "idle" | "work"; ms: number | null; micro?: boolean }
  | { kind: "mark"; id: string };

/** Lower number wins. Equal priority replaces (a fresher plan of the same kind). */
export const PRIORITY = {
  manual: 0, // the user is directing this character (click-to-move, interrupt)
  critical: 1, // collaboration hand-offs, failures
  task: 2, // the character's own active task
  completion: 3, // reviewing/presenting a finished result
  ambient: 4, // scheduled idle activities and passive task modes
  idle: 5, // nothing planned
} as const;

export type Plan = {
  id: string;
  priority: number;
  actions: Action[];
  /** Free-form label for callers (e.g. "ambient:desk", "handoff:<taskId>"). */
  tag?: string;
  /** User-directed: walks go straight to the target (no desk-exit waypoint). */
  manual?: boolean;
};

export type RenderState = {
  /** Where the brain thinks this pose happens; the director may override from the clip art. */
  scene: "character" | "desk";
  clip: ClipName;
  frame: number;
  /** Feet position in office-world coordinates. */
  x: number;
  y: number;
  facing: Facing;
  visual: VisualState;
};

export type ClipTiming = { frames: number; frameDurationMs: number; loop: boolean };

export type BrainOptions = {
  clips: Partial<Record<ClipName, ClipTiming>>;
  findPath: (from: Vec, to: Vec) => Vec[] | null;
  /**
   * Desk approach point; null means this character can't sit (seated actions degrade).
   * `exit`: a waypoint (right of the desk) every autonomous route to or from the desk
   * passes through, so the character never leaves past clutter on the desk's left.
   */
  desk: { stand: Vec; exit?: Vec | null } | null;
  start: Vec;
  startSeated?: boolean;
  strideWorldPx: number;
  rng?: () => number;
  /** Walk-speed multiplier (admin "animation speed" preset). */
  speed?: number;
  reducedMotion?: boolean;
  onMark?: (id: string, plan: Plan) => void;
  onPlanEnd?: (plan: Plan, completed: boolean) => void;
};

const WALK_SPEED = { stroll: 52, hurry: 92 }; // world px / second
const IDLE_FRAME = { idle: 0, blink: 1, look_around: 2, tail_flick: 3 } as const;
const MICRO = [
  { visual: "blink" as const, weight: 5, ms: 170 },
  { visual: "look_around" as const, weight: 3, ms: 1400 },
  { visual: "tail_flick" as const, weight: 2, ms: 750 },
];

type Active =
  | { kind: "walk"; path: Vec[]; seg: number; walked: number; speed: number }
  | { kind: "idle"; ms: number | null; elapsed: number; micro: boolean; pose: Pose }
  | { kind: "pose"; visual: "look_around" | "tail_flick" | "blink"; ms: number; elapsed: number }
  | { kind: "emote"; clip: string; total: number; play: number; elapsed: number }
  | { kind: "sit" | "stand"; total: number; elapsed: number }
  | {
      kind: "seated";
      mode: "idle" | "work";
      ms: number | null;
      elapsed: number;
      micro: boolean;
      blinkAt: number;
      blinkUntil: number;
    };

type Pose = {
  visual: "idle" | "blink" | "look_around" | "tail_flick";
  until: number;
  nextAt: number;
};

export class CharacterBrain {
  private opts: BrainOptions;
  private rng: () => number;
  private pos: Vec;
  private facing: Facing = "right";
  private seated: boolean;
  private plan: Plan | null = null;
  private pending: Plan | null = null;
  private queue: Action[] = [];
  private active: Active;
  private reduced: boolean;

  constructor(opts: BrainOptions) {
    this.opts = opts;
    this.rng = opts.rng ?? Math.random;
    this.reduced = Boolean(opts.reducedMotion);
    this.seated = Boolean(opts.startSeated && opts.desk && opts.clips.working);
    this.pos = this.seated && opts.desk ? { ...opts.desk.stand } : { ...opts.start };
    this.active = this.holdAction();
  }

  // -- public API ----------------------------------------------------------

  get position(): Vec {
    return { ...this.pos };
  }
  get isSeated() {
    return this.seated;
  }
  get currentPlan(): Plan | null {
    return this.plan;
  }
  get pendingPlan(): Plan | null {
    return this.pending;
  }
  /** True while a sit/stand transition is playing (the only non-interruptible moments). */
  get inTransition() {
    return this.active.kind === "sit" || this.active.kind === "stand";
  }

  setReducedMotion(value: boolean) {
    this.reduced = value;
  }

  setSpeed(multiplier: number) {
    this.opts.speed = multiplier;
  }

  /**
   * Requests a plan. Returns false if a higher-priority plan is running. Transitions are
   * allowed to finish first (the plan waits in `pendingPlan`), everything else is
   * interrupted immediately from wherever the character currently is.
   */
  setPlan(plan: Plan, options?: { force?: boolean }): boolean {
    const current = this.pending ?? this.plan;
    if (current && !options?.force && plan.priority > current.priority) return false;
    if (this.inTransition) {
      if (this.pending) this.opts.onPlanEnd?.(this.pending, false);
      this.pending = plan;
      return true;
    }
    this.start(plan);
    return true;
  }

  /** Drops the current plan (if `tag` matches, when given) and holds still. */
  cancel(tag?: string) {
    if (this.pending && (!tag || this.pending.tag === tag)) {
      const p = this.pending;
      this.pending = null;
      this.opts.onPlanEnd?.(p, false);
    }
    if (this.plan && (!tag || this.plan.tag === tag) && this.inTransition) {
      // Let the sit/stand finish, then end the plan there.
      this.queue = [];
      return;
    }
    if (this.plan && (!tag || this.plan.tag === tag)) {
      const p = this.plan;
      this.plan = null;
      this.queue = [];
      this.active = this.holdAction();
      this.opts.onPlanEnd?.(p, false);
    }
  }

  update(dtMs: number): RenderState {
    // Big gaps (background tab) shouldn't fast-forward a whole routine at once.
    let dt = Math.min(Math.max(dtMs, 0), 250);
    // A finished action hands leftover time to the next one; cap iterations for safety.
    for (let i = 0; i < 8 && dt >= 0; i++) {
      const leftover = this.step(dt);
      if (leftover === null) break;
      dt = leftover;
    }
    return this.render();
  }

  // -- plan execution ----------------------------------------------------------

  private start(plan: Plan) {
    const previous = this.plan;
    this.plan = plan;
    this.queue = [...plan.actions];
    if (previous && previous !== plan) this.opts.onPlanEnd?.(previous, false);
    this.advance();
  }

  private holdAction(): Active {
    return this.seated
      ? {
          kind: "seated",
          mode: "idle",
          ms: null,
          elapsed: 0,
          micro: true,
          blinkAt: 2500,
          blinkUntil: 0,
        }
      : { kind: "idle", ms: null, elapsed: 0, micro: true, pose: this.freshPose(0) };
  }

  private advance() {
    for (let guard = 0; guard < 32; guard++) {
      const action = this.queue.shift();
      if (!action) {
        const done = this.plan;
        this.plan = null;
        this.active = this.holdAction();
        if (done) this.opts.onPlanEnd?.(done, true);
        return;
      }
      const desk = this.opts.desk;
      const canSit = Boolean(desk && this.opts.clips.working);
      switch (action.kind) {
        case "mark":
          if (this.plan) this.opts.onMark?.(action.id, this.plan);
          // onMark may have replaced the plan; keep going with whatever is queued now.
          continue;
        case "walk": {
          if (this.seated) {
            this.queue.unshift(action);
            this.beginStand();
            return;
          }
          const exit = this.opts.desk?.exit;
          if (
            exit &&
            !this.plan?.manual &&
            this.atDesk() &&
            dist(action.to, exit) > 3 &&
            dist(action.to, desk!.stand) > 3
          ) {
            // Leave the desk to the right first, then carry on.
            this.queue.unshift({ kind: "walk", to: exit, speed: action.speed }, action);
            continue;
          }
          if (this.reduced) {
            // Reduced motion: no walking across the screen, just appear at the destination.
            this.pos = { ...action.to };
            continue;
          }
          const path = this.opts.findPath(this.pos, action.to);
          if (!path || path.length < 2) continue; // unreachable or already there
          const speed = WALK_SPEED[action.speed ?? "stroll"] * (this.opts.speed ?? 1);
          this.active = { kind: "walk", path, seg: 1, walked: 0, speed };
          return;
        }
        case "idle":
        case "pose":
        case "emote":
          if (this.seated) {
            this.queue.unshift(action);
            this.beginStand();
            return;
          }
          this.active = this.beginStanding(action);
          return;
        case "sit":
          if (!canSit || this.seated) continue;
          if (dist(this.pos, desk!.stand) > 3) {
            const exit = desk!.exit;
            // Right-exit desks are approached from their exit waypoint too.
            if (exit && !this.plan?.manual && dist(this.pos, exit) > 3) {
              this.queue.unshift({ kind: "walk", to: exit }, { kind: "walk", to: desk!.stand }, action);
            } else {
              this.queue.unshift({ kind: "walk", to: desk!.stand }, action);
            }
            continue;
          }
          this.pos = { ...desk!.stand };
          this.active = { kind: "sit", total: this.oneShot("sitDown"), elapsed: 0 };
          return;
        case "stand":
          if (!this.seated) continue;
          this.beginStand();
          return;
        case "seated":
          if (!canSit) {
            this.active = this.beginStanding({ kind: "idle", ms: action.ms, micro: action.micro });
            return;
          }
          if (!this.seated) {
            this.queue.unshift({ kind: "sit" }, action);
            continue;
          }
          this.active = {
            kind: "seated",
            mode: action.mode,
            ms: action.ms,
            elapsed: 0,
            micro: action.micro ?? true,
            blinkAt: 1800 + this.rng() * 3500,
            blinkUntil: 0,
          };
          return;
      }
    }
  }

  /** Seated, or standing at the desk's approach point. */
  private atDesk() {
    const desk = this.opts.desk;
    return Boolean(desk && (this.seated || dist(this.pos, desk.stand) <= 14));
  }

  private beginStand() {
    this.active = { kind: "stand", total: this.oneShot("standUp"), elapsed: 0 };
  }

  private beginStanding(action: Extract<Action, { kind: "idle" | "pose" | "emote" }>): Active {
    if (action.kind === "idle") {
      return {
        kind: "idle",
        ms: action.ms,
        elapsed: 0,
        micro: action.micro ?? true,
        pose: this.freshPose(0),
      };
    }
    if (action.kind === "pose")
      return { kind: "pose", visual: action.visual, ms: action.ms, elapsed: 0 };
    const clip = this.opts.clips[action.clip];
    if (!clip) {
      // Missing emote art: a thoughtful look is the closest neutral substitute.
      return { kind: "pose", visual: "look_around", ms: 1200, elapsed: 0 };
    }
    const play = this.reduced ? 1200 : clip.frames * clip.frameDurationMs * (action.repeat ?? 1);
    return {
      kind: "emote",
      clip: action.clip,
      play,
      total: play + (action.holdMs ?? 500),
      elapsed: 0,
    };
  }

  private oneShot(name: "sitDown" | "standUp") {
    const clip = this.opts.clips[name];
    if (!clip || this.reduced) return 0;
    return clip.frames * clip.frameDurationMs;
  }

  /** Advances the active action; returns leftover ms if it finished, else null. */
  private step(dt: number): number | null {
    const a = this.active;
    switch (a.kind) {
      case "walk": {
        let budget = (a.speed * dt) / 1000;
        while (budget > 0 && a.seg < a.path.length) {
          const target = a.path[a.seg]!;
          const dx = target.x - this.pos.x;
          const dy = target.y - this.pos.y;
          const d = Math.hypot(dx, dy);
          // Face the way we're going; near-vertical legs keep the previous facing.
          if (Math.abs(dx) > 0.5 && Math.abs(dx) >= d * 0.3)
            this.facing = dx > 0 ? "right" : "left";
          if (d <= budget) {
            this.pos = { ...target };
            a.walked += d;
            budget -= d;
            a.seg++;
          } else {
            this.pos = { x: this.pos.x + (dx / d) * budget, y: this.pos.y + (dy / d) * budget };
            a.walked += budget;
            budget = 0;
          }
        }
        if (a.seg >= a.path.length) {
          const leftover = budget > 0 ? (budget / a.speed) * 1000 : 0;
          this.advance();
          return leftover;
        }
        return null;
      }
      case "idle": {
        a.elapsed += dt;
        if (a.micro && !this.reduced) this.tickPose(a.pose, a.elapsed);
        if (a.ms !== null && a.elapsed >= a.ms) {
          const leftover = a.elapsed - a.ms;
          this.advance();
          return leftover;
        }
        return null;
      }
      case "pose":
      case "emote":
      case "sit":
      case "stand": {
        a.elapsed += dt;
        const total = a.kind === "pose" ? a.ms : a.total;
        if (a.elapsed < total) return null;
        const leftover = a.elapsed - total;
        if (a.kind === "sit") this.seated = true;
        if (a.kind === "stand") {
          this.seated = false;
          this.facing = this.opts.desk?.exit ? "right" : "left";
          if (this.opts.desk) this.pos = { ...this.opts.desk.stand };
        }
        if ((a.kind === "sit" || a.kind === "stand") && this.pending) {
          const next = this.pending;
          this.pending = null;
          this.start(next);
        } else {
          this.advance();
        }
        return leftover;
      }
      case "seated": {
        a.elapsed += dt;
        if (a.micro && !this.reduced && a.mode === "idle" && a.elapsed >= a.blinkAt) {
          a.blinkUntil = a.elapsed + 220;
          a.blinkAt = a.elapsed + 2600 + this.rng() * 4200;
        }
        if (a.ms !== null && a.elapsed >= a.ms) {
          const leftover = a.elapsed - a.ms;
          this.advance();
          return leftover;
        }
        return null;
      }
    }
  }

  private freshPose(now: number): Pose {
    return { visual: "idle", until: 0, nextAt: now + 1200 + this.rng() * 2800 };
  }

  private tickPose(p: Pose, now: number) {
    if (p.visual !== "idle" && now >= p.until) p.visual = "idle";
    if (p.visual === "idle" && now >= p.nextAt) {
      const total = MICRO.reduce((s, m) => s + m.weight, 0);
      let roll = this.rng() * total;
      const pick = MICRO.find((m) => (roll -= m.weight) < 0) ?? MICRO[0]!;
      p.visual = pick.visual;
      p.until = now + pick.ms;
      p.nextAt = p.until + 2200 + this.rng() * 3800;
    }
  }

  // -- rendering ---------------------------------------------------------------

  private frameOf(name: ClipName, elapsed: number): number {
    const clip = this.opts.clips[name];
    if (!clip || this.reduced) return 0;
    const raw = Math.floor(elapsed / clip.frameDurationMs);
    return clip.loop ? raw % clip.frames : Math.min(raw, clip.frames - 1);
  }

  private idleFrame(visual: keyof typeof IDLE_FRAME) {
    const frames = this.opts.clips.idle?.frames ?? 1;
    const f = IDLE_FRAME[visual];
    return f < frames ? f : 0;
  }

  private render(): RenderState {
    const base = { x: this.pos.x, y: this.pos.y, facing: this.facing };
    const a = this.active;
    switch (a.kind) {
      case "walk": {
        const clip: ClipName = this.facing === "right" ? "walkRight" : "walkLeft";
        const frames = this.opts.clips[clip]?.frames ?? 1;
        const frame = this.reduced ? 0 : Math.floor(a.walked / this.opts.strideWorldPx) % frames;
        return {
          ...base,
          scene: "character",
          clip,
          frame,
          visual: this.facing === "right" ? "walking_right" : "walking_left",
        };
      }
      case "idle":
        return {
          ...base,
          scene: "character",
          clip: "idle",
          frame: this.idleFrame(a.pose.visual),
          visual: a.pose.visual,
        };
      case "pose":
        return {
          ...base,
          scene: "character",
          clip: "idle",
          frame: this.idleFrame(a.visual),
          visual: a.visual,
        };
      case "emote":
        return {
          ...base,
          scene: "character",
          clip: a.clip,
          frame:
            a.elapsed < a.play
              ? this.loopFrame(a.clip, a.elapsed)
              : (this.opts.clips[a.clip]?.frames ?? 1) - 1,
          visual: a.clip,
        };
      case "sit":
        return {
          ...base,
          scene: "desk",
          clip: "sitDown",
          frame: this.frameOf("sitDown", a.elapsed),
          visual: "sitting_down",
        };
      case "stand":
        return {
          ...base,
          scene: "desk",
          clip: "standUp",
          frame: this.frameOf("standUp", a.elapsed),
          visual: "standing_up",
        };
      case "seated": {
        if (a.mode === "work") {
          return {
            ...base,
            scene: "desk",
            clip: "working",
            frame: this.frameOf("working", a.elapsed),
            visual: "working",
          };
        }
        const frames = this.opts.clips.working?.frames ?? 1;
        const blinking = a.elapsed < a.blinkUntil && frames >= 4;
        return {
          ...base,
          scene: "desk",
          clip: "working",
          frame: blinking ? 3 : 0,
          visual: "seated_idle",
        };
      }
    }
  }

  private loopFrame(name: string, elapsed: number) {
    const clip = this.opts.clips[name];
    if (!clip || this.reduced) return 0;
    return Math.floor(elapsed / clip.frameDurationMs) % clip.frames;
  }
}

function dist(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
