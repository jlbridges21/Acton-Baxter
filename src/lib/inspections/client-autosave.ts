/**
 * Client-side pending response queue for autosave under flaky connections.
 * Persists to localStorage first, then syncs to the server.
 *
 * Patches are per checklist item and merge field-level deltas (isComplete,
 * notes, individual answers) so concurrent edits coalesce instead of clobbering.
 */

export type PendingResponsePatch = {
  snapshotItemId: string;
  isComplete?: boolean;
  notes?: string;
  answers?: Record<string, { type: string; value: string | string[] | null }>;
  updatedAt: string;
};

const keyFor = (inspectionId: string) => `baxter.site-inspection.pending.${inspectionId}`;

function readQueue(inspectionId: string): Record<string, PendingResponsePatch> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(keyFor(inspectionId));
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, PendingResponsePatch>;
  } catch {
    return {};
  }
}

function writeQueue(inspectionId: string, queue: Record<string, PendingResponsePatch>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(keyFor(inspectionId), JSON.stringify(queue));
}

export function queuePendingResponse(inspectionId: string, patch: PendingResponsePatch) {
  const queue = readQueue(inspectionId);
  const prev = queue[patch.snapshotItemId];
  queue[patch.snapshotItemId] = {
    snapshotItemId: patch.snapshotItemId,
    isComplete: patch.isComplete !== undefined ? patch.isComplete : prev?.isComplete,
    notes: patch.notes !== undefined ? patch.notes : prev?.notes,
    answers: patch.answers ? { ...(prev?.answers ?? {}), ...patch.answers } : prev?.answers,
    updatedAt: patch.updatedAt,
  };
  writeQueue(inspectionId, queue);
}

export function listPendingResponses(inspectionId: string): PendingResponsePatch[] {
  return Object.values(readQueue(inspectionId));
}

export function getPendingResponse(
  inspectionId: string,
  snapshotItemId: string,
): PendingResponsePatch | undefined {
  return readQueue(inspectionId)[snapshotItemId];
}

export function clearPendingResponse(inspectionId: string, snapshotItemId: string) {
  const queue = readQueue(inspectionId);
  delete queue[snapshotItemId];
  writeQueue(inspectionId, queue);
}

/**
 * Clear only if the queued entry was not superseded while the request was in flight.
 * Returns true when the entry was removed.
 */
export function clearPendingResponseIfUnchanged(
  inspectionId: string,
  snapshotItemId: string,
  sentUpdatedAt: string,
): boolean {
  const queue = readQueue(inspectionId);
  const current = queue[snapshotItemId];
  if (!current) return false;
  if (current.updatedAt !== sentUpdatedAt) return false;
  delete queue[snapshotItemId];
  writeQueue(inspectionId, queue);
  return true;
}

export function clearAllPendingResponses(inspectionId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(keyFor(inspectionId));
}
