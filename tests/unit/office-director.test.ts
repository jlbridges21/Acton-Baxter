import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficeDirector, type Cue } from "@/components/ai/office/director";
import { computeOfficeLayout, type OfficeAgent } from "@/lib/agents/office-layout";
import { buildOfficeNav, type NavAgent } from "@/lib/office/navigation";
import { SPRITE_PACKS, parseSpritePackManifest } from "@/lib/office/sprite-pack";
import { reconcile, seedCoordinator, type DelegationSnapshot } from "@/lib/office/task-coordinator";

const { manifest } = parseSpritePackManifest(
  JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../../public/animations/baxter/v3/manifest.json"),
      "utf8",
    ),
  ),
);
const def = SPRITE_PACKS["baxter-v3"]!;

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
    slug: "hr",
    name: "HR, Administration & Legal",
    color: "#5b3f8c",
    is_visible: true,
    sort_order: 1,
  },
  {
    id: "fin",
    slug: "finance",
    name: "Finance",
    color: "#8a5a00",
    is_visible: true,
    sort_order: 2,
  },
];
const officeAgents: OfficeAgent[] = [
  { id: "baxter", kind: "orchestrator", departmentId: "exec", desk: {} },
  { id: "sam", kind: "specialist", departmentId: "hr", desk: {} },
  { id: "fiona", kind: "specialist", departmentId: "fin", desk: {} },
];

function setup(seed = 5) {
  const layout = computeOfficeLayout({
    preset: "studio",
    departments,
    agents: officeAgents,
    showMeetingArea: true,
    showFutureSpace: false,
    labels: {},
  });
  const pack = {
    ...def,
    standPoint: manifest.canvases.desk.standPoint!,
    deskAnchor: manifest.canvases.desk.anchor,
  };
  const navAgents: NavAgent[] = layout.seats.map((seat) => ({
    id: seat.agentId,
    seat,
    pack: seat.agentId === "baxter" ? pack : null,
  }));
  const nav = buildOfficeNav(layout, navAgents);
  const cues: Array<[string, Cue]> = [];
  let s = seed;
  const director = new OfficeDirector({
    nav,
    agents: [
      {
        id: "baxter",
        name: "Baxter",
        roomKey: "exec",
        pack: def,
        manifest,
        desk: nav.desks.get("baxter")!,
      },
    ],
    names: new Map([
      ["baxter", { name: "Baxter", department: "Executive Office" }],
      ["sam", { name: "Sam", department: "HR, Administration & Legal" }],
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
  });
  return { director, nav, cues };
}

function advance(director: OfficeDirector, ms: number, onStep?: () => void) {
  for (let t = 0; t < ms; t += 16) {
    director.tick(16);
    onStep?.();
  }
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }, d = 6) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= d;

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

afterEach(() => vi.restoreAllMocks());

describe("office director (task-driven animation)", () => {
  it("decorative movement never fetches, writes, or creates tasks", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { director } = setup();
    const visuals = new Set<string>();
    advance(director, 5 * 60_000, () => visuals.add(director.visualOf("baxter")!));
    expect(fetchSpy).not.toHaveBeenCalled();
    // ...and over five minutes Baxter actually does several different things.
    expect(visuals.size).toBeGreaterThanOrEqual(5);
    expect([...visuals].some((v) => v.startsWith("walking"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("a real delegation sends Baxter to Sam's hand-off spot through the office, then home", () => {
    const { director, nav, cues } = setup();
    advance(director, 2000);
    let state = seedCoordinator([], "2026-10-22T18:00:00.000Z");
    const r = reconcile(state, {
      delegations: [snap("queued")],
      serverTime: "2026-10-22T18:00:01.000Z",
    });
    state = r.state;
    director.setMode("baxter", "waiting");
    director.handleEvents(r.events);
    const collab = nav.hotspots.get("collab:sam")!;
    let reached = false;
    advance(director, 30_000, () => {
      if (near(director.positionOf("baxter")!, collab)) reached = true;
    });
    expect(reached).toBe(true);
    expect(cues.some(([, c]) => c.caption === "Assigned an HR task to Sam")).toBe(true);
    // Back at his own desk, waiting (seated, not "working") while Sam works.
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

  it("failed work never leaves Baxter typing", () => {
    const { director } = setup();
    director.setMode("baxter", "working");
    advance(director, 8000);
    expect(director.visualOf("baxter")).toBe("working");
    director.setMode("baxter", "failed");
    advance(director, 6000);
    expect(director.visualOf("baxter")).not.toBe("working");
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

  it("pausing ambient keeps Baxter still", () => {
    const { director } = setup();
    advance(director, 3000);
    director.setAmbient("normal", true);
    advance(director, 2000);
    const p = director.positionOf("baxter")!;
    advance(director, 60_000);
    expect(director.positionOf("baxter")).toEqual(p);
  });
});
