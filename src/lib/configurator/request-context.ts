/**
 * Small helpers for the public configurator routes.
 */

import "server-only";

import { isAdminRole } from "@/lib/auth/roles";
import { getOptionalUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { RateLimitError } from "@/lib/errors";

/** Draft preview is only honored for signed-in Baxter admins. */
export async function isAdminPreview(requested: boolean): Promise<boolean> {
  if (!requested) return false;
  const user = await getOptionalUser().catch(() => null);
  return Boolean(user && isAdminRole(user.profile.role));
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export function enforceRateLimit(
  request: Request,
  bucket: string,
  limit: number,
  windowMs = 60_000,
): void {
  const result = checkRateLimit(`configurator:${bucket}:${clientIp(request)}`, { limit, windowMs });
  if (!result.allowed) throw new RateLimitError();
}
