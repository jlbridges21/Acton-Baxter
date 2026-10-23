/**
 * Office animation director: owns one CharacterBrain per animated agent, a single
 * requestAnimationFrame loop, and the mapping from real task cues and user commands to
 * character plans. Every character (Baxter, Sam, Dexter, future agents) runs through the same
 * code; what differs comes from its sprite pack definition (emotes, routine, desk exit).
 *
 * DOM nodes are written directly (transform, img src, opacity, z-index) so a walking character
 * never re-renders React; React is only told about caption changes. The director never
 * fetches, writes, or calls a model — it consumes the snapshots the office page loads.
 *
 * Control modes per agent:
 *   autonomous — ambient routine, or the mode/events from real task state;
 *   manual     — the user clicked the agent or the floor; autonomous behaviour is suspended
 *                until MANUAL_TIMEOUT_MS pass with no interaction, then resumes from wherever
 *                the agent is (no teleporting). Timing uses the loop's own clock, so there are
 *                no timers to leak or race.
 */

import {
  planAmbient,
  type AmbientIntensity,
  type AmbientMemory,
  EMPTY_AMBIENT_MEMORY,
} from "@/lib/office/ambient";
import {
  CharacterBrain,
  PRIORITY,
  type Action,
  type ClipTiming,
  type Plan,
  type RenderState,
} from "@/lib/office/character-brain";
import { DEPTH_RANK, depthZ } from "@/lib/office/depth";
import {
  findPath,
  nearestReachable,
  randomPointInRoom,
  type DeskGeometry,
  type Hotspot,
  type OfficeNav,
} from "@/lib/office/navigation";
import {
  resolveClip,
  type DeskMetrics,
  type SpritePackDefinition,
  type SpritePackManifest,
  type Vec,
} from "@/lib/office/sprite-pack";
import type { AgentMode, OfficeEvent } from "@/lib/office/task-coordinator";
import type { HomeSpot } from "@/lib/office/animation-settings";

export type AnimatedAgentSpec = {
  id: string;
  name: string;
  roomKey: string;
  pack: SpritePackDefinition;
  manifest: SpritePackManifest;
  desk: DeskGeometry;
  deskMetrics: DeskMetrics;
};

export type AgentNames = Map<string, { name: string; department: string | null }>;

export type Cue = { caption: string | null; tone: "info" | "error" | "success" };

export type ControlMode = "autonomous" | "manual";

export type DirectorOptions = {
  nav: OfficeNav;
  agents: AnimatedAgentSpec[];
  names: AgentNames;
  intensity: AmbientIntensity;
  speed: number;
  homeSpot: HomeSpot;
  reducedMotion: boolean;
  ambientPaused: boolean;
  rng?: () => number;
  onCue?: (agentId: string, cue: Cue) => void;
  onControlChange?: (agentId: string, mode: ControlMode) => void;
};

type Binding = {
  root: HTMLElement | null;
  overlay: HTMLElement | null;
  charImg: HTMLImageElement | null;
  deskImg: HTMLImageElement | null;
  deskProp: HTMLElement | null;
};

type Agent = {
  spec: AnimatedAgentSpec;
  brain: CharacterBrain;
  mode: AgentMode;
  events: OfficeEvent[];
  memory: AmbientMemory;
  needsSchedule: boolean;
  lastPresentAt: number;
  lastResultAt: number;
  captionPlanId: string | null;
  cue: Cue;
  /** Director clock time at which manual control lapses; null when autonomous. */
  manualUntil: number | null;
  dom: Binding;
  last: {
    transform: string;
    z: string;
    charSrc: string;
    deskSrc: string;
    scene: string;
    visual: string;
  };
};

type Link = { el: SVGLineElement; from: string; to: string };

export const MANUAL_TIMEOUT_MS = 10_000;
const PRESENT_COOLDOWN_MS = 3 * 60_000;
let planSeq = 0;
const nextId = (p: string) => `${p}-${++planSeq}`;
const freshLast = () => ({ transform: "", z: "", charSrc: "", deskSrc: "", scene: "", visual: "" });

export class OfficeDirector {
  private opts: DirectorOptions;
  private agents = new Map<string, Agent>();
  private links = new Set<Link>();
  private raf = 0;
  private lastTs = 0;
  private clock = 0;
  private rng: () => number;

  constructor(opts: DirectorOptions) {
    this.opts = opts;
    this.rng = opts.rng ?? Math.random;
    for (const spec of opts.agents) {
      const clips: Record<string, ClipTiming> = {};
      for (const [name, clip] of Object.entries(spec.manifest.animations)) {
        clips[name] = {
          frames: clip.frames.length,
          frameDurationMs: clip.frameDurationMs,
          loop: clip.loop,
        };
      }
      const agent: Agent = {
        spec,
        mode: "ambient",
        events: [],
        memory: { ...EMPTY_AMBIENT_MEMORY },
        needsSchedule: true,
        lastPresentAt: -Infinity,
        lastResultAt: -Infinity,
        captionPlanId: null,
        cue: { caption: null, tone: "info" },
        manualUntil: null,
        dom: { root: null, overlay: null, charImg: null, deskImg: null, deskProp: null },
        last: freshLast(),
        brain: null as unknown as CharacterBrain,
      };
      agent.brain = new CharacterBrain({
        clips,
        findPath: (from, to) => findPath(opts.nav.grid, from, to),
        desk: { stand: spec.desk.stand, exit: spec.desk.exit },
        start: this.homePoint(spec),
        // Start at the desk: on refresh the character is simply "at work", not mid-walk.
        startSeated: true,
        strideWorldPx: spec.pack.strideWorldPx,
        rng: this.rng,
        speed: opts.speed,
        reducedMotion: opts.reducedMotion,
        onMark: (id, plan) => this.onMark(agent, id, plan),
        onPlanEnd: (plan, completed) => this.onPlanEnd(agent, plan, completed),
      });
      this.agents.set(spec.id, agent);
    }
  }

  // -- lifecycle -----------------------------------------------------------------

  start() {
    if (this.raf || typeof window === "undefined") return;
    const loop = (ts: number) => {
      const dt = this.lastTs ? ts - this.lastTs : 16;
      this.lastTs = ts;
      this.tick(dt);
      this.raf = window.requestAnimationFrame(loop);
    };
    this.raf = window.requestAnimationFrame(loop);
  }

  destroy() {
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.links.clear();
  }

  bind(agentId: string, dom: Partial<Binding>) {
    const a = this.agents.get(agentId);
    if (!a) return;
    a.dom = { ...a.dom, ...dom };
    a.last = freshLast();
    this.render(a, a.brain.update(0));
  }

  registerLink(el: SVGLineElement, from: string, to: string) {
    const link = { el, from, to };
    this.links.add(link);
    return () => {
      this.links.delete(link);
    };
  }

  has(agentId: string) {
    return this.agents.has(agentId);
  }

  /** Feet position, or the seated position while at the desk. */
  positionOf(agentId: string): Vec | null {
    const a = this.agents.get(agentId);
    if (!a) return null;
    return a.brain.isSeated ? this.seatedPoint(a.spec) : a.brain.position;
  }

  visualOf(agentId: string) {
    return this.agents.get(agentId)?.brain.update(0).visual ?? null;
  }

  controlOf(agentId: string): ControlMode | null {
    const a = this.agents.get(agentId);
    if (!a) return null;
    return a.manualUntil === null ? "autonomous" : "manual";
  }

  // -- settings ------------------------------------------------------------------

  setReducedMotion(value: boolean) {
    this.opts.reducedMotion = value;
    for (const a of this.agents.values()) a.brain.setReducedMotion(value);
  }

  setAmbient(intensity: AmbientIntensity, paused: boolean) {
    const changed = intensity !== this.opts.intensity || paused !== this.opts.ambientPaused;
    this.opts.intensity = intensity;
    this.opts.ambientPaused = paused;
    if (!changed) return;
    for (const a of this.agents.values()) {
      if (
        a.manualUntil === null &&
        a.mode === "ambient" &&
        (!a.brain.currentPlan || a.brain.currentPlan.tag?.startsWith("ambient:"))
      ) {
        a.brain.cancel();
        this.schedule(a);
      }
    }
  }

  // -- user control ----------------------------------------------------------------

  /**
   * The user clicked this agent: stop whatever it's doing (routine, emote, typing), stand up
   * if seated, and wait idle for commands. Starts/extends the manual-control window.
   */
  interrupt(agentId: string) {
    const a = this.agents.get(agentId);
    if (!a) return false;
    this.enterManual(a);
    a.brain.setPlan(
      {
        id: nextId("manual"),
        priority: PRIORITY.manual,
        tag: "manual:idle",
        manual: true,
        actions: [{ kind: "idle", ms: null }],
      },
      { force: true },
    );
    return true;
  }

  /**
   * Walk the agent to a clicked world point. Obstructed or unreachable points resolve to the
   * nearest reachable floor; returns where the agent will actually stop (null if it can't).
   */
  moveTo(agentId: string, target: Vec): Vec | null {
    const a = this.agents.get(agentId);
    if (!a) return null;
    const from = a.brain.isSeated ? a.spec.desk.stand : a.brain.position;
    const dest = nearestReachable(this.opts.nav.grid, from, target);
    this.enterManual(a);
    if (!dest) return null;
    a.brain.setPlan(
      {
        id: nextId("manual"),
        priority: PRIORITY.manual,
        tag: "manual:walk",
        manual: true,
        actions: [
          { kind: "walk", to: dest },
          { kind: "idle", ms: null },
        ],
      },
      { force: true },
    );
    return dest;
  }

  /** Ends manual control now (e.g. the agent was deselected); the routine picks up from here. */
  release(agentId: string) {
    const a = this.agents.get(agentId);
    if (a && a.manualUntil !== null) this.exitManual(a);
  }

  private enterManual(a: Agent) {
    const was = a.manualUntil;
    a.manualUntil = this.clock + MANUAL_TIMEOUT_MS;
    if (a.captionPlanId) {
      a.captionPlanId = null;
      this.setCue(a, { caption: null, tone: "info" });
    }
    if (was === null) this.opts.onControlChange?.(a.spec.id, "manual");
  }

  private exitManual(a: Agent) {
    a.manualUntil = null;
    this.opts.onControlChange?.(a.spec.id, "autonomous");
    // Resume from the current position: queued real events first, then mode/ambient.
    a.brain.cancel();
    a.needsSchedule = true;
  }

  // -- real cues ----------------------------------------------------------------

  /** Persistent mode from ai_agent_runtime_status. */
  setMode(agentId: string, mode: AgentMode) {
    const a = this.agents.get(agentId);
    if (!a || a.mode === mode) return;
    a.mode = mode;
    if (a.manualUntil !== null) return; // applied when manual control ends
    const tag = a.brain.currentPlan?.tag ?? a.brain.pendingPlan?.tag ?? "";
    // Mode and ambient plans yield to the new mode; event plans finish first.
    if (!tag || tag.startsWith("mode:") || tag.startsWith("ambient:")) {
      this.startModePlan(a, true);
    }
  }

  /** One-shot delegation events (already de-duplicated by the coordinator). */
  handleEvents(events: OfficeEvent[]) {
    for (const e of events) {
      const a = this.agents.get(e.fromAgentId);
      if (!a) continue; // the delegating agent isn't animated; the link line still shows
      if (e.type === "result") {
        // Finished before the visit was over: wrap up right where we are.
        a.events = a.events.filter((x) => x.taskId !== e.taskId);
        if (
          a.brain.currentPlan?.tag === `handoff:${e.taskId}` ||
          a.brain.pendingPlan?.tag === `handoff:${e.taskId}`
        ) {
          a.brain.cancel(`handoff:${e.taskId}`);
        }
      }
      a.events.push(e);
      this.schedule(a);
    }
  }

  /** A real Baxter chat request on this page (start → thinking/working; end → result). */
  chatRequest(
    agentId: string,
    phase: "start" | "end",
    detail?: { ok: boolean; delegated: boolean },
  ) {
    const a = this.agents.get(agentId);
    if (!a) return;
    // Asking the agent something hands control back to it.
    if (a.manualUntil !== null) {
      a.manualUntil = null;
      this.opts.onControlChange?.(a.spec.id, "autonomous");
    }
    const think = this.emote(a, "think");
    if (phase === "start") {
      this.trySet(a, {
        id: nextId("chat"),
        priority: PRIORITY.task,
        tag: "chat",
        actions: [
          { kind: "mark", id: "caption:Reading your question" },
          ...(think ? [{ kind: "emote", clip: think, holdMs: 200 } as Action] : []),
          { kind: "mark", id: "caption:Working on an answer" },
          { kind: "seated", mode: "work", ms: null },
        ],
      });
      return;
    }
    if (a.brain.currentPlan?.tag === "chat" || a.brain.pendingPlan?.tag === "chat")
      a.brain.cancel("chat");
    // A delegated answer already got its review/presentation from the result event.
    if (detail?.delegated && this.clock - a.lastResultAt < 30_000) {
      this.schedule(a);
      return;
    }
    const actions: Action[] = detail?.ok
      ? [
          { kind: "mark", id: "caption:Answer ready" },
          ...this.presentOrNod(a),
          { kind: "idle", ms: 900 },
        ]
      : [
          { kind: "mark", id: "caption!:Couldn't answer that one" },
          ...(think ? [{ kind: "emote", clip: think, holdMs: 400 } as Action] : []),
          { kind: "idle", ms: 1200 },
        ];
    this.trySet(a, {
      id: nextId("chat-done"),
      priority: PRIORITY.completion,
      tag: "chat-done",
      actions,
    });
    this.schedule(a);
  }

  // -- scheduling ------------------------------------------------------------------

  private trySet(a: Agent, plan: Plan, force = false) {
    return a.brain.setPlan(plan, { force });
  }

  private schedule(a: Agent) {
    a.needsSchedule = false;
    if (a.manualUntil !== null) return; // events wait until the user is done
    const current = a.brain.pendingPlan ?? a.brain.currentPlan;
    const event = a.events[0];
    if (event) {
      const plan = this.planForEvent(a, event);
      if (
        !current ||
        plan.priority <= current.priority ||
        current.tag?.startsWith("ambient:") ||
        current.tag?.startsWith("mode:")
      ) {
        a.events.shift();
        if (this.trySet(a, plan, true)) return;
      }
    }
    if (!current) this.startModePlan(a, false);
  }

  private startModePlan(a: Agent, force: boolean) {
    const plan = this.modePlan(a);
    this.trySet(a, plan, force);
  }

  /** The character's clip for a semantic emote ("think", "present", "task"), if it has one. */
  private emote(a: Agent, kind: "think" | "present" | "task"): string | null {
    const name = a.spec.pack.emotes[kind];
    return name && resolveClip(a.spec.manifest, name) ? name : null;
  }

  private modePlan(a: Agent): Plan {
    const seatedWork: Action = { kind: "seated", mode: "work", ms: null };
    const think = this.emote(a, "think");
    switch (a.mode) {
      case "working":
        return {
          id: nextId("mode"),
          priority: PRIORITY.task,
          tag: "mode:working",
          actions: [seatedWork],
        };
      case "receiving":
        return {
          id: nextId("mode"),
          priority: PRIORITY.task,
          tag: "mode:receiving",
          actions: [
            ...(think ? [{ kind: "emote", clip: think, holdMs: 300 } as Action] : []),
            seatedWork,
          ],
        };
      case "waiting":
        // Delegated work is out with a specialist: wait at the desk, not "working".
        return {
          id: nextId("mode"),
          priority: PRIORITY.ambient,
          tag: "mode:waiting",
          actions: [{ kind: "seated", mode: "idle", ms: null }],
        };
      case "approval":
      case "failed":
        return {
          id: nextId("mode"),
          priority: PRIORITY.ambient,
          tag: `mode:${a.mode}`,
          actions: [
            { kind: "walk", to: this.homePoint(a.spec) },
            { kind: "idle", ms: null },
          ],
        };
      default:
        return this.ambientPlan(a);
    }
  }

  private ambientPlan(a: Agent): Plan {
    if (this.opts.ambientPaused) {
      return {
        id: nextId("ambient"),
        priority: PRIORITY.ambient,
        tag: "ambient:paused",
        actions: [
          a.brain.isSeated
            ? { kind: "seated", mode: "idle", ms: null }
            : { kind: "idle", ms: null },
        ],
      };
    }
    const spots = [...this.opts.nav.hotspots.values()].filter(
      (h: Hotspot) => h.kind === "idle" && h.roomKey === a.spec.roomKey,
    );
    const offAtSpot = this.opts.intensity === "off" && this.opts.homeSpot !== "desk";
    if (offAtSpot) {
      return {
        id: nextId("ambient"),
        priority: PRIORITY.ambient,
        tag: "ambient:rest",
        actions: [
          { kind: "walk", to: this.homePoint(a.spec) },
          { kind: "idle", ms: null, micro: false },
        ],
      };
    }
    const result = planAmbient({
      rng: this.rng,
      now: this.clock,
      intensity: this.opts.intensity,
      position: a.brain.position,
      seated: a.brain.isSeated,
      canSit: true,
      spots,
      randomPoint: () => randomPointInRoom(this.opts.nav, a.spec.roomKey, this.rng),
      memory: a.memory,
      emotes: { think: this.emote(a, "think"), task: this.emote(a, "task") },
      prefer: a.spec.pack.ambient.spots,
      weights: a.spec.pack.ambient.weights,
    });
    a.memory = result.memory;
    return {
      id: nextId("ambient"),
      priority: PRIORITY.ambient,
      tag: `ambient:${result.activity}`,
      actions: result.actions,
    };
  }

  private planForEvent(a: Agent, e: OfficeEvent): Plan {
    const target = this.opts.names.get(e.toAgentId);
    const who = target?.name ?? "a specialist";
    const think = this.emote(a, "think");
    const thinkAction: Action[] = think ? [{ kind: "emote", clip: think, holdMs: 300 }] : [];
    if (e.type === "handoff") {
      const spot = this.opts.nav.hotspots.get(`collab:${e.toAgentId}`);
      const dept = shortDepartment(target?.department);
      const present = this.emote(a, "present");
      const actions: Action[] = [{ kind: "mark", id: `caption:Heading to ${who}` }];
      if (spot) {
        actions.push({ kind: "walk", to: spot, speed: "hurry" });
        actions.push({
          kind: "mark",
          id: `caption:Assigned ${dept ? `${article(dept)} ${dept}` : "a"} task to ${who}`,
        });
        // Baxter's presenting art includes an easel to his left; only use it when that side
        // is clear of the colleague's desk.
        if (present && spot.side === "right") {
          actions.push({ kind: "emote", clip: present, repeat: 2, holdMs: 300 });
        } else {
          actions.push(
            { kind: "pose", visual: "look_around", ms: 1400 },
            { kind: "idle", ms: 600, micro: false },
          );
        }
        actions.push({ kind: "idle", ms: 700 });
      }
      actions.push({ kind: "mark", id: "caption:" }, { kind: "walk", to: this.homePoint(a.spec) });
      return {
        id: nextId("handoff"),
        priority: PRIORITY.critical,
        tag: `handoff:${e.taskId}`,
        actions,
      };
    }
    a.lastResultAt = this.clock;
    if (e.outcome === "completed") {
      return {
        id: nextId("result"),
        priority: PRIORITY.completion,
        tag: `result:${e.taskId}`,
        actions: [
          { kind: "mark", id: `caption~:Reviewing ${who}'s result` },
          ...thinkAction,
          ...this.presentOrNod(a),
          { kind: "idle", ms: 900 },
        ],
      };
    }
    return {
      id: nextId("result"),
      priority: PRIORITY.critical,
      tag: `result:${e.taskId}`,
      actions: [
        {
          kind: "mark",
          id: `caption!:${who}'s task ${e.outcome === "cancelled" ? "was cancelled" : "failed"}`,
        },
        ...thinkAction,
        { kind: "idle", ms: 1800 },
      ],
    };
  }

  /** Presenting a result is reserved for real results, at most once every few minutes. */
  private presentOrNod(a: Agent): Action[] {
    const present = this.emote(a, "present");
    if (present && this.clock - a.lastPresentAt >= PRESENT_COOLDOWN_MS) {
      a.lastPresentAt = this.clock;
      return [{ kind: "emote", clip: present, holdMs: 400 }];
    }
    return [
      { kind: "pose", visual: "blink", ms: 300 },
      { kind: "idle", ms: 500, micro: false },
    ];
  }

  private homePoint(spec: AnimatedAgentSpec): Vec {
    const spot = this.opts.homeSpot;
    if (spot !== "desk") {
      const h = this.opts.nav.hotspots.get(`idle:${spec.roomKey}:${spot}`);
      if (h) return { x: h.x, y: h.y };
    }
    return spec.desk.stand;
  }

  private seatedPoint(spec: AnimatedAgentSpec): Vec {
    return {
      x: spec.desk.origin.x + spec.deskMetrics.seatedFeet.x * spec.desk.scale,
      y: spec.desk.origin.y + spec.deskMetrics.seatedFeet.y * spec.desk.scale,
    };
  }

  // -- brain callbacks ----------------------------------------------------------------

  private onMark(a: Agent, id: string, plan: Plan) {
    if (!id.startsWith("caption")) return;
    const text = id.slice(id.indexOf(":") + 1);
    const tone = id.startsWith("caption!")
      ? "error"
      : id.startsWith("caption~")
        ? "success"
        : "info";
    a.captionPlanId = text ? plan.id : null;
    this.setCue(a, { caption: text || null, tone });
  }

  private onPlanEnd(a: Agent, plan: Plan, completed: boolean) {
    if (a.captionPlanId === plan.id) {
      a.captionPlanId = null;
      this.setCue(a, { caption: null, tone: "info" });
    }
    // Replacements already started their own plan; only natural endings pick what's next,
    // and that happens on the next tick to avoid re-entrancy.
    if (completed || !a.brain.currentPlan) a.needsSchedule = true;
  }

  private setCue(a: Agent, cue: Cue) {
    if (a.cue.caption === cue.caption && a.cue.tone === cue.tone) return;
    a.cue = cue;
    this.opts.onCue?.(a.spec.id, cue);
  }

  // -- frame loop -----------------------------------------------------------------

  tick(dt: number) {
    this.clock += Math.min(dt, 250);
    for (const a of this.agents.values()) {
      if (a.manualUntil !== null && this.clock >= a.manualUntil) this.exitManual(a);
      if (a.needsSchedule && !a.brain.currentPlan) this.schedule(a);
      else if (a.needsSchedule) a.needsSchedule = false;
      this.render(a, a.brain.update(dt));
    }
    for (const link of this.links) this.renderLink(link);
  }

  private render(a: Agent, r: RenderState) {
    const { root, overlay, charImg, deskImg, deskProp } = a.dom;
    const spec = a.spec;
    const resolved = resolveClip(spec.manifest, r.clip);
    // The clip's own art decides the scene: Baxter sits down at his desk, Sam and Dexter on
    // the floor beside it.
    const scene = resolved?.clip.canvas ?? r.scene;
    const atDesk = scene === "desk";
    const feet = atDesk ? this.seatedPoint(spec) : { x: r.x, y: r.y };
    const transform = `translate3d(${feet.x.toFixed(1)}px, ${feet.y.toFixed(1)}px, 0)`;
    // Seated, the character is part of the desk art: sort with the desk's front edge.
    const z = String(
      atDesk
        ? depthZ("world", spec.desk.frontY, DEPTH_RANK.character)
        : depthZ("world", r.y, DEPTH_RANK.character),
    );
    if (transform !== a.last.transform) {
      if (root) root.style.transform = transform;
      if (overlay) overlay.style.transform = transform;
    }
    if (root && z !== a.last.z) root.style.zIndex = z;
    const visualKey = `${r.visual}:${r.emote ?? ""}`;
    if (root && visualKey !== a.last.visual) {
      root.dataset.visual = r.visual;
      if (r.emote) root.dataset.emote = r.emote;
      else delete root.dataset.emote;
      a.last.visual = visualKey;
    }
    a.last.transform = transform;
    a.last.z = z;
    const clip = resolved?.clip;
    const src = clip?.frames[r.frame] ?? clip?.frames[0] ?? "";
    if (atDesk) {
      if (deskImg && src && src !== a.last.deskSrc) deskImg.src = src;
      a.last.deskSrc = src;
    } else {
      // Character art is drawn at the facing it was painted with; walk clips are per-direction.
      if (charImg && src && src !== a.last.charSrc) charImg.src = src;
      a.last.charSrc = src;
    }
    if (scene !== a.last.scene) {
      if (charImg) charImg.style.opacity = atDesk ? "0" : "1";
      if (deskImg) deskImg.style.opacity = atDesk ? "1" : "0";
      if (deskProp) deskProp.style.opacity = atDesk ? "0" : "1";
      if (root) root.dataset.scene = scene;
      a.last.scene = scene;
    }
  }

  private renderLink(link: Link) {
    const from = this.positionOf(link.from) ?? null;
    if (!from) return;
    link.el.setAttribute("x1", from.x.toFixed(1));
    link.el.setAttribute("y1", (from.y - 30).toFixed(1));
  }
}

/** "HR, Administration & Legal" → "HR"; keeps captions short. */
function shortDepartment(name: string | null | undefined): string | null {
  const first = name?.split(/[,&/]/)[0]?.trim();
  return first ? first : null;
}

function article(word: string) {
  return /^[aeiou]/i.test(word) || /^HR\b/.test(word) ? "an" : "a";
}
