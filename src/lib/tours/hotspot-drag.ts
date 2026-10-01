/** Movement below this stays a click so selecting a hotspot is not a drag. */
export const HOTSPOT_DRAG_THRESHOLD_PX = 5;

export function dragExceededThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= HOTSPOT_DRAG_THRESHOLD_PX;
}

export type DragPoint = { x: number; y: number };
export type DragAngles = { yaw: number; pitch: number };

export type HotspotDragHost = {
  setMousemove: (enabled: boolean) => void;
  capture: (pointerId: number) => void;
  releaseCapture: (pointerId: number) => void;
  viewerPoint: (event: { clientX: number; clientY: number }) => DragPoint;
  toSpherical: (point: DragPoint) => DragAngles;
  updateMarker: (id: string, yaw: number, pitch: number) => void;
  commit: (id: string, yaw: number, pitch: number) => void;
};

type PointerLike = { pointerId: number; clientX: number; clientY: number };

/**
 * One pointer gesture. The panorama stops panning only after the threshold,
 * and the database is written once when that drag is released.
 */
export class HotspotDragSession {
  private pointerId: number | null = null;
  private markerId: string | null = null;
  private originX = 0;
  private originY = 0;
  private dragging = false;
  private yaw = 0;
  private pitch = 0;
  commits = 0;

  constructor(private readonly host: HotspotDragHost) {}

  get isDragging(): boolean {
    return this.dragging;
  }

  pointerDown(markerId: string, event: PointerLike): void {
    if (this.pointerId !== null) this.cancel();
    this.pointerId = event.pointerId;
    this.markerId = markerId;
    this.originX = event.clientX;
    this.originY = event.clientY;
    this.dragging = false;
  }

  pointerMove(event: PointerLike): void {
    if (this.pointerId !== event.pointerId || !this.markerId) return;
    const dx = event.clientX - this.originX;
    const dy = event.clientY - this.originY;
    if (!this.dragging) {
      if (!dragExceededThreshold(dx, dy)) return;
      this.dragging = true;
      this.host.setMousemove(false);
      this.host.capture(event.pointerId);
    }
    const spherical = this.host.toSpherical(this.host.viewerPoint(event));
    this.yaw = spherical.yaw;
    this.pitch = spherical.pitch;
    this.host.updateMarker(this.markerId, spherical.yaw, spherical.pitch);
  }

  pointerUp(event: PointerLike): void {
    if (this.pointerId !== event.pointerId || !this.markerId) return;
    const id = this.markerId;
    const yaw = this.yaw;
    const pitch = this.pitch;
    const dragged = this.dragging;
    this.finish();
    if (!dragged) return;
    this.commits += 1;
    this.host.commit(id, yaw, pitch);
  }

  /** Pointer cancel or a destroyed marker. Restores panning and does not write. */
  cancel(): void {
    this.finish();
  }

  private finish(): void {
    if (this.dragging && this.pointerId !== null) {
      this.host.releaseCapture(this.pointerId);
      this.host.setMousemove(true);
    }
    this.dragging = false;
    this.pointerId = null;
    this.markerId = null;
  }
}
