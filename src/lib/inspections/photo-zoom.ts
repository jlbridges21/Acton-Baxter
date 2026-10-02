/**
 * Photo zoom for the site inspection viewer.
 *
 * Zoom is a multiplier on the fitted image: 1 shows the whole photo.
 * The maximum is the image's natural resolution (one source pixel per device
 * pixel) or 8× fit, whichever is smaller, so the viewer never scales into blur.
 *
 * Screen position of an image point, relative to the stage center:
 *   visual = local * zoom + pan
 * with translate-then-scale around the image center (scale applied first).
 */

/** Same movement that the tour editor treats as a drag rather than a click. */
export const PHOTO_PAN_DRAG_THRESHOLD_PX = 5;

export const PHOTO_SWIPE_THRESHOLD_PX = 50;

export const PHOTO_ZOOM_MAX_FACTOR = 8;

/** First click from fit lands here, unless the photo cannot go that far. */
export const PHOTO_ZOOM_CLICK_FACTOR = 2;

export const PHOTO_ZOOM_STEP = 0.5;

const FIT_EPSILON = 1e-3;

export type PhotoZoom = {
  zoom: number;
  panX: number;
  panY: number;
};

export const PHOTO_ZOOM_FIT: PhotoZoom = { zoom: 1, panX: 0, panY: 0 };

export type PhotoZoomSize = {
  width: number;
  height: number;
};

export function isPhotoZoomed(zoom: number): boolean {
  return zoom > 1 + FIT_EPSILON;
}

/** object-contain box: the photo's on-screen size at fit, never upscaled. */
export function fittedPhotoSize(viewport: PhotoZoomSize, natural: PhotoZoomSize): PhotoZoomSize {
  if (natural.width <= 0 || natural.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(viewport.width / natural.width, viewport.height / natural.height, 1);
  return { width: natural.width * scale, height: natural.height * scale };
}

export function isPhotoPanDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= PHOTO_PAN_DRAG_THRESHOLD_PX;
}

/** Natural resolution on this screen, capped at 8× the fitted size. Never below fit. */
export function maxPhotoZoom(input: {
  naturalWidth: number;
  naturalHeight: number;
  fitWidth: number;
  fitHeight: number;
  devicePixelRatio?: number;
}): number {
  const dpr = input.devicePixelRatio && input.devicePixelRatio > 0 ? input.devicePixelRatio : 1;
  if (
    input.fitWidth <= 0 ||
    input.fitHeight <= 0 ||
    input.naturalWidth <= 0 ||
    input.naturalHeight <= 0
  ) {
    return 1;
  }
  const toNatural = Math.min(
    input.naturalWidth / (input.fitWidth * dpr),
    input.naturalHeight / (input.fitHeight * dpr),
  );
  return clamp(Math.min(PHOTO_ZOOM_MAX_FACTOR, toNatural), 1, PHOTO_ZOOM_MAX_FACTOR);
}

/**
 * Change zoom while keeping one stage-center-relative point fixed.
 * `point` is the cursor (or pinch midpoint) relative to the stage center.
 */
export function zoomAboutPoint(
  state: PhotoZoom,
  nextZoom: number,
  pointX: number,
  pointY: number,
  maxZoom: number,
): PhotoZoom {
  const zoom = clamp(nextZoom, 1, Math.max(1, maxZoom));
  if (!isPhotoZoomed(zoom)) return PHOTO_ZOOM_FIT;
  const ratio = state.zoom === 0 ? 1 : zoom / state.zoom;
  return {
    zoom,
    panX: pointX * (1 - ratio) + state.panX * ratio,
    panY: pointY * (1 - ratio) + state.panY * ratio,
  };
}

/** Click at fit zooms in on that point. Click while zoomed returns to fit. */
export function clickPhotoZoom(
  state: PhotoZoom,
  pointX: number,
  pointY: number,
  maxZoom: number,
): PhotoZoom {
  if (isPhotoZoomed(state.zoom)) return PHOTO_ZOOM_FIT;
  const target = Math.min(Math.max(1, maxZoom), PHOTO_ZOOM_CLICK_FACTOR);
  if (!isPhotoZoomed(target)) return PHOTO_ZOOM_FIT;
  return zoomAboutPoint(state, target, pointX, pointY, maxZoom);
}

/**
 * Keep a sliver of the photo on screen. At fit there is nothing to pan.
 * `pan` is the image center relative to the stage center, in CSS pixels.
 */
export function clampPhotoPan(
  state: PhotoZoom,
  viewport: PhotoZoomSize,
  fit: PhotoZoomSize,
  minVisiblePx = 48,
): PhotoZoom {
  const zoom = state.zoom;
  if (!isPhotoZoomed(zoom)) return PHOTO_ZOOM_FIT;
  if (viewport.width <= 0 || viewport.height <= 0 || fit.width <= 0 || fit.height <= 0) {
    return state;
  }
  const halfImageX = (fit.width * zoom) / 2;
  const halfImageY = (fit.height * zoom) / 2;
  const halfStageX = viewport.width / 2;
  const halfStageY = viewport.height / 2;
  const marginX = Math.min(minVisiblePx, halfImageX, halfStageX);
  const marginY = Math.min(minVisiblePx, halfImageY, halfStageY);
  return {
    zoom,
    panX: clamp(state.panX, -halfStageX - halfImageX + marginX, halfStageX + halfImageX - marginX),
    panY: clamp(state.panY, -halfStageY - halfImageY + marginY, halfStageY + halfImageY - marginY),
  };
}

/** A signed-URL refresh remounts the image but must not drop the view. */
export function photoZoomAfterSourceChange(
  state: PhotoZoom,
  previousMediaId: string,
  nextMediaId: string,
): PhotoZoom {
  if (previousMediaId === nextMediaId) return state;
  return PHOTO_ZOOM_FIT;
}

/**
 * 90° counter-clockwise, matching the rotate control.
 * The image point under the stage center stays under the stage center.
 * Screen y grows downward, so CCW maps local (x, y) to (y, -x).
 */
export function photoPanAfterQuarterTurnCcw(state: PhotoZoom): PhotoZoom {
  return { zoom: state.zoom, panX: state.panY, panY: -state.panX };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
