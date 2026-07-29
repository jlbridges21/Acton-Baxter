/**
 * PEM conversation continuity — pending clarification + active PEM selection.
 * Stored in baxter_conversations.metadata (no migration required).
 */

export type PemPendingSelection = {
  type: "pem_selection";
  originalQuestion: string;
  requestedFields: string[];
  candidatePemIds: string[];
  candidateLabels: string[];
  baseProspectHint: string | null;
};

export type PemActiveContext = {
  type: "pem_active";
  activePemId: string;
  activeProspectName: string;
  lastRequestedFields: string[];
  baseProspectHint: string | null;
};

export type PemConversationState = {
  pending: PemPendingSelection | null;
  active: PemActiveContext | null;
};

const META_KEY = "pemContext";

export function readPemConversationState(
  metadata: Record<string, unknown> | null | undefined,
): PemConversationState {
  const raw = metadata?.[META_KEY];
  if (!raw || typeof raw !== "object") {
    return { pending: null, active: null };
  }
  const o = raw as Record<string, unknown>;
  const pending =
    o.pending &&
    typeof o.pending === "object" &&
    (o.pending as { type?: string }).type === "pem_selection"
      ? (o.pending as PemPendingSelection)
      : null;
  const active =
    o.active &&
    typeof o.active === "object" &&
    (o.active as { type?: string }).type === "pem_active"
      ? (o.active as PemActiveContext)
      : null;
  return { pending, active };
}

export function writePemConversationState(
  metadata: Record<string, unknown> | null | undefined,
  state: PemConversationState,
): Record<string, unknown> {
  const next = { ...(metadata ?? {}) };
  if (!state.pending && !state.active) {
    delete next[META_KEY];
    return next;
  }
  next[META_KEY] = {
    pending: state.pending,
    active: state.active,
  };
  return next;
}

export function clearPemConversationState(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return writePemConversationState(metadata, { pending: null, active: null });
}

/** True when the user message looks like a PEM discriminator reply (e.g. "Test 8"). */
export function looksLikePemDiscriminatorReply(question: string): boolean {
  const q = question.trim();
  if (!q || q.length > 80) return false;
  if (/^(test|pem|neat|meeting|version|v|#)\s*[\w.-]+$/i.test(q)) return true;
  if (/^(use|try|pick|choose|go with|go back to)\s+/i.test(q) && q.split(/\s+/).length <= 8) {
    return true;
  }
  if (/^(the )?(first|second|latest|older|newer)( one)?$/i.test(q)) return true;
  return false;
}

export function extractDiscriminatorHint(question: string): string | null {
  const q = question.trim();
  const useMatch = q.match(/^(?:use|try|pick|choose|go with|go back to|actually use)\s+(.+)$/i);
  if (useMatch?.[1]) return useMatch[1].trim();

  const testMatch = q.match(/\b((?:test|pem|neat|meeting|version|v|#)\s*[\w.-]+)\b/i);
  if (testMatch?.[1]) return testMatch[1].trim();

  if (/^(the )?(first|second|latest|older|newer)( one)?$/i.test(q)) return q;

  // Bare "Test 8"
  if (/^[\w.-]+(?:\s+[\w.-]+){0,3}$/i.test(q) && q.split(/\s+/).length <= 4) {
    return q;
  }
  return null;
}
