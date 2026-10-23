import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MANUAL_TIMEOUT_MS,
  OfficeDirector,
  type AnimatedAgentSpec,
  type Cue,
} from "@/components/ai/office/director";
import { computeOfficeLayout, type OfficeAgent } from "@/lib/agents/office-layout";
import { roomTheme, type RoomTheme } from "@/lib/office/decor";
import { buildOfficeNav, isWalkable, type NavAgent, type OfficeNav } from "@/lib/office/navigation";
import {
  SPRITE_PACKS,
  deskMetrics,
  parseSpritePackManifest,
  type SpritePackManifest,
  type Vec,
} from "@/lib/office/sprite-pack";
import { reconcile, seedCoordinator, type DelegationSnapshot } from "@/lib/office/task-coordinator";

function manifestOf(dir: string): SpritePackManifest {
  return parseSpritePackManifest(
    JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, `../../public/animations/${dir}/manifest.json`),
        "utf8",
      ),
    ),
  ).manifest;
}

const CHARACTERS = {
  baxter: { packId: "baxter-v3", manifest: manifestOf("baxter/v3"), name: "Baxter" },
  sam: { packId: "sam-v1", manifest: manifestOf("sam/v1"), name: "Sam" },
  dexter: { packId: "dexter-v1", manifest: manifestOf("dexter/v1"), name: "Dexter" },
} as const;
type Who = keyof typeof CHARACTERS;

const departments = [
  {
    id: "exec",
    slug: "executive",
    name: "Executive Office",
    color: "#1e3a5f",
    is_visible: true,
    sort_order: 0,
  },
  {
    id: "hr",
    slug: "hr-admin-legal",
    name: "HR, Administration & Legal",
    color: "#5b3f8c",
    is_visible: true,
    sort_order: 1,
  },
  {
    id: "bi",
    slug: "business-intelligence",
    name: "Business Intelligence",
    color: "#2f6f5e",
    is_visible: true,
    sort_order: 2,
  },
  {
    id: "fin",
    slug: "finance",
    name: "Finance",
    color: "#8a5a00",
    is_visible: true,
    sort_order: 3,
  },
];
const officeAgents: OfficeAgent[] = [
  { id: "baxter", kind: "orchestrator", departmentId: "exec", desk: {} },
  { id: "sam", kind: "specialist", departmentId: "hr", desk: {} },
  { id: "dexter", kind: "specialist", departmentId: "bi", desk: {} },
  { id: "fiona", kind: "specialist", departmentId: "fin", desk: {} },
];

function setup(seed = 5, animate: Who[] = ["baxter", "sam", "dexter"]) {
  const layout = computeOfficeLayout({
    preset: "studio",
    departments,
    agents: officeAgents,
    showMeetingArea: true,
    showFutureSpace: false,
    labels: {},
  });
  const navAgents: NavAgent[] = layout.seats.map((seat) => {
    const c = CHARACTERS[seat.agentId as Who];
    if (!c || !animate.includes(seat.agentId as Who)) return { id: seat.agentId, seat, pack: null };
    const def = SPRITE_PACKS[c.packId]!;
    return {
      id: seat.agentId,
      seat,
      pack: {
        scale: def.scale,
        desk: deskMetrics(def, c.manifest)!,
        standPoint: c.manifest.canvases.desk.standPoint!,
        deskAnchor: c.manifest.canvases.desk.anchor,
        deskExit: def.deskExit,
      },
    };
  });
  const themes = new Map<string, RoomTheme>(departments.map((d) => [d.id, roomTheme(d)]));
  const nav: OfficeNav = buildOfficeNav(layout, navAgents, { themes });
  const specs: AnimatedAgentSpec[] = animate.map((id) => {
    const c = CHARACTERS[id];
    const def = SPRITE_PACKS[c.packId]!;
    return {
      id,
      name: c.name,
      roomKey: nav.roomOfAgent.get(id)!,
      pack: def,
      manifest: c.manifest,
      desk: nav.desks.get(id)!,
      deskMetrics: deskMetrics(def, c.manifest)!,
    };
  });
  const cues: Array<[string, Cue]> = [];
  const control: Array<[string, string]> = [];
  let s = seed;
  const director = new OfficeDirector({
    nav,
    agents: specs,
    names: new Map([
      ["baxter", { name: "Baxter", department: "Executive Office" }],
      ["sam", { name: "Sam", department: "HR, Administration & Legal" }],
      ["dexter", { name: "Dexter", department: "Business Intelligence" }],
      ["fiona", { name: "Fiona", department: "Finance" }],
    ]),
    intensity: "normal",
    speed: 1,
    homeSpot: "desk",
    reducedMotion: false,
    ambientPaused: false,
    rng: () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    },
    onCue: (id, cue) => cues.push([id, cue]),
    onControlChange: (id, mode) => control.push([id, mode]),
  });
  return { director, nav, cues, control };
}

function advance(director: OfficeDirector, ms: number, onStep?: () => void) {
  for (let t = 0; t < ms; t += 16) {
    director.tick(16);
    onStep?.();
  }
}

const near = (a: Vec, b: Vec, d = 6) => Math.hypot(a.x - b.x, a.y - b.y) <= d;

const snap = (status: string, extra: Partial<DelegationSnapshot> = {}): DelegationSnapshot => ({
  id: "task-1",
  fromAgentId: "baxter",
  toAgentId: "sam",
  status,
  createdAt: "2026-10-22T18:00:00.000Z",
  startedAt: null,
  completedAt: null,
  ...extra,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("office director (task-driven animation)", () => {
  it("decorative movement never fetches, writes, or creates tasks", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { director } = setup();
    const visuals = new Set<string>();
    advance(director, 5 * 60_000, () => visuals.add(director.visualOf("baxter")!));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(visuals.size).toBeGreaterThanOrEqual(5);
    expect([...visuals].some((v) => v.startsWith("walking"))).toBe(true);
  });

  it("a real delegation sends Baxter to Sam's hand-off spot through the office, then home", () => {
    const { director, nav, cues } = setup();
    advance(director, 2000);
    const state = seedCoordinator([], "2026-10-22T18:00:00.000Z");
    const r = reconcile(state, {
      delegations: [snap("queued")],
      serverTime: "2026-10-22T18:00:01.000Z",
    });
    director.setMode("baxter", "waiting");
    director.handleEvents(r.events);
    const collab = nav.hotspots.get("collab:sam")!;
    let reached = false;
    advance(director, 30_000, () => {
      if (near(director.positionOf("baxter")!, collab)) reached = true;
    });
    expect(reached).toBe(true);
    expect(cues.some(([, c]) => c.caption === "Assigned an HR task to Sam")).toBe(true);
    advance(director, 20_000);
    expect(director.visualOf("baxter")).toBe("seated_idle");
  });

  it("if Sam finishes before Baxter arrives, the visit is cut short and Baxter reviews the result", () => {
    const { director, nav } = setup();
    advance(director, 2000);
    let state = seedCoordinator([], "2026-10-22T18:00:00.000Z");
    let r = reconcile(state, {
      delegations: [snap("running")],
      serverTime: "2026-10-22T18:00:01.000Z",
    });
    state = r.state;
    director.handleEvents(r.events);
    advance(director, 1500);
    r = reconcile(state, {
      delegations: [snap("completed", { completedAt: "2026-10-22T18:00:02.000Z" })],
      serverTime: "2026-10-22T18:00:02.500Z",
    });
    director.handleEvents(r.events);
    const collab = nav.hotspots.get("collab:sam")!;
    const seen = new Set<string>();
    let reached = false;
    advance(director, 8000, () => {
      seen.add(director.visualOf("baxter")!);
      if (near(director.positionOf("baxter")!, collab)) reached = true;
    });
    expect(reached).toBe(false);
    expect(seen.has("thinking")).toBe(true);
  });

  it("failed work never leaves an agent typing", () => {
    const { director } = setup();
    for (const id of ["baxter", "sam", "dexter"]) director.setMode(id, "working");
    advance(director, 9000);
    for (const id of ["baxter", "sam", "dexter"]) expect(director.visualOf(id), id).toBe("working");
    for (const id of ["baxter", "sam", "dexter"]) director.setMode(id, "failed");
    advance(director, 6000);
    for (const id of ["baxter", "sam", "dexter"])
      expect(director.visualOf(id), id).not.toBe("working");
  });

  it("after a refresh mid-task, Baxter starts in the right state without replaying the hand-off", () => {
    const { director, cues } = setup();
    const state = seedCoordinator([snap("running")], "2026-10-22T18:00:05.000Z");
    const r = reconcile(state, {
      delegations: [snap("running")],
      serverTime: "2026-10-22T18:00:06.000Z",
    });
    expect(r.events).toEqual([]);
    director.setMode("baxter", "waiting");
    advance(director, 3000);
    expect(director.visualOf("baxter")).toBe("seated_idle");
    expect(cues).toEqual([]);
  });

  it("Baxter navigates to any agent that receives a real delegation (no Sam-specific code)", () => {
    const { director, nav } = setup();
    director.handleEvents([
      { type: "handoff", taskId: "t9", fromAgentId: "baxter", toAgentId: "fiona" },
    ]);
    const spot = nav.hotspots.get("collab:fiona")!;
    let reached = false;
    advance(director, 40_000, () => {
      if (near(director.positionOf("baxter")!, spot)) reached = true;
    });
    expect(reached).toBe(true);
  });

  it("a real chat request makes Baxter think and work, and its end ends the work", () => {
    const { director } = setup();
    director.chatRequest("baxter", "start");
    const seen = new Set<string>();
    advance(director, 9000, () => seen.add(director.visualOf("baxter")!));
    expect(seen.has("thinking")).toBe(true);
    expect(director.visualOf("baxter")).toBe("working");
    director.chatRequest("baxter", "end", { ok: true, delegated: false });
    advance(director, 6000);
    expect(director.visualOf("baxter")).not.toBe("working");
  });

  it("pausing ambient keeps the characters still", () => {
    const { director } = setup();
    advance(director, 3000);
    director.setAmbient("normal", true);
    advance(director, 2000);
    const p = director.positionOf("sam")!;
    advance(director, 60_000);
    expect(director.positionOf("sam")).toEqual(p);
  });
});

describe("Sam and Dexter routines", () => {
  /** Records each agent's emotes and positions over a long ambient run. */
  function watch(director: OfficeDirector, ms: number) {
    const emotes: Record<string, Set<string>> = {
      sam: new Set(),
      dexter: new Set(),
      baxter: new Set(),
    };
    const moved: Record<string, boolean> = { sam: false, dexter: false };
    const start = { sam: director.positionOf("sam")!, dexter: director.positionOf("dexter")! };
    const internals = director as unknown as {
      agents: Map<string, { brain: { update(dt: number): { emote?: string; visual: string } } }>;
    };
    advance(director, ms, () => {
      for (const id of ["sam", "dexter", "baxter"]) {
        const r = internals.agents.get(id)!.brain.update(0);
        if (r.emote) emotes[id]!.add(r.emote);
      }
      for (const id of ["sam", "dexter"] as const) {
        if (!near(director.positionOf(id)!, start[id], 30)) moved[id] = true;
      }
    });
    return { emotes, moved };
  }

  it("animate autonomously in their own offices with their own role emotes", () => {
    const { director } = setup(11);
    const { emotes, moved } = watch(director, 10 * 60_000);
    expect(moved.sam).toBe(true);
    expect(moved.dexter).toBe(true);
    // Sam: people-focused thinking and HR tasks. Dexter: data thinking and analytics tasks.
    expect([...emotes.sam!].sort()).toEqual(["hrTask", "peopleThinking"]);
    expect([...emotes.dexter!].sort()).toEqual(["analyticsTask", "dataThinking"]);
    // Baxter never uses Sam's or Dexter's art.
    for (const e of emotes.baxter!) expect(["thinking", "presenting"]).toContain(e);
  });

  it("leave their desks to the RIGHT (via the exit waypoint) before going anywhere else", () => {
    let checked = 0;
    for (const seed of [3, 7, 19, 23]) {
      const { director, nav } = setup(seed);
      const internals = director as unknown as {
        agents: Map<string, { brain: { position: Vec; isSeated: boolean } }>;
      };
      // Follow both agents' first trip away from their desks, in the same run.
      const watch = (["sam", "dexter"] as const).map((id) => ({
        id,
        desk: nav.desks.get(id)!,
        brain: internals.agents.get(id)!.brain,
        trail: [] as Vec[],
        left: false,
      }));
      for (let t = 0; t < 120_000 && watch.some((w) => !w.left); t += 16) {
        director.tick(16);
        for (const w of watch) {
          if (w.left || w.brain.isSeated) continue;
          const p = w.brain.position;
          w.trail.push(p);
          if (!near(p, w.desk.stand, 60) && !near(p, w.desk.exit!, 60)) w.left = true;
        }
      }
      for (const w of watch) {
        if (!w.left) continue;
        const moves = w.trail.filter((p) => !near(p, w.desk.stand, 2));
        const reachExit = moves.findIndex((p) => near(p, w.desk.exit!, 3));
        expect(reachExit, `${w.id} seed ${seed}`).toBeGreaterThanOrEqual(0);
        // Until the exit, the character only moves right of where it stood up.
        for (const p of moves.slice(0, reachExit)) {
          expect(p.x, `${w.id} seed ${seed}`).toBeGreaterThanOrEqual(w.desk.stand.x - 1);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});

describe("user control: click-to-move, interruption, and the 10 second window", () => {
  it("clicking an agent stops its work, stands it up, and leaves it idle without moving it", () => {
    const { director, control } = setup();
    director.setMode("baxter", "working");
    advance(director, 9000);
    expect(director.visualOf("baxter")).toBe("working");
    const before = director.positionOf("baxter")!;
    director.interrupt("baxter");
    const seen = new Set<string>();
    advance(director, 2000, () => seen.add(director.visualOf("baxter")!));
    expect(seen.has("standing_up")).toBe(true);
    expect(director.visualOf("baxter")).toBe("idle");
    expect(director.controlOf("baxter")).toBe("manual");
    expect(control).toContainEqual(["baxter", "manual"]);
    // Interrupting doesn't create a walk: Baxter stays at his desk's stand point.
    expect(near(director.positionOf("baxter")!, before, 40)).toBe(true);
    advance(director, 5000);
    expect(director.visualOf("baxter")).toBe("idle");
  });

  it.each(["sam", "dexter"] as const)("interrupting %s mid-emote returns it to idle", (id) => {
    const { director } = setup(11);
    const internals = director as unknown as {
      agents: Map<string, { brain: { update(dt: number): { emote?: string } } }>;
    };
    let emoting = false;
    for (let t = 0; t < 10 * 60_000 && !emoting; t += 16) {
      director.tick(16);
      emoting = Boolean(internals.agents.get(id)!.brain.update(0).emote);
    }
    expect(emoting).toBe(true);
    director.interrupt(id);
    advance(director, 200);
    expect(director.visualOf(id)).toBe("idle");
  });

  it("walks the selected agent to the clicked point, facing the direction of travel, then idles", () => {
    const { director, nav } = setup();
    director.interrupt("sam");
    advance(director, 1500);
    const start = director.positionOf("sam")!;
    const target = nav.hotspots.get("idle:hr:onboarding")!;
    const dest = director.moveTo("sam", target)!;
    expect(dest).toEqual({ x: target.x, y: target.y });
    const visuals: string[] = [];
    advance(director, 8000, () => visuals.push(director.visualOf("sam")!));
    expect(near(director.positionOf("sam")!, dest, 1)).toBe(true);
    expect(director.visualOf("sam")).toBe("idle");
    const expected = target.x > start.x ? "walking_right" : "walking_left";
    expect(visuals.find((v) => v.startsWith("walking"))).toBe(expected);
  });

  it("clicks inside furniture or walls stop at the nearest reachable floor instead", () => {
    const { director, nav } = setup();
    director.interrupt("dexter");
    advance(director, 1500);
    const server = nav.decor.find((d) => d.art === "serverRack")!.footprint!;
    const dest = director.moveTo("dexter", {
      x: server.x + server.w / 2,
      y: server.y + server.h / 2,
    })!;
    expect(isWalkable(nav.grid, dest)).toBe(true);
    advance(director, 9000);
    const p = director.positionOf("dexter")!;
    expect(near(p, dest, 1)).toBe(true);
    expect(
      p.x > server.x && p.x < server.x + server.w && p.y > server.y && p.y < server.y + server.h,
    ).toBe(false);
  });

  it("stays manual (no routine) for 10s after the last interaction, then resumes from where it is", () => {
    const { director, nav, control } = setup();
    director.interrupt("sam");
    const target = nav.hotspots.get("idle:hr:center")!;
    director.moveTo("sam", target);
    advance(director, MANUAL_TIMEOUT_MS - 500);
    expect(director.controlOf("sam")).toBe("manual");
    // Still exactly where the user sent it — no autonomous wandering.
    expect(near(director.positionOf("sam")!, target, 1)).toBe(true);
    expect(director.visualOf("sam")).toBe("idle");
    for (let t = 0; t < 1000 && director.controlOf("sam") === "manual"; t += 16) director.tick(16);
    expect(director.controlOf("sam")).toBe("autonomous");
    expect(control.filter(([id]) => id === "sam").map(([, m]) => m)).toEqual([
      "manual",
      "autonomous",
    ]);
    // Resumes naturally from that spot (no teleport back to the desk).
    director.tick(16);
    expect(near(director.positionOf("sam")!, target, 3)).toBe(true);
    let moved = false;
    advance(director, 60_000, () => {
      if (!near(director.positionOf("sam")!, target, 10)) moved = true;
    });
    expect(moved).toBe(true);
  });

  it("every interaction resets the 10s timer", () => {
    const { director, nav } = setup();
    director.interrupt("dexter");
    for (let i = 0; i < 4; i++) {
      advance(director, 8000);
      expect(director.controlOf("dexter")).toBe("manual");
      director.moveTo("dexter", nav.hotspots.get(i % 2 ? "idle:bi:center" : "idle:bi:reports")!);
    }
    advance(director, 8000);
    expect(director.controlOf("dexter")).toBe("manual");
    advance(director, 2500);
    expect(director.controlOf("dexter")).toBe("autonomous");
  });

  it("rapid repeated clicks end at the last destination with no competing movement", () => {
    const { director, nav } = setup();
    director.interrupt("sam");
    advance(director, 1500);
    const spots = [
      "idle:hr:tree",
      "idle:hr:files",
      "idle:hr:center",
      "idle:hr:onboarding",
      "idle:hr:conversation",
    ];
    for (const id of spots) {
      director.moveTo("sam", nav.hotspots.get(id)!);
      advance(director, 50);
    }
    const last = nav.hotspots.get(spots[spots.length - 1]!)!;
    advance(director, 8000);
    expect(near(director.positionOf("sam")!, last, 1)).toBe(true);
    expect(director.visualOf("sam")).toBe("idle");
  });

  it("real hand-offs wait for manual control to end, then play", () => {
    const { director, nav } = setup();
    director.interrupt("baxter");
    director.handleEvents([
      { type: "handoff", taskId: "t1", fromAgentId: "baxter", toAgentId: "sam" },
    ]);
    advance(director, 5000);
    expect(director.visualOf("baxter")).toBe("idle");
    const collab = nav.hotspots.get("collab:sam")!;
    let reached = false;
    advance(director, 40_000, () => {
      if (near(director.positionOf("baxter")!, collab)) reached = true;
    });
    expect(reached).toBe(true);
  });
});
