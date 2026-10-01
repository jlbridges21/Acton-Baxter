/** Private bucket. Public tour pages must use signed URLs, not object URLs. */
export const TOUR_PANORAMA_BUCKET = "tour-panoramas";

/** Bucket cap in migration 060. The project-wide Storage setting can be lower. */
export const TOUR_PANORAMA_MAX_BYTES = 200 * 1024 * 1024;

/** Wider than this needs a 4096-wide fallback or older Android draws a black sphere. */
export const TOUR_COMPAT_MAX_WIDTH = 4096;

export const TOUR_COMPAT_WIDTH = 4096;
export const TOUR_COMPAT_HEIGHT = 2048;
export const TOUR_COMPAT_JPEG_QUALITY = 0.85;

export const TOUR_THUMB_WIDTH = 800;
export const TOUR_THUMB_HEIGHT = 400;
export const TOUR_THUMB_JPEG_QUALITY = 0.85;

/**
 * Signed URL lifetime minted by the image proxy.
 * 12h = 43200s.
 */
export const TOUR_VIEWER_SIGNED_URL_SECONDS = 60 * 60 * 12;

/**
 * Browser and CDN may cache the proxy's 302 for this long.
 * Must stay below TOUR_VIEWER_SIGNED_URL_SECONDS so a cached redirect
 * cannot outlive the signed URL it points at.
 * 1h = 3600s. Remaining life at the end of the cache window:
 * 43200 - 3600 = 39600s (11 hours).
 */
export const TOUR_IMAGE_PROXY_MAX_AGE_SECONDS = 60 * 60;

/** Public tour HTML. Same 1h window as the proxy redirect. The HTML stores proxy URLs, not signed URLs. */
export const TOUR_PAGE_REVALIDATE_SECONDS = TOUR_IMAGE_PROXY_MAX_AGE_SECONDS;

export const TOUR_UPLOAD_CONCURRENCY = 3;

export const EQUIRECT_RATIO = 2;
export const EQUIRECT_TOLERANCE = 0.03;
