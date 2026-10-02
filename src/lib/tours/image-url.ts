export type TourImageVariant = "full" | "compat" | "thumb" | "edit";

/** Stable same-origin URL. The proxy mints the signed URL. */
export function tourImageUrl(slug: string, sceneId: string, variant: TourImageVariant): string {
  return `/api/tours/${encodeURIComponent(slug)}/image/${encodeURIComponent(sceneId)}?variant=${variant}`;
}
