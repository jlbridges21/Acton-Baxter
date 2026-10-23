/**
 * Office camera math. The office world (rooms, desks, characters, paths) lives in fixed
 * world coordinates; the camera is only a CSS `translate(x, y) scale(zoom)` on top.
 */

import type { Vec } from "./sprite-pack";

export type Camera = { x: number; y: number; zoom: number };

export function worldToScreen(p: Vec, cam: Camera): Vec {
  return { x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y };
}

export function screenToWorld(p: Vec, cam: Camera): Vec {
  return { x: (p.x - cam.x) / cam.zoom, y: (p.y - cam.y) / cam.zoom };
}

/** Pan that puts world point `p` in the middle of the viewport at `zoom`. */
export function centerOn(p: Vec, zoom: number, viewport: { width: number; height: number }): Vec {
  return { x: viewport.width / 2 - p.x * zoom, y: viewport.height / 2 - p.y * zoom };
}

/** New pan after zooming so the world point under `focus` (screen px) stays put. */
export function zoomAround(cam: Camera, nextZoom: number, focus: Vec): Vec {
  const world = screenToWorld(focus, cam);
  return { x: focus.x - world.x * nextZoom, y: focus.y - world.y * nextZoom };
}
