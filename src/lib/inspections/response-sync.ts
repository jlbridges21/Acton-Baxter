/**
 * Field-runner response autosave flush.
 *
 * Local optimistic state is authoritative while the inspector is editing.
 * Server PATCH responses are persistence acks only — never rehydrate checklist
 * fields from them (that caused stale-write races under rapid toggles).
 */

import {
  clearPendingResponseIfUnchanged,
  listPendingResponses,
  type PendingResponsePatch,
} from "./client-autosave";

export type ResponseSaveResult = "saved" | "pending" | "error";

export type ResponseSaveBody = {
  snapshotItemId: string;
  isComplete?: boolean;
  notes?: string;
  answers?: PendingResponsePatch["answers"];
};

/**
 * Only drop a queued patch when nothing newer was coalesced while the request
 * was in flight. A newer `updatedAt` means the user edited again — keep it.
 */
export function shouldClearPendingAfterAck(
  queuedUpdatedAt: string | undefined,
  sentUpdatedAt: string,
): boolean {
  return queuedUpdatedAt === sentUpdatedAt;
}

/**
 * Flush localStorage-backed pending patches with per-item coalesce + supersede.
 * Does not return or apply server inspection payloads — callers must not rewrite
 * local responses from the ack.
 */
export async function flushPendingResponses(options: {
  inspectionId: string;
  saveItem: (body: ResponseSaveBody) => Promise<void>;
}): Promise<ResponseSaveResult> {
  let guard = 0;

  while (guard++ < 50) {
    const pending = listPendingResponses(options.inspectionId);
    if (!pending.length) return "saved";

    let madeNetworkProgress = false;

    for (const seed of pending) {
      const latest = listPendingResponses(options.inspectionId).find(
        (p) => p.snapshotItemId === seed.snapshotItemId,
      );
      if (!latest) continue;

      const body: ResponseSaveBody = {
        snapshotItemId: latest.snapshotItemId,
      };
      if (latest.isComplete !== undefined) body.isComplete = latest.isComplete;
      if (latest.notes !== undefined) body.notes = latest.notes;
      if (latest.answers !== undefined) body.answers = latest.answers;

      const sentUpdatedAt = latest.updatedAt;
      try {
        await options.saveItem(body);
        madeNetworkProgress = true;
        clearPendingResponseIfUnchanged(options.inspectionId, latest.snapshotItemId, sentUpdatedAt);
      } catch {
        return "pending";
      }
    }

    if (!listPendingResponses(options.inspectionId).length) return "saved";
    if (!madeNetworkProgress) return "pending";
    // Newer edits superseded cleared acks — loop to send the latest revisions.
  }

  return listPendingResponses(options.inspectionId).length ? "pending" : "saved";
}
