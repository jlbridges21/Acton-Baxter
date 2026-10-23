/**
 * Scene depth for the AI Office.
 *
 * Four bands, bottom to top:
 *   background — rugs and floor decals, always under everything that stands on the floor
 *   wall       — boards, frames, wall displays: always behind characters
 *   world      — characters, desks, and floor furniture, sorted by their floor baseline
 *                (`sortY` = feet / bottom of footprint), so whoever is lower on screen is
 *                in front; equal baselines break ties by kind, then by a stable id order
 *   ui         — labels, bubbles, click indicators, hand-off chips: always on top
 *
 * The office renders with DOM elements, so these become z-index values computed from the
 * same function everywhere (decor in React, moving characters in the animation loop).
 */

export type DepthBand = "background" | "wall" | "world" | "ui";

/** Tie-break when two things share a baseline: furniture, then desks, then characters. */
export const DEPTH_RANK = { decor: 1, desk: 2, selection: 3, character: 4 } as const;

const BASE: Record<DepthBand, number> = { background: 2, wall: 5, world: 1000, ui: 40000 };
/** z-index steps per world pixel (leaves room for the rank tie-breaker). */
const STEPS = 8;

export function depthZ(band: DepthBand, sortY = 0, rank: number = DEPTH_RANK.decor): number {
  if (band !== "world") return BASE[band] + (band === "ui" ? Math.max(0, Math.round(rank)) : 0);
  return BASE.world + Math.max(0, Math.round(sortY)) * STEPS + rank;
}

export type DepthSortable = { id: string; band: DepthBand; sortY: number; rank: number };

/** Draw order for a list of scene entities (stable: ties keep a deterministic id order). */
export function sortByDepth<T extends DepthSortable>(entities: T[]): T[] {
  return [...entities].sort(
    (a, b) =>
      depthZ(a.band, a.sortY, a.rank) - depthZ(b.band, b.sortY, b.rank) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
