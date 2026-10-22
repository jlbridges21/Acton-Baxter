/**
 * AI Office layout: curated presets, no free-form building editor.
 *
 * Rooms are created only for visible departments that have at least one agent, so the
 * office never shows empty departments to look busy. Optional extras: a shared meeting
 * area and a clearly labelled "space for future departments".
 */

export type LayoutPreset = "studio" | "campus" | "compact";

export type OfficeDepartment = {
  id: string;
  slug: string;
  name: string;
  color: string;
  is_visible: boolean;
  sort_order: number;
};

export type OfficeAgent = {
  id: string;
  kind: "orchestrator" | "specialist";
  departmentId: string | null;
  desk: { area?: string; slot?: number };
};

export type OfficeRoom = {
  key: string;
  kind: "department" | "meeting" | "future";
  label: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type OfficeSeat = { agentId: string; roomKey: string; x: number; y: number };

export type OfficeLayout = {
  width: number;
  height: number;
  rooms: OfficeRoom[];
  seats: OfficeSeat[];
};

const PRESETS: Record<
  LayoutPreset,
  { columns: number; roomW: number; roomH: number; gap: number }
> = {
  studio: { columns: 2, roomW: 380, roomH: 280, gap: 56 },
  campus: { columns: 3, roomW: 360, roomH: 270, gap: 72 },
  compact: { columns: 4, roomW: 290, roomH: 230, gap: 32 },
};

const PADDING = 48;

/** Seat offsets inside a room (2 × 2 desks), relative to the room's top-left. */
function seatOffset(slot: number, roomW: number, roomH: number) {
  const col = slot % 2;
  const row = Math.floor(slot / 2) % 2;
  return { x: roomW * (col === 0 ? 0.3 : 0.7), y: roomH * (row === 0 ? 0.42 : 0.78) };
}

export function resolveAgentRoom(
  agent: OfficeAgent,
  departments: OfficeDepartment[],
): string | null {
  const byArea = agent.desk.area
    ? departments.find((d) => d.slug === agent.desk.area || d.id === agent.desk.area)
    : null;
  if (byArea?.is_visible) return byArea.id;
  const own = departments.find((d) => d.id === agent.departmentId);
  return own?.is_visible ? own.id : null;
}

export function computeOfficeLayout(input: {
  preset: LayoutPreset;
  departments: OfficeDepartment[];
  agents: OfficeAgent[];
  showMeetingArea: boolean;
  showFutureSpace: boolean;
  labels: Record<string, string>;
}): OfficeLayout {
  const p = PRESETS[input.preset] ?? PRESETS.studio;
  const roomOf = new Map(input.agents.map((a) => [a.id, resolveAgentRoom(a, input.departments)]));
  const orchestratorDept = input.agents.find((a) => a.kind === "orchestrator");
  const execRoom = orchestratorDept ? roomOf.get(orchestratorDept.id) : null;

  const occupied = input.departments
    .filter((d) => d.is_visible && [...roomOf.values()].includes(d.id))
    .sort((a, b) => (a.id === execRoom ? -1 : b.id === execRoom ? 1 : a.sort_order - b.sort_order));

  const specs: Array<Omit<OfficeRoom, "x" | "y" | "w" | "h">> = occupied.map((d) => ({
    key: d.id,
    kind: "department",
    label: input.labels[d.id] || d.name,
    color: d.color,
  }));
  if (input.showMeetingArea) {
    specs.push({
      key: "meeting",
      kind: "meeting",
      label: input.labels.meeting || "Meeting room",
      color: "#2f6f5e",
    });
  }
  if (input.showFutureSpace) {
    specs.push({
      key: "future",
      kind: "future",
      label: input.labels.future || "Space for future departments",
      color: "#8a8f98",
    });
  }

  const rooms: OfficeRoom[] = specs.map((spec, index) => ({
    ...spec,
    x: PADDING + (index % p.columns) * (p.roomW + p.gap),
    y: PADDING + Math.floor(index / p.columns) * (p.roomH + p.gap),
    w: p.roomW,
    h: p.roomH,
  }));

  const seats: OfficeSeat[] = [];
  const usedSlots = new Map<string, Set<number>>();
  // Respect explicit slots first, then fill the rest in order.
  const ordered = [...input.agents].sort((a, b) => (a.desk.slot ?? 99) - (b.desk.slot ?? 99));
  for (const agent of ordered) {
    const roomKey = roomOf.get(agent.id);
    const room = rooms.find((r) => r.key === roomKey);
    if (!room) continue;
    const taken = usedSlots.get(room.key) ?? new Set<number>();
    let slot =
      agent.desk.slot != null && agent.desk.slot < 4 && !taken.has(agent.desk.slot)
        ? agent.desk.slot
        : 0;
    while (taken.has(slot) && slot < 8) slot++;
    taken.add(slot);
    usedSlots.set(room.key, taken);
    const offset = seatOffset(slot, room.w, room.h);
    seats.push({
      agentId: agent.id,
      roomKey: room.key,
      x: room.x + offset.x,
      y: room.y + offset.y,
    });
  }

  const cols = Math.min(p.columns, Math.max(rooms.length, 1));
  const rows = Math.max(1, Math.ceil(rooms.length / p.columns));
  return {
    width: PADDING * 2 + cols * p.roomW + (cols - 1) * p.gap,
    height: PADDING * 2 + rows * p.roomH + (rows - 1) * p.gap,
    rooms,
    seats,
  };
}
