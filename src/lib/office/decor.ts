/**
 * Department-specific office decorations, as data.
 *
 * Every item has a world-space art rectangle, a layer (wall-mounted, rug, or floor), and —
 * for floor items — a footprint that blocks walking and a depth anchor (`sortY`, the bottom
 * of the footprint) used to sort it against the characters. The same list drives rendering,
 * navigation obstacles, and named hotspots, so art and collision can't drift apart.
 *
 * Positions are relative to the room so every layout preset works; an item is dropped if it
 * would collide with a keep-out area (desks, desk approach/exit points, the doorway path).
 */

import type { OfficeRoom } from "@/lib/agents/office-layout";
import type { Vec } from "./sprite-pack";

export type Rect = { x: number; y: number; w: number; h: number };

export type RoomTheme = "executive" | "hr" | "analytics" | "generic" | "meeting";

export type DecorLayer = "wall" | "rug" | "floor";

export type DecorArt =
  | "bookcase"
  | "plant"
  | "tallPlant"
  | "strategyBoard"
  | "framedPlan"
  | "award"
  | "credenza"
  | "blueprintTubes"
  | "roundTable"
  | "chair"
  | "rug"
  | "roundRug"
  | "floorLamp"
  | "fileCabinet"
  | "lockedCabinet"
  | "policyShelf"
  | "onboardingTable"
  | "bulletinBoard"
  | "calendarBoard"
  | "checklistBoard"
  | "divider"
  | "whiteboard"
  | "kpiDisplay"
  | "dataShelf"
  | "serverRack"
  | "printerTable"
  | "reviewTable"
  | "chartEasel"
  | "waterBowl"
  | "meetingTable";

export type DecorItem = {
  id: string;
  roomKey: string;
  art: DecorArt;
  layer: DecorLayer;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Floor area that blocks walking (floor items only). */
  footprint: Rect | null;
  /** Depth anchor: the item's visual baseline on the floor. */
  sortY: number;
  label: string;
};

export type DecorSpot = { roomKey: string; name: string; x: number; y: number };

/** Picks a decoration theme from the department's slug/name. */
export function roomTheme(dept: { slug?: string | null; name?: string | null } | undefined): RoomTheme {
  const text = `${dept?.slug ?? ""} ${dept?.name ?? ""}`.toLowerCase();
  if (/exec|leadership|ceo/.test(text)) return "executive";
  if (/\bhr\b|hr-|human|people|admin|legal/.test(text)) return "hr";
  if (/intelligence|analytic|\bbi\b|data|report/.test(text)) return "analytics";
  return "generic";
}

type Spec = {
  art: DecorArt;
  layer: DecorLayer;
  /** Room-relative rect: numbers ≤ 1 are fractions of the room size, larger are pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Height of the footprint band at the bottom of the art (floor items). */
  base?: number;
  label: string;
};

type ThemeDef = { items: Spec[]; spots: Array<[string, number, number]> };

const fromRight = (px: number) => -px; // negative x = offset from the right wall

const THEMES: Record<RoomTheme, ThemeDef> = {
  executive: {
    items: [
      { art: "strategyBoard", layer: "wall", x: 0.4, y: 6, w: 0.2, h: 34, label: "Project roadmap board" },
      { art: "framedPlan", layer: "wall", x: 0.64, y: 8, w: 0.12, h: 28, label: "Framed ADU floor plan" },
      { art: "award", layer: "wall", x: fromRight(68), y: 10, w: 20, h: 24, label: "Company milestone award" },
      { art: "rug", layer: "rug", x: 0.36, y: 0.52, w: 0.3, h: 0.2, label: "Executive rug" },
      { art: "bookcase", layer: "floor", x: 12, y: 22, w: 40, h: 50, base: 14, label: "Leadership bookcase" },
      { art: "credenza", layer: "floor", x: 0.62, y: 48, w: 0.17, h: 28, base: 12, label: "Credenza with ADU model and lamp" },
      { art: "tallPlant", layer: "floor", x: fromRight(38), y: 26, w: 26, h: 50, base: 12, label: "Plant" },
      { art: "blueprintTubes", layer: "floor", x: fromRight(30), y: 0.46, w: 16, h: 34, base: 8, label: "Rolled blueprints" },
      { art: "chair", layer: "floor", x: 0.58, y: 0.64, w: 16, h: 22, base: 10, label: "Visitor chair" },
      { art: "roundTable", layer: "floor", x: 0.65, y: 0.66, w: 0.12, h: 26, base: 14, label: "Small meeting table" },
      { art: "chair", layer: "floor", x: 0.8, y: 0.64, w: 16, h: 22, base: 10, label: "Visitor chair" },
    ],
    spots: [
      ["strategy", 0.5, 64],
      ["model", 0.7, 92],
      ["bookcase", 34, 90],
      ["visitors", 0.6, 0.86],
      ["center", 0.5, 0.62],
      ["window", 0.5, 58],
      ["corner", fromRight(40), -30],
    ],
  },
  hr: {
    items: [
      { art: "bulletinBoard", layer: "wall", x: 0.37, y: 6, w: 0.2, h: 34, label: "Policy and onboarding board" },
      { art: "calendarBoard", layer: "wall", x: 0.6, y: 8, w: 0.1, h: 30, label: "Scheduling calendar" },
      { art: "checklistBoard", layer: "wall", x: 0.73, y: 8, w: 0.09, h: 30, label: "Compliance checklist" },
      { art: "roundRug", layer: "rug", x: 0.04, y: 0.66, w: 0.28, h: 0.2, label: "Welcome rug" },
      { art: "fileCabinet", layer: "floor", x: 12, y: 26, w: 22, h: 46, base: 14, label: "Personnel file cabinet" },
      { art: "lockedCabinet", layer: "floor", x: 36, y: 30, w: 22, h: 42, base: 14, label: "Locked records cabinet" },
      { art: "policyShelf", layer: "floor", x: 0.65, y: 24, w: 0.15, h: 48, base: 14, label: "Policy and legal reference shelf" },
      { art: "tallPlant", layer: "floor", x: fromRight(34), y: 16, w: 26, h: 60, base: 12, label: "Potted tree" },
      { art: "onboardingTable", layer: "floor", x: fromRight(62), y: 0.5, w: 50, h: 28, base: 14, label: "Onboarding station" },
      { art: "floorLamp", layer: "floor", x: 12, y: 0.55, w: 12, h: 38, base: 8, label: "Warm lamp" },
      { art: "chair", layer: "floor", x: 22, y: 0.72, w: 16, h: 22, base: 10, label: "Conversation chair" },
      { art: "chair", layer: "floor", x: 62, y: 0.72, w: 16, h: 22, base: 10, label: "Conversation chair" },
      { art: "divider", layer: "floor", x: 92, y: 0.62, w: 8, h: 0.3, base: 10, label: "Privacy panel" },
    ],
    spots: [
      ["files", 36, 90],
      ["policy", 0.72, 92],
      ["tree", fromRight(46), 100],
      ["onboarding", fromRight(80), 0.6],
      ["conversation", 48, 0.66],
      ["center", 0.5, 0.66],
      ["window", 0.5, 58],
      ["corner", fromRight(40), -30],
    ],
  },
  analytics: {
    items: [
      { art: "whiteboard", layer: "wall", x: 0.35, y: 4, w: 0.3, h: 38, label: "Whiteboard with metrics" },
      { art: "kpiDisplay", layer: "wall", x: 0.69, y: 8, w: 0.14, h: 28, label: "KPI wall display" },
      { art: "dataShelf", layer: "floor", x: 12, y: 22, w: 40, h: 50, base: 14, label: "Data reference shelf" },
      { art: "serverRack", layer: "floor", x: fromRight(36), y: 22, w: 24, h: 54, base: 12, label: "Data cabinet" },
      { art: "printerTable", layer: "floor", x: fromRight(66), y: 0.47, w: 52, h: 30, base: 14, label: "Printer and report station" },
      { art: "waterBowl", layer: "rug", x: fromRight(94), y: 0.62, w: 16, h: 7, label: "Water bowl" },
      { art: "reviewTable", layer: "floor", x: 0.6, y: 0.72, w: 0.18, h: 28, base: 14, label: "Report review table" },
      { art: "chartEasel", layer: "floor", x: 16, y: 0.6, w: 34, h: 44, base: 8, label: "Pinned chart board" },
      { art: "plant", layer: "floor", x: fromRight(32), y: -46, w: 20, h: 30, base: 10, label: "Plant" },
    ],
    spots: [
      ["whiteboard", 0.5, 62],
      ["dashboard", 0.76, 64],
      ["datacab", fromRight(54), 96],
      ["printer", fromRight(84), 0.58],
      ["reports", 0.56, 0.86],
      ["center", 0.5, 0.62],
      ["window", 0.5, 58],
      ["corner", fromRight(40), -30],
    ],
  },
  generic: {
    items: [
      { art: "bookcase", layer: "floor", x: 14, y: 30, w: 44, h: 36, base: 12, label: "Bookshelf" },
      { art: "plant", layer: "floor", x: fromRight(38), y: 40, w: 24, h: 34, base: 10, label: "Plant" },
    ],
    spots: [
      ["window", 0.5, 58],
      ["shelf", 40, 92],
      ["plant", fromRight(30), 100],
      ["center", 0.5, 0.62],
      ["corner", fromRight(40), -30],
    ],
  },
  meeting: {
    items: [
      { art: "chair", layer: "floor", x: 0.3, y: 0.3, w: 16, h: 18, base: 10, label: "Chair" },
      { art: "chair", layer: "floor", x: 0.45, y: 0.3, w: 16, h: 18, base: 10, label: "Chair" },
      { art: "chair", layer: "floor", x: 0.6, y: 0.3, w: 16, h: 18, base: 10, label: "Chair" },
      { art: "meetingTable", layer: "floor", x: 0.25, y: 0.4, w: 0.5, h: 0.3, base: 0.3, label: "Meeting table" },
    ],
    spots: [],
  },
};

function resolveX(v: number, room: OfficeRoom) {
  if (v < 0) return room.x + room.w + v;
  return room.x + (v <= 1 ? v * room.w : v);
}
function resolveY(v: number, room: OfficeRoom) {
  if (v < 0) return room.y + room.h + v;
  return room.y + (v <= 1 ? v * room.h : v);
}
const size = (v: number, total: number) => (v <= 1 ? v * total : v);

export function intersects(a: Rect, b: Rect, pad = 0) {
  return (
    a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y
  );
}

/** The floor strip from a room's door up into the room, kept clear of furniture. */
export function doorwayKeepOut(room: OfficeRoom): Rect {
  return { x: room.x + room.w / 2 - 32, y: room.y + room.h * 0.62, w: 64, h: room.h * 0.38 };
}

export function buildRoomDecor(
  room: OfficeRoom,
  theme: RoomTheme,
  keepOut: Rect[] = [],
): { items: DecorItem[]; spots: DecorSpot[] } {
  const def = THEMES[room.kind === "meeting" ? "meeting" : theme];
  if (room.kind === "future") return { items: [], spots: [] };
  const blocked = [...keepOut, ...(room.kind === "meeting" ? [] : [doorwayKeepOut(room)])];
  const items: DecorItem[] = [];
  def.items.forEach((spec, i) => {
    const x = resolveX(spec.x, room);
    const y = resolveY(spec.y, room);
    const w = size(spec.w, room.w);
    const h = size(spec.h, room.h);
    const art = { x, y, w, h };
    let footprint: Rect | null = null;
    if (spec.layer === "floor") {
      const base = size(spec.base ?? 12, room.h);
      footprint = { x, y: y + h - base, w, h: base };
    }
    // Stay inside the room and out of keep-out areas (desks, approach paths, the doorway).
    if (x < room.x + 6 || x + w > room.x + room.w - 6 || y + h > room.y + room.h - 6) return;
    if (spec.layer !== "wall" && blocked.some((k) => intersects(footprint ?? art, k, 4))) return;
    items.push({
      id: `${room.key}:${spec.art}:${i}`,
      roomKey: room.key,
      art: spec.art,
      layer: spec.layer,
      ...art,
      footprint,
      sortY: footprint ? footprint.y + footprint.h : y + h,
      label: spec.label,
    });
  });
  const spots: DecorSpot[] = def.spots.map(([name, sx, sy]) => ({
    roomKey: room.key,
    name,
    x: resolveX(sx, room),
    y: resolveY(sy, room),
  }));
  return { items, spots };
}

/** Points that must stay clear of decoration (with a margin), as small boxes. */
export function pointKeepOut(p: Vec, half = 16): Rect {
  return { x: p.x - half, y: p.y - half, w: half * 2, h: half * 2 };
}
