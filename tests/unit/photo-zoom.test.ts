import { describe, expect, it } from "vitest";
import { HOTSPOT_DRAG_THRESHOLD_PX } from "@/lib/tours/hotspot-drag";
import {
  PHOTO_PAN_DRAG_THRESHOLD_PX,
  PHOTO_ZOOM_FIT,
  clampPhotoPan,
  clickPhotoZoom,
  fittedPhotoSize,
  isPhotoPanDrag,
  maxPhotoZoom,
  photoPanAfterQuarterTurnCcw,
  photoZoomAfterSourceChange,
  zoomAboutPoint,
} from "@/lib/inspections/photo-zoom";

const stage = { width: 800, height: 600 };
const fit = { width: 400, height: 300 };

describe("photo zoom", () => {
  it("uses the tour editor's 5px drag threshold", () => {
    expect(PHOTO_PAN_DRAG_THRESHOLD_PX).toBe(HOTSPOT_DRAG_THRESHOLD_PX);
    expect(PHOTO_PAN_DRAG_THRESHOLD_PX).toBe(5);
    expect(isPhotoPanDrag(4, 0)).toBe(false);
    expect(isPhotoPanDrag(3, 4)).toBe(true);
  });

  it("keeps the clicked point fixed when zooming in from fit", () => {
    const point = { x: 50, y: -20 };
    const next = clickPhotoZoom(PHOTO_ZOOM_FIT, point.x, point.y, 8);
    expect(next.zoom).toBe(2);
    const localX = (point.x - PHOTO_ZOOM_FIT.panX) / PHOTO_ZOOM_FIT.zoom;
    const localY = (point.y - PHOTO_ZOOM_FIT.panY) / PHOTO_ZOOM_FIT.zoom;
    expect(localX * next.zoom + next.panX).toBeCloseTo(point.x);
    expect(localY * next.zoom + next.panY).toBeCloseTo(point.y);
  });

  it("returns a zoomed photo to fit on the next click", () => {
    const zoomed = clickPhotoZoom(PHOTO_ZOOM_FIT, 40, 10, 8);
    expect(clickPhotoZoom(zoomed, 0, 0, 8)).toEqual(PHOTO_ZOOM_FIT);
  });

  it("fits large photos down and leaves small photos at their natural size", () => {
    expect(fittedPhotoSize({ width: 800, height: 600 }, { width: 4000, height: 3000 })).toEqual({
      width: 800,
      height: 600,
    });
    expect(fittedPhotoSize({ width: 800, height: 600 }, { width: 200, height: 100 })).toEqual({
      width: 200,
      height: 100,
    });
  });

  it("stops at fit and at the smaller of natural resolution and 8x", () => {
    expect(
      maxPhotoZoom({
        naturalWidth: 4000,
        naturalHeight: 3000,
        fitWidth: 400,
        fitHeight: 300,
        devicePixelRatio: 1,
      }),
    ).toBe(8);
    expect(
      maxPhotoZoom({
        naturalWidth: 800,
        naturalHeight: 600,
        fitWidth: 400,
        fitHeight: 300,
        devicePixelRatio: 1,
      }),
    ).toBe(2);
    expect(
      maxPhotoZoom({
        naturalWidth: 400,
        naturalHeight: 300,
        fitWidth: 400,
        fitHeight: 300,
        devicePixelRatio: 1,
      }),
    ).toBe(1);
    expect(
      maxPhotoZoom({
        naturalWidth: 800,
        naturalHeight: 600,
        fitWidth: 400,
        fitHeight: 300,
        devicePixelRatio: 2,
      }),
    ).toBe(1);
    const capped = zoomAboutPoint(PHOTO_ZOOM_FIT, 20, 0, 0, 3);
    expect(capped.zoom).toBe(3);
    expect(zoomAboutPoint({ zoom: 2, panX: 10, panY: 0 }, 0.2, 0, 0, 8)).toEqual(PHOTO_ZOOM_FIT);
    expect(clickPhotoZoom(PHOTO_ZOOM_FIT, 10, 10, 1)).toEqual(PHOTO_ZOOM_FIT);
  });

  it("clamps panning so the photo cannot leave the screen", () => {
    const parked = clampPhotoPan({ zoom: 2, panX: 10_000, panY: -10_000 }, stage, fit);
    expect(parked.zoom).toBe(2);
    const halfImageX = (fit.width * 2) / 2;
    const halfStageX = stage.width / 2;
    expect(parked.panX + halfImageX).toBeGreaterThan(-halfStageX);
    expect(parked.panX - halfImageX).toBeLessThan(halfStageX);
    expect(parked.panX).toBeLessThan(10_000);
    expect(parked.panY).toBeGreaterThan(-10_000);
    expect(clampPhotoPan({ zoom: 1, panX: 40, panY: 20 }, stage, fit)).toEqual(PHOTO_ZOOM_FIT);
  });

  it("keeps zoom when the signed URL changes for the same photo", () => {
    const viewing = { zoom: 2.5, panX: 30, panY: -12 };
    expect(photoZoomAfterSourceChange(viewing, "media-1", "media-1")).toEqual(viewing);
    expect(photoZoomAfterSourceChange(viewing, "media-1", "media-2")).toEqual(PHOTO_ZOOM_FIT);
  });

  it("keeps the centered detail in place across a counter-clockwise rotation", () => {
    const state = { zoom: 2, panX: 80, panY: -20 };
    const localX = -state.panX / state.zoom;
    const localY = -state.panY / state.zoom;
    const turned = photoPanAfterQuarterTurnCcw(state);
    const rotatedX = localY;
    const rotatedY = -localX;
    expect(rotatedX * turned.zoom + turned.panX).toBeCloseTo(0);
    expect(rotatedY * turned.zoom + turned.panY).toBeCloseTo(0);
    expect(turned.zoom).toBe(state.zoom);
  });
});
