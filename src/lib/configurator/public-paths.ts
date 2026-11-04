/**
 * The customer configurator is public. `/configurator` (admin workspace) stays authenticated.
 * Kept free of imports so middleware and tests can use it.
 */
export function isAnonymousConfiguratorPath(pathname: string): boolean {
  return (
    pathname === "/design" ||
    pathname.startsWith("/design/") ||
    pathname.startsWith("/api/public/configurator/")
  );
}

/** Host that will serve the customer configurator at its root once DNS points here. */
export function configuratorPublicHost(): string {
  return (process.env.CONFIGURATOR_PUBLIC_HOST || "design.actonadu.com").toLowerCase();
}

export function isConfiguratorHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return host.toLowerCase().split(":")[0] === configuratorPublicHost();
}
