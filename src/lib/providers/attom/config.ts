import "server-only";

import { getEnv } from "@/lib/env";

/** ATTOM is optional — unset `ATTOM_API_KEY` to run RentCast-only (sunset cutover). */
export function isAttomConfigured(env = getEnv()): boolean {
  return Boolean(env.ATTOM_API_KEY?.trim());
}
