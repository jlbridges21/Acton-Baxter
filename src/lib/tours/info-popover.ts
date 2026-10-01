export type PopoverPoint = { x: number; y: number };

/**
 * Places an info popover beside a marker. A point behind the camera is hidden.
 * The box is clamped inside the viewer.
 */
export function placeInfoPopover(input: {
  visible: boolean;
  point: PopoverPoint | null;
  viewerWidth: number;
  viewerHeight: number;
  boxWidth: number;
  boxHeight: number;
}): PopoverPoint | null {
  if (!input.visible || !input.point) return null;
  const margin = 8;
  const maxX = Math.max(margin, input.viewerWidth - input.boxWidth - margin);
  const maxY = Math.max(margin, input.viewerHeight - input.boxHeight - margin);
  return {
    x: Math.min(Math.max(input.point.x - input.boxWidth / 2, margin), maxX),
    y: Math.min(Math.max(input.point.y - input.boxHeight - 12, margin), maxY),
  };
}
