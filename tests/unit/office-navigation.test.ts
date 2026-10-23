import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeOfficeLayout,
  type LayoutPreset,
  type OfficeAgent,
} from "@/lib/agents/office-layout";
import {
  centerOn,
  clientToWorld,
  screenToWorld,
  worldToScreen,
  zoomAround,
} from "@/lib/office/camera";
import { doorwayKeepOut, intersects, roomTheme, type RoomTheme } from "@/lib/office/decor";
import {
  buildOfficeNav,
  findPath,
  hasLineOfSight,
  isWalkable,
  nearestReachable,
  roomDoor,
  roomInterior,
  staticSeatFootprint,
  type NavAgent,
  type NavPack,
  type Rect,
} from "@/lib/office/navigation";
import {
  SPRITE_PACKS,
  deskMetrics,
  parseSpritePackManifest,
  type Vec,
} from "@/lib/office/sprite-pack";

function navPack(packId: string, dir: string): NavPack {
  const def = SPRITE_PACKS[packId]!;
  const { manifest } = parseSpritePackManifest(
    JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, `../../public/animations/${dir}/manifest.json`),
        "utf8",
      ),
    ),
  );
  return {
    scale: def.scale,
    desk: deskMetrics(def, manifest)!,
    standPoint: manifest.canvases.desk.standPoint!,
    deskAnchor: manifest.canvases.desk.anchor,
    deskExit: def.deskExit,
  };
}

const PACKS: Record<string, NavPack> = {
  baxter: navPack("baxter-v3", "baxter/v3"),
  sam: navPack("sam-v1", "sam/v1"),
  dexter: navPack("dexter-v1", "dexter/v1"),
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
    slug: "hr-admin-legal",
    name: "HR, Administration & Legal",
    color: "#5b3f8c",
    is_visible: true,
    sort_order: 1,
  },
  {
    id: "bi",
    slug: "business-intelligence",
    name: "Business Intelligence & Analytics",
    color: "#2f6f5e",
    is_visible: true,
    sort_order: 2,
  },
];
const THEMES = new Map<string, RoomTheme>(departments.map((d) => [d.id, roomTheme(d)]));
const agents: OfficeAgent[] = [
  { id: "baxter", kind: "orchestrator", departmentId: "exec", desk: {} },
  { id: "sam", kind: "specialist", departmentId: "hr", desk: {} },
  { id: "dexter", kind: "specialist", departmentId: "bi", desk: {} },
];

function setup(
  preset: LayoutPreset = "studio",
  extraAgents: OfficeAgent[] = [],
  extraDepts = departments,
  animated = true,
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
    pack: animated ? (PACKS[seat.agentId] ?? null) : null,
  }));
  return { layout, nav: buildOfficeNav(layout, navAgents, { themes: THEMES }) };
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
  it("defines desks, doors, department hotspots, and a hand-off spot for every agent", () => {
    const { nav } = setup();
    for (const id of [
      "stand:baxter",
      "desk:baxter",
      "door:exec",
      "hall:exec",
      "collab:sam",
      "collab:dexter",
      "door:hr",
      "exit:sam",
      "exit:dexter",
      "idle:exec:strategy",
      "idle:exec:model",
      "idle:exec:bookcase",
      "idle:exec:visitors",
      "idle:hr:files",
      "idle:hr:onboarding",
      "idle:hr:policy",
      "idle:hr:conversation",
      "idle:hr:tree",
      "idle:bi:whiteboard",
      "idle:bi:dashboard",
      "idle:bi:reports",
      "idle:bi:datacab",
      "idle:bi:printer",
    ]) {
      expect(nav.hotspots.has(id), id).toBe(true);
    }
    for (const h of nav.hotspots.values()) {
      if (h.kind === "idle" || h.kind === "exit") expect(isWalkable(nav.grid, h), h.id).toBe(true);
    }
    expect(nav.hotspots.get("meeting:meeting")).toBeDefined();
    // Baxter's sit/stand art is beside his desk, so he has no exit rule.
    expect(nav.hotspots.has("exit:baxter")).toBe(false);
  });

  it.each(["studio", "campus", "compact"] as const)(
    "%s: Sam's and Dexter's desk exits are clear floor to the RIGHT of their desks",
    (preset) => {
      const { nav } = setup(preset);
      for (const id of ["sam", "dexter"]) {
        const desk = nav.desks.get(id)!;
        expect(desk.exit, id).not.toBeNull();
        expect(desk.exit!.x, id).toBeGreaterThan(desk.footprint.x + desk.footprint.w);
        expect(desk.exit!.x, id).toBeGreaterThan(desk.stand.x);
        expect(isWalkable(nav.grid, desk.exit!), id).toBe(true);
        expect(findPath(nav.grid, desk.stand, desk.exit!), id).not.toBeNull();
      }
    },
  );

  it.each(["studio", "campus", "compact"] as const)(
    "%s: every agent can reach every hotspot in its office from its desk",
    (preset) => {
      const { nav } = setup(preset);
      for (const [agentId, desk] of nav.desks) {
        const room = nav.roomOfAgent.get(agentId)!;
        for (const h of [...nav.hotspots.values()].filter(
          (h) => h.roomKey === room && h.kind === "idle",
        )) {
          expect(
            findPath(nav.grid, desk.exit ?? desk.stand, h),
            `${agentId} → ${h.id}`,
          ).not.toBeNull();
        }
      }
    },
  );

  it.each(["studio", "campus", "compact"] as const)(
    "%s: decorations never block desks, desk approaches, or the doorway",
    (preset) => {
      const { layout, nav } = setup(preset);
      const floor = nav.decor.filter((d) => d.footprint);
      for (const d of floor) {
        for (const desk of nav.desks.values()) {
          expect(intersects(d.footprint!, desk.footprint), `${d.id} vs desk`).toBe(false);
          expect(inside(d.footprint!, desk.stand), `${d.id} vs stand`).toBe(false);
          if (desk.exit) expect(inside(d.footprint!, desk.exit), `${d.id} vs exit`).toBe(false);
        }
        const room = layout.rooms.find((r) => r.key === d.roomKey)!;
        if (room.kind !== "meeting") {
          expect(intersects(d.footprint!, doorwayKeepOut(room)), `${d.id} vs door`).toBe(false);
        }
      }
      // Wall art and rugs never block walking.
      for (const d of nav.decor.filter((d) => d.layer !== "floor")) expect(d.footprint).toBeNull();
    },
  );

  it("each department gets its own themed decorations", () => {
    const { nav } = setup();
    const arts = (room: string) =>
      new Set(nav.decor.filter((d) => d.roomKey === room).map((d) => d.art));
    for (const a of [
      "strategyBoard",
      "framedPlan",
      "credenza",
      "bookcase",
      "roundTable",
      "blueprintTubes",
    ]) {
      expect(arts("exec").has(a as never), a).toBe(true);
    }
    for (const a of [
      "fileCabinet",
      "lockedCabinet",
      "policyShelf",
      "onboardingTable",
      "bulletinBoard",
      "calendarBoard",
      "checklistBoard",
    ]) {
      expect(arts("hr").has(a as never), a).toBe(true);
    }
    for (const a of [
      "whiteboard",
      "kpiDisplay",
      "serverRack",
      "printerTable",
      "reviewTable",
      "chartEasel",
      "dataShelf",
    ]) {
      expect(arts("bi").has(a as never), a).toBe(true);
    }
    expect(roomTheme({ slug: "finance", name: "Finance" })).toBe("generic");
  });

  it.each(["studio", "campus", "compact"] as const)(
    "%s: Baxter walks to Sam's office through doors, never through walls or furniture",
    (preset) => {
      const { layout, nav } = setup(preset);
      const from = nav.desks.get("baxter")!.stand;
      const to = nav.hotspots.get("collab:sam")!;
      const path = findPath(nav.grid, from, to);
      expect(path).not.toBeNull();
      const pts = samples(path!.slice(1, -1));
      const furniture = [
        ...nav.decor.flatMap((d) => (d.footprint ? [d.footprint] : [])),
        ...[...nav.desks.values()].map((d) => d.footprint),
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

  it("walls block straight lines between rooms; the future area is not walkable", () => {
    const { layout, nav } = setup();
    expect(
      hasLineOfSight(
        nav.grid,
        nav.hotspots.get("idle:exec:center")!,
        nav.hotspots.get("collab:sam")!,
      ),
    ).toBe(false);
    const future = layout.rooms.find((r) => r.kind === "future")!;
    expect(isWalkable(nav.grid, { x: future.x + future.w / 2, y: future.y + future.h / 2 })).toBe(
      false,
    );
  });

  it("static agents still block their portrait desk", () => {
    const { layout, nav } = setup("studio", [], departments, false);
    const sam = layout.seats.find((s) => s.agentId === "sam")!;
    const fp = staticSeatFootprint(sam);
    expect(isWalkable(nav.grid, { x: fp.x + fp.w / 2, y: fp.y + fp.h / 2 })).toBe(false);
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
      pack: PACKS[seat.agentId] ?? null,
      handoffSide: seat.agentId === "sam" ? "left" : undefined,
    }));
    const nav = buildOfficeNav(layout, navAgents, { themes: THEMES });
    expect(nav.hotspots.get("collab:sam")!.side).toBe("left");
  });
});

describe("click destinations (collision handling)", () => {
  it("a click on open floor is used exactly", () => {
    const { nav } = setup();
    const from = nav.desks.get("sam")!.exit!;
    const target = nav.hotspots.get("idle:hr:center")!;
    expect(nearestReachable(nav.grid, from, target)).toEqual({ x: target.x, y: target.y });
  });

  it("clicks inside furniture, desks, walls, or outside the office resolve to reachable floor", () => {
    const { layout, nav } = setup();
    const from = nav.desks.get("sam")!.exit!;
    const cabinet = nav.decor.find((d) => d.art === "fileCabinet")!.footprint!;
    const hr = layout.rooms.find((r) => r.key === "hr")!;
    const targets: Vec[] = [
      { x: cabinet.x + cabinet.w / 2, y: cabinet.y + cabinet.h / 2 }, // inside a cabinet
      { x: nav.desks.get("sam")!.footprint.x + 10, y: nav.desks.get("sam")!.footprint.y + 10 }, // inside the desk
      { x: hr.x + hr.w / 2, y: hr.y + 2 }, // inside the back wall
      { x: hr.x + hr.w / 3, y: hr.y + hr.h - 1 }, // inside the front wall (not the door)
      { x: -500, y: -500 }, // outside the office entirely
      { x: 5000, y: 5000 },
    ];
    for (const t of targets) {
      const dest = nearestReachable(nav.grid, from, t);
      expect(dest, JSON.stringify(t)).not.toBeNull();
      expect(isWalkable(nav.grid, dest!)).toBe(true);
      expect(findPath(nav.grid, from, dest!)).not.toBeNull();
      expect(inside(cabinet, dest!)).toBe(false);
    }
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

  it.each([
    { rect: { left: 16, top: 300 }, cam: { x: -13.7, y: 25.4, zoom: 0.4466 } }, // phone width
    { rect: { left: 220, top: 180 }, cam: { x: -179.3, y: -202.2, zoom: 1.1112 } }, // desktop, zoomed
    { rect: { left: 40, top: -120 }, cam: { x: 8, y: 8, zoom: 2 } }, // page scrolled past the top
  ])("pointer → world conversion is exact (%#)", ({ rect, cam }) => {
    const border = { left: 4, top: 4 };
    const world = { x: 337.5, y: 313.25 };
    const screen = worldToScreen(world, cam);
    const client = { x: screen.x + rect.left + border.left, y: screen.y + rect.top + border.top };
    const back = clientToWorld(client, rect, border, cam);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });
});
