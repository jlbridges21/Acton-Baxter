/** Public and embed pages are cached for an hour, so a write must invalidate them. */
export function publishedTourPaths(slug: string): string[] {
  return [`/tour/${slug}`, `/embed/${slug}`];
}

/**
 * The previous save path. Revalidating the open editor route makes this Next.js
 * version refresh that page immediately, and the client refreshed it again.
 */
export function editorTourPaths(tourId: string, slug: string): string[] {
  return ["/tours", `/tours/${tourId}`, `/tours/${tourId}/preview`, ...publishedTourPaths(slug)];
}
