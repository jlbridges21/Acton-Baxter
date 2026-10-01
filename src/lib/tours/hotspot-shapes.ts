export const HOTSPOT_SHAPES = ["arrow", "chevron", "circle", "ring", "dot", "pulse"] as const;

export type HotspotShape = (typeof HOTSPOT_SHAPES)[number];
export type HotspotPlacement = "billboard" | "floor";

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function hotspotShape(value: string): HotspotShape {
  if ((HOTSPOT_SHAPES as readonly string[]).includes(value)) return value as HotspotShape;
  if (value === "square") return "circle";
  return "arrow";
}

export function hotspotPlacement(value: string): HotspotPlacement {
  return value === "floor" ? "floor" : "billboard";
}

export function shapeUsesRotation(shape: HotspotShape): boolean {
  return shape === "arrow" || shape === "chevron";
}

/** Degrees stored in the database, radians only where the markers plugin requires them. */
export function hotspotRollRadians(degrees: number): number {
  const turns = ((degrees % 360) + 360) % 360;
  return (turns * Math.PI) / 180;
}

/**
 * MarkerCSS3D starts upright via lookAt(0, y, 0), then applies rotateX(-pitch).
 * A quarter turn lays that plane on the ground.
 */
export const FLOOR_MARKER_PITCH = Math.PI / 2;

export function hotspotShapeSvg(shape: HotspotShape, color: string): string {
  const fill = HEX.test(color) ? color : "#FFFFFF";
  const body = shapeBody(shape, fill);
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">${body}</svg>`;
}

function shapeBody(shape: HotspotShape, fill: string): string {
  switch (shape) {
    case "chevron":
      return `<path d="M18 64 L50 28 L82 64" fill="none" stroke="${fill}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "circle":
      return `<circle cx="50" cy="50" r="40" fill="${fill}"/>`;
    case "ring":
      return `<circle cx="50" cy="50" r="32" fill="none" stroke="${fill}" stroke-width="12"/>`;
    case "dot":
      return `<circle cx="50" cy="50" r="16" fill="${fill}"/>`;
    case "pulse":
      return `<circle cx="50" cy="50" r="28" fill="none" stroke="${fill}" stroke-width="8" class="tour-hotspot-pulse"/><circle cx="50" cy="50" r="14" fill="${fill}"/>`;
    default:
      return `<polygon points="50,8 92,86 50,68 8,86" fill="${fill}"/>`;
  }
}
