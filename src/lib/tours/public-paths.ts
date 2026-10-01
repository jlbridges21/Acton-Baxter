/** `/tours` stays authenticated. `/tour/` and `/embed/` do not. */
export function isAnonymousTourPath(pathname: string): boolean {
  return (
    pathname.startsWith("/tour/") ||
    pathname.startsWith("/embed/") ||
    pathname.startsWith("/api/tours/")
  );
}
