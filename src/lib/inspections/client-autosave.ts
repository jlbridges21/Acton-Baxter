/**
 * Client-side pending response queue for autosave under flaky connections.
 * Persists to localStorage first, then syncs to the server.
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
    isComplete: patch.isComplete ?? prev?.isComplete,
    notes: patch.notes !== undefined ? patch.notes : prev?.notes,
    answers: patch.answers ? { ...(prev?.answers ?? {}), ...patch.answers } : prev?.answers,
    updatedAt: patch.updatedAt,
  };
  writeQueue(inspectionId, queue);
}

export function listPendingResponses(inspectionId: string): PendingResponsePatch[] {
  return Object.values(readQueue(inspectionId));
}

export function clearPendingResponse(inspectionId: string, snapshotItemId: string) {
  const queue = readQueue(inspectionId);
  delete queue[snapshotItemId];
  writeQueue(inspectionId, queue);
}

export function clearAllPendingResponses(inspectionId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(keyFor(inspectionId));
}
