import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeOfficeLayout,
  type LayoutPreset,
  type OfficeAgent,
} from "@/lib/agents/office-layout";
import { centerOn, screenToWorld, worldToScreen, zoomAround } from "@/lib/office/camera";
import {
  buildOfficeNav,
  findPath,
  hasLineOfSight,
  isWalkable,
  roomDoor,
  roomFurniture,
  roomInterior,
  staticSeatFootprint,
  type NavAgent,
  type Rect,
} from "@/lib/office/navigation";
import { SPRITE_PACKS, type Vec } from "@/lib/office/sprite-pack";

const manifest = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../public/animations/baxter/v3/manifest.json"),
    "utf8",
  ),
);
const PACK = {
  ...SPRITE_PACKS["baxter-v3"]!,
  standPoint: manifest.canvases.desk.standPoint as Vec,
  deskAnchor: manifest.canvases.desk.anchor as Vec,
};

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
    id: "bi",
    slug: "bi",
    name: "Business Intelligence",
    color: "#2f6f5e",
    is_visible: true,
    sort_order: 2,
  },
];
const agents: OfficeAgent[] = [
  { id: "baxter", kind: "orchestrator", departmentId: "exec", desk: {} },
  { id: "sam", kind: "specialist", departmentId: "hr", desk: {} },
  { id: "dexter", kind: "specialist", departmentId: "bi", desk: {} },
];

function setup(
  preset: LayoutPreset = "studio",
  extraAgents: OfficeAgent[] = [],
  extraDepts = departments,
) {
  const layout = computeOfficeLayout({
    preset,
    departments: extraDepts,
    agents: [...agents, ...extraAgents],
    showMeetingArea: true,
    showFutureSpace: true,
    labels: {},
  });
  const navAgents: NavAgent[] = layout.seats.map((seat) => ({
    id: seat.agentId,
    seat,
    pack: seat.agentId === "baxter" ? PACK : null,
  }));
  return { layout, nav: buildOfficeNav(layout, navAgents) };
}

const inside = (r: Rect, p: Vec) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

/** Samples every segment of a path every 2px. */
function samples(path: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
    for (let k = 0; k <= n; k++)
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

describe("office navigation", () => {
  it("defines Baxter's desk, door, idle spots, and a hand-off spot for every agent", () => {
    const { nav } = setup();
    for (const id of [
      "stand:baxter",
      "desk:baxter",
      "door:exec",
      "hall:exec",
      "collab:sam",
      "collab:dexter",
      "door:hr",
    ]) {
      expect(nav.hotspots.has(id), id).toBe(true);
    }
    const idle = [...nav.hotspots.values()].filter(
      (h) => h.kind === "idle" && h.roomKey === "exec",
    );
    expect(idle.length).toBeGreaterThanOrEqual(2);
    for (const h of idle) expect(isWalkable(nav.grid, h), h.id).toBe(true);
    expect(nav.hotspots.get("meeting:meeting")).toBeDefined();
  });

  it("Baxter can reach his desk and every idle spot without leaving walkable ground", () => {
    const { nav } = setup();
    const start = nav.hotspots.get("idle:exec:window")!;
    for (const target of [...nav.hotspots.values()].filter((h) => h.roomKey === "exec")) {
      const p = findPath(nav.grid, start, target);
      expect(p, target.id).not.toBeNull();
      // Interior hops stay on walkable cells; endpoints may be a snapped desk approach point.
      for (let i = 2; i < p!.length - 1; i++)
        expect(hasLineOfSight(nav.grid, p![i - 1]!, p![i]!)).toBe(true);
    }
    expect(findPath(nav.grid, start, nav.hotspots.get("stand:baxter")!)).not.toBeNull();
  });

  it.each(["studio", "campus", "compact"] as const)(
    "%s layout: Baxter walks to Sam's office through doors, never through walls or furniture",
    (preset) => {
      const { layout, nav } = setup(preset);
      const from = nav.desks.get("baxter")!.stand;
      const to = nav.hotspots.get("collab:sam")!;
      const path = findPath(nav.grid, from, to);
      expect(path).not.toBeNull();
      const pts = samples(path!.slice(1, -1));
      const furniture = [
        ...layout.rooms.flatMap(roomFurniture),
        ...layout.seats.filter((s) => s.agentId !== "baxter").map(staticSeatFootprint),
        nav.desks.get("baxter")!.footprint,
      ];
      for (const p of pts) {
        expect(isWalkable(nav.grid, p)).toBe(true);
        for (const f of furniture) expect(inside(f, p)).toBe(false);
      }
      // Leaving/entering a room is only possible through the door gap.
      for (const room of layout.rooms.filter((r) => r.kind === "department")) {
        const interior = roomInterior(room);
        const door = roomDoor(room);
        for (let i = 1; i < pts.length; i++) {
          const wasIn = inside(interior, pts[i - 1]!);
          const isIn = inside(interior, pts[i]!);
          if (wasIn !== isIn) {
            expect(pts[i]!.x).toBeGreaterThanOrEqual(door.x);
            expect(pts[i]!.x).toBeLessThanOrEqual(door.x + door.w);
          }
        }
      }
    },
  );

  it("walls block straight lines between rooms", () => {
    const { nav } = setup();
    const a = nav.hotspots.get("idle:exec:center")!;
    const b = nav.hotspots.get("collab:sam")!;
    expect(hasLineOfSight(nav.grid, a, b)).toBe(false);
  });

  it("the future-departments area is not walkable", () => {
    const { layout, nav } = setup();
    const future = layout.rooms.find((r) => r.kind === "future")!;
    expect(isWalkable(nav.grid, { x: future.x + future.w / 2, y: future.y + future.h / 2 })).toBe(
      false,
    );
  });

  it("a newly added agent gets a reachable hand-off spot with no Baxter-specific code", () => {
    const { nav } = setup(
      "campus",
      [{ id: "fiona", kind: "specialist", departmentId: "finance", desk: {} }],
      [
        ...departments,
        {
          id: "finance",
          slug: "finance",
          name: "Finance",
          color: "#8a5a00",
          is_visible: true,
          sort_order: 3,
        },
      ],
    );
    const spot = nav.hotspots.get("collab:fiona");
    expect(spot).toBeDefined();
    expect(findPath(nav.grid, nav.desks.get("baxter")!.stand, spot!)).not.toBeNull();
  });

  it("honours an admin-chosen hand-off side when it fits", () => {
    const { layout } = setup();
    const navAgents: NavAgent[] = layout.seats.map((seat) => ({
      id: seat.agentId,
      seat,
      pack: seat.agentId === "baxter" ? PACK : null,
      handoffSide: seat.agentId === "sam" ? "left" : undefined,
    }));
    const nav = buildOfficeNav(layout, navAgents);
    expect(nav.hotspots.get("collab:sam")!.side).toBe("left");
  });
});

describe("office camera", () => {
  it("pan and zoom never change world coordinates", () => {
    const p = { x: 312.5, y: 180 };
    for (const cam of [
      { x: 0, y: 0, zoom: 1 },
      { x: -240, y: 75, zoom: 0.45 },
      { x: 90, y: -300, zoom: 2 },
    ]) {
      const back = screenToWorld(worldToScreen(p, cam), cam);
      expect(back.x).toBeCloseTo(p.x);
      expect(back.y).toBeCloseTo(p.y);
    }
  });

  it("centering and zooming keep the focused world point under the same screen point", () => {
    const viewport = { width: 800, height: 500 };
    const pan = centerOn({ x: 100, y: 200 }, 1.5, viewport);
    expect(worldToScreen({ x: 100, y: 200 }, { ...pan, zoom: 1.5 })).toEqual({ x: 400, y: 250 });
    const cam = { x: 30, y: -20, zoom: 0.8 };
    const focus = { x: 400, y: 250 };
    const world = screenToWorld(focus, cam);
    const next = zoomAround(cam, 1.6, focus);
    const after = worldToScreen(world, { ...next, zoom: 1.6 });
    expect(after.x).toBeCloseTo(focus.x);
    expect(after.y).toBeCloseTo(focus.y);
  });
});
