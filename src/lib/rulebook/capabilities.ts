import "server-only";

/**
 * Capability checks for Process Rulebook.
 * Sync claim uses a process-local cache warmed by evidence retrieval / admin paths.
 */

import { getActiveRulebook } from "./versions";

let knownActive: boolean | null = null;

/** Sync: true only after noteActiveRulebookPresence(true). */
export function isActiveRulebookKnown(): boolean {
  return knownActive === true;
}

export function noteActiveRulebookPresence(active: boolean): void {
  knownActive = active;
}

/** Test helper */
export function resetRulebookCapabilityCacheForTests(): void {
  knownActive = null;
}

/**
 * Check if there is an active rulebook version (DB).
 * Also updates the sync capability cache.
 */
export async function hasActiveRulebook(): Promise<boolean> {
  try {
    const active = await getActiveRulebook();
    const present = active !== null;
    noteActiveRulebookPresence(present);
    return present;
  } catch (error) {
    console.error("Error checking for active rulebook:", error);
    noteActiveRulebookPresence(false);
    return false;
  }
}
