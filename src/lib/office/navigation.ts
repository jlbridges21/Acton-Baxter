/**
 * AI Office navigation in stable office-world coordinates (the same units as
 * computeOfficeLayout; pan/zoom is a CSS transform on top, so it never affects paths).
 *
 * The office is small and generated from presets, so a coarse occupancy grid + A* is the
 * simplest thing that works for any layout: room walls block except at a door gap in each
 * room's bottom wall, furniture blocks, and everything between rooms is hallway.
 */

import type { OfficeLayout, OfficeRoom, OfficeSeat } from "@/lib/agents/office-layout";
import {
  buildRoomDecor,
  pointKeepOut,
  type DecorItem,
  type Rect,
  type RoomTheme,
} from "./decor";
import type { DeskMetrics, Vec } from "./sprite-pack";

export type { Rect } from "./decor";

export const NAV_CELL = 8;
/** Feet keep this far from the back wall so the sprite's head doesn't poke through it. */
const INTERIOR = { left: 18, right: 18, top: 54, bottom: 14 };
const DOOR_WIDTH = 48;
const OUTER_EDGE = 10;
const FURNITURE_CLEARANCE = 6;

export type NavGrid = {
  cell: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  /** 1 = blocked. */
  blocked: Uint8Array;
};

export type HotspotKind =
  | "desk"
  | "stand"
  | "exit"
  | "collab"
  | "door"
  | "hall"
  | "idle"
  | "meeting";

export type Hotspot = {
  id: string;
  kind: HotspotKind;
  x: number;
  y: number;
  roomKey: string | null;
  agentId?: string;
  /** For collab spots: which side of the agent's desk the visitor stands on. */
  side?: HandoffSide;
};

export type HandoffSide = "auto" | "left" | "right" | "front";

export type DeskGeometry = {
  agentId: string;
  /** World position of the desk canvas's top-left corner. */
  origin: Vec;
  scale: number;
  /** Where the character's feet go before sitting down / after standing up. */
  stand: Vec;
  footprint: Rect;
  /** Visual front edge of the desk, used for depth sorting. */
  frontY: number;
  /** Waypoint autonomous routes pass through when leaving/returning (right-exit desks). */
  exit: Vec | null;
};

/** What navigation needs to know about an animated agent's desk art. */
export type NavPack = {
  scale: number;
  desk: DeskMetrics;
  standPoint: Vec;
  deskAnchor: Vec;
  deskExit: "right" | null;
};

export type NavAgent = {
  id: string;
  seat: OfficeSeat;
  pack: NavPack | null;
  handoffSide?: HandoffSide;
};

export type OfficeNav = {
  grid: NavGrid;
  hotspots: Map<string, Hotspot>;
  desks: Map<string, DeskGeometry>;
  roomOfAgent: Map<string, string>;
  rooms: OfficeRoom[];
  decor: DecorItem[];
};

/** How far right of the stand point the desk-exit waypoint sits. */
const DESK_EXIT_OFFSET = 34;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function roomInterior(room: OfficeRoom): Rect {
  return {
    x: room.x + INTERIOR.left,
    y: room.y + INTERIOR.top,
    w: room.w - INTERIOR.left - INTERIOR.right,
    h: room.h - INTERIOR.top - INTERIOR.bottom,
  };
}

/** Door gap in the bottom wall (drawn by the office too, so walls and art agree). */
export function roomDoor(room: OfficeRoom): Rect {
  return { x: room.x + room.w / 2 - DOOR_WIDTH / 2, y: room.y + room.h - 8, w: DOOR_WIDTH, h: 16 };
}

export function roomHasDoor(room: OfficeRoom): boolean {
  return room.kind !== "future";
}

/** Floor footprint of a static agent (portrait + CSS desk centred on the seat). */
export function staticSeatFootprint(seat: Vec): Rect {
  return { x: seat.x - 48, y: seat.y - 14, w: 96, h: 50 };
}

export function deskGeometry(agentId: string, seat: Vec, pack: NavPack): DeskGeometry {
  const s = pack.scale;
  // Tabletop centre sits a little below the seat point the static desk used.
  const origin = { x: seat.x - pack.desk.focus.x * s, y: seat.y + 10 - pack.desk.focus.y * s };
  const fp = pack.desk.footprint;
  return {
    agentId,
    origin,
    scale: s,
    stand: {
      x: origin.x + (pack.deskAnchor.x + pack.standPoint.x) * s,
      y: origin.y + (pack.deskAnchor.y + pack.standPoint.y) * s,
    },
    footprint: { x: origin.x + fp.x * s, y: origin.y + fp.y * s, w: fp.w * s, h: fp.h * s },
    frontY: origin.y + (fp.y + fp.h) * s,
    exit:
      pack.deskExit === "right"
        ? {
            x: origin.x + (pack.deskAnchor.x + pack.standPoint.x) * s + DESK_EXIT_OFFSET,
            y: origin.y + (pack.deskAnchor.y + pack.standPoint.y) * s,
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function inside(r: Rect, x: number, y: number) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function buildNavGrid(input: {
  width: number;
  height: number;
  rooms: OfficeRoom[];
  obstacles: Rect[];
  cell?: number;
}): NavGrid {
  const cell = input.cell ?? NAV_CELL;
  const cols = Math.ceil(input.width / cell);
  const rows = Math.ceil(input.height / cell);
  const blocked = new Uint8Array(cols * rows);
  const inflated = input.obstacles.map((o) => ({
    x: o.x - FURNITURE_CLEARANCE,
    y: o.y - FURNITURE_CLEARANCE,
    w: o.w + FURNITURE_CLEARANCE * 2,
    h: o.h + FURNITURE_CLEARANCE * 2,
  }));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cell + cell / 2;
      const y = r * cell + cell / 2;
      let block =
        x < OUTER_EDGE ||
        y < OUTER_EDGE ||
        x > input.width - OUTER_EDGE ||
        y > input.height - OUTER_EDGE;
      if (!block) {
        for (const room of input.rooms) {
          // Walls plus a little clearance on the outside.
          const outer = { x: room.x - 6, y: room.y - 6, w: room.w + 12, h: room.h + 12 };
          if (!inside(outer, x, y)) continue;
          if (room.kind === "future") {
            block = true;
            break;
          }
          const interior = roomInterior(room);
          const door = roomDoor(room);
          const doorway = {
            x: door.x + 8,
            y: interior.y + interior.h - 1,
            w: door.w - 16,
            h: room.y + room.h + 8 - (interior.y + interior.h - 1),
          };
          block = !inside(interior, x, y) && !inside(doorway, x, y);
          break;
        }
      }
      if (!block) block = inflated.some((o) => inside(o, x, y));
      blocked[r * cols + c] = block ? 1 : 0;
    }
  }
  return { cell, cols, rows, width: input.width, height: input.height, blocked };
}

function cellOf(grid: NavGrid, p: Vec) {
  return {
    c: Math.min(grid.cols - 1, Math.max(0, Math.floor(p.x / grid.cell))),
    r: Math.min(grid.rows - 1, Math.max(0, Math.floor(p.y / grid.cell))),
  };
}

function cellCenter(grid: NavGrid, c: number, r: number): Vec {
  return { x: c * grid.cell + grid.cell / 2, y: r * grid.cell + grid.cell / 2 };
}

export function isWalkable(grid: NavGrid, p: Vec): boolean {
  if (p.x < 0 || p.y < 0 || p.x >= grid.width || p.y >= grid.height) return false;
  const { c, r } = cellOf(grid, p);
  return grid.blocked[r * grid.cols + c] === 0;
}

/** Closest walkable cell centre within `maxCells`, searching outward ring by ring. */
export function nearestWalkable(grid: NavGrid, p: Vec, maxCells = 8): Vec | null {
  if (isWalkable(grid, p)) return p;
  const { c, r } = cellOf(grid, p);
  let best: Vec | null = null;
  let bestD = Infinity;
  for (let ring = 1; ring <= maxCells; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= grid.cols || rr >= grid.rows) continue;
        if (grid.blocked[rr * grid.cols + cc]) continue;
        const q = cellCenter(grid, cc, rr);
        const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

export function hasLineOfSight(grid: NavGrid, a: Vec, b: Vec): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / (grid.cell / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkable(grid, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
  }
  return true;
}

/**
 * A* over the grid (8-way, no corner cutting), then string-pulled into straight segments.
 * Start/goal may sit just off the walkable area (a desk approach point, say); they are
 * snapped to the nearest walkable cell and the exact point is appended at the end.
 */
export function findPath(grid: NavGrid, from: Vec, to: Vec): Vec[] | null {
  const start = nearestWalkable(grid, from);
  const goal = nearestWalkable(grid, to);
  if (!start || !goal) return null;
  const s = cellOf(grid, start);
  const g = cellOf(grid, goal);
  const { cols, rows, blocked } = grid;
  const idx = (c: number, r: number) => r * cols + c;
  const startI = idx(s.c, s.r);
  const goalI = idx(g.c, g.r);
  const gScore = new Float64Array(cols * rows).fill(Infinity);
  const came = new Int32Array(cols * rows).fill(-1);
  const closed = new Uint8Array(cols * rows);
  const heap = new MinHeap();
  const h = (i: number) => {
    const dc = Math.abs((i % cols) - g.c);
    const dr = Math.abs(Math.floor(i / cols) - g.r);
    return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr);
  };
  gScore[startI] = 0;
  heap.push(startI, h(startI));
  let found = startI === goalI;
  while (!found && heap.size) {
    const cur = heap.pop();
    if (cur === goalI) {
      found = true;
      break;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cc = cur % cols;
    const cr = Math.floor(cur / cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = idx(nc, nr);
        if (blocked[ni] || closed[ni]) continue;
        if (dr && dc && (blocked[idx(cc + dc, cr)] || blocked[idx(cc, cr + dr)])) continue;
        const tentative = gScore[cur]! + (dr && dc ? Math.SQRT2 : 1);
        if (tentative < gScore[ni]!) {
          gScore[ni] = tentative;
          came[ni] = cur;
          heap.push(ni, tentative + h(ni));
        }
      }
    }
  }
  if (!found) return null;
  const cells: Vec[] = [];
  for (let i = goalI; i !== -1 && i !== startI; i = came[i]!) {
    cells.push(cellCenter(grid, i % cols, Math.floor(i / cols)));
  }
  cells.reverse();
  const raw = [from, ...cells, to];
  return smoothPath(grid, raw);
}

/** Greedy string pulling: keep only the turns needed to stay on walkable ground. */
export function smoothPath(grid: NavGrid, path: Vec[]): Vec[] {
  if (path.length <= 2) return path;
  const out: Vec[] = [path[0]!];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    // The endpoints may be slightly off-grid (snapped), so only interior hops need LOS.
    while (j > i + 1 && !hasLineOfSight(grid, path[i]!, path[j]!)) j--;
    out.push(path[j]!);
    i = j;
  }
  return out;
}

export function pathLength(path: Vec[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) {
    d += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  }
  return d;
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number) {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent]! <= this.prio[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0]!;
    const lastItem = this.items.pop()!;
    const lastPrio = this.prio.pop()!;
    if (this.items.length) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l]! < this.prio[m]!) m = l;
        if (r < this.items.length && this.prio[r]! < this.prio[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.prio[a], this.prio[b]] = [this.prio[b]!, this.prio[a]!];
  }
}

// ---------------------------------------------------------------------------
// Office navigation + hotspot registry
// ---------------------------------------------------------------------------

/**
 * Builds the walkable grid and named hotspots for the current layout. Every agent with a
 * seat gets desk + collaboration hotspots, so a newly added agent is reachable without any
 * character-specific code.
 */
export function buildOfficeNav(
  layout: OfficeLayout,
  agents: NavAgent[],
  options: { themes?: Map<string, RoomTheme> } = {},
): OfficeNav {
  const desks = new Map<string, DeskGeometry>();
  const obstacles: Rect[] = [];
  const keepOut: Rect[] = [];
  for (const a of agents) {
    if (a.pack) {
      const desk = deskGeometry(a.id, a.seat, a.pack);
      desks.set(a.id, desk);
      obstacles.push(desk.footprint);
      keepOut.push(
        { x: desk.footprint.x - 8, y: desk.footprint.y - 30, w: desk.footprint.w + 16, h: desk.footprint.h + 38 },
        pointKeepOut(desk.stand, 20),
      );
      if (desk.exit) keepOut.push(pointKeepOut(desk.exit, 22));
    } else {
      obstacles.push(staticSeatFootprint(a.seat));
      keepOut.push(staticSeatFootprint(a.seat));
    }
    // Leave room for a visitor on the right of every desk (hand-offs).
    const fp = desks.get(a.id)?.footprint ?? staticSeatFootprint(a.seat);
    keepOut.push(pointKeepOut({ x: fp.x + fp.w + 30, y: fp.y + fp.h * 0.8 }, 18));
  }

  const decor: DecorItem[] = [];
  const decorSpots: Array<{ roomKey: string; name: string; x: number; y: number }> = [];
  for (const room of layout.rooms) {
    const theme = options.themes?.get(room.key) ?? "generic";
    const built = buildRoomDecor(room, theme, keepOut);
    decor.push(...built.items);
    decorSpots.push(...built.spots);
  }
  for (const item of decor) if (item.footprint) obstacles.push(item.footprint);

  const grid = buildNavGrid({
    width: layout.width,
    height: layout.height,
    rooms: layout.rooms,
    obstacles,
  });

  const hotspots = new Map<string, Hotspot>();
  const add = (h: Hotspot, snap = true) => {
    const p = snap ? nearestWalkable(grid, h) : h;
    if (p) hotspots.set(h.id, { ...h, x: p.x, y: p.y });
  };

  for (const room of layout.rooms) {
    if (!roomHasDoor(room)) continue;
    const cx = room.x + room.w / 2;
    add({
      id: `door:${room.key}`,
      kind: "door",
      x: cx,
      y: room.y + room.h - 22,
      roomKey: room.key,
    });
    add({ id: `hall:${room.key}`, kind: "hall", x: cx, y: room.y + room.h + 26, roomKey: null });
    if (room.kind === "meeting") {
      add({
        id: `meeting:${room.key}`,
        kind: "meeting",
        x: room.x + room.w * 0.2,
        y: room.y + room.h * 0.85,
        roomKey: room.key,
      });
    }
  }
  for (const spot of decorSpots) {
    add({ id: `idle:${spot.roomKey}:${spot.name}`, kind: "idle", x: spot.x, y: spot.y, roomKey: spot.roomKey });
  }

  const roomOfAgent = new Map<string, string>();
  for (const a of agents) {
    roomOfAgent.set(a.id, a.seat.roomKey);
    add(
      {
        id: `desk:${a.id}`,
        kind: "desk",
        x: a.seat.x,
        y: a.seat.y,
        roomKey: a.seat.roomKey,
        agentId: a.id,
      },
      false,
    );
    const desk = desks.get(a.id);
    if (desk) {
      add(
        {
          id: `stand:${a.id}`,
          kind: "stand",
          x: desk.stand.x,
          y: desk.stand.y,
          roomKey: a.seat.roomKey,
          agentId: a.id,
        },
        false,
      );
      if (desk.exit) {
        // Snap onto walkable floor, and keep the geometry in sync with the hotspot.
        add({ id: `exit:${a.id}`, kind: "exit", ...desk.exit, roomKey: a.seat.roomKey, agentId: a.id });
        const snapped = hotspots.get(`exit:${a.id}`);
        if (snapped) desk.exit = { x: snapped.x, y: snapped.y };
      }
    }
    const fp = desk?.footprint ?? staticSeatFootprint(a.seat);
    const candidates: Record<Exclude<HandoffSide, "auto">, Vec> = {
      right: { x: fp.x + fp.w + 30, y: fp.y + fp.h * 0.8 },
      left: { x: fp.x - 30, y: fp.y + fp.h * 0.8 },
      front: { x: fp.x + fp.w * 0.3, y: fp.y + fp.h + 22 },
    };
    const order: Array<Exclude<HandoffSide, "auto">> =
      a.handoffSide && a.handoffSide !== "auto"
        ? [a.handoffSide, "right", "left", "front"]
        : ["right", "left", "front"];
    for (const side of order) {
      const p = candidates[side];
      const room = layout.rooms.find((r) => r.key === a.seat.roomKey);
      if (isWalkable(grid, p) && (!room || inside(room, p.x, p.y))) {
        add(
          {
            id: `collab:${a.id}`,
            kind: "collab",
            ...p,
            roomKey: a.seat.roomKey,
            agentId: a.id,
            side,
          },
          false,
        );
        break;
      }
    }
    if (!hotspots.has(`collab:${a.id}`)) {
      add({
        id: `collab:${a.id}`,
        kind: "collab",
        ...candidates.front,
        roomKey: a.seat.roomKey,
        agentId: a.id,
        side: "front",
      });
    }
  }

  return { grid, hotspots, desks, roomOfAgent, rooms: layout.rooms, decor };
}

/**
 * The reachable floor point closest to `target`, starting from `from`: a flood fill over
 * walkable cells, so a click inside furniture, a wall, or an unreachable pocket still
 * resolves to somewhere the character can actually walk to.
 */
export function nearestReachable(grid: NavGrid, from: Vec, target: Vec): Vec | null {
  const start = nearestWalkable(grid, from);
  if (!start) return null;
  const { cols, rows, blocked } = grid;
  const s = cellOf(grid, start);
  const seen = new Uint8Array(cols * rows);
  const queue = [s.r * cols + s.c];
  seen[queue[0]!] = 1;
  let best: number = queue[0]!;
  let bestD = Infinity;
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi]!;
    const c = i % cols;
    const r = Math.floor(i / cols);
    const p = cellCenter(grid, c, r);
    const d = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (seen[ni] || blocked[ni]) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  // The exact point when it's on reachable floor, else the closest reachable cell centre.
  const tc = cellOf(grid, target);
  if (isWalkable(grid, target) && seen[tc.r * cols + tc.c]) return { ...target };
  return cellCenter(grid, best % cols, Math.floor(best / cols));
}

/** A random walkable point inside a room's interior (for casual wandering). */
export function randomPointInRoom(
  nav: OfficeNav,
  roomKey: string,
  rng: () => number,
  attempts = 24,
): Vec | null {
  const room = nav.rooms.find((r) => r.key === roomKey);
  if (!room) return null;
  const interior = roomInterior(room);
  for (let i = 0; i < attempts; i++) {
    const p = { x: interior.x + rng() * interior.w, y: interior.y + rng() * interior.h };
    if (isWalkable(nav.grid, p)) return p;
  }
  return null;
}
