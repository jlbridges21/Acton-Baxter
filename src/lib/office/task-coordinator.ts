/**
 * Turns authoritative task state into office animation cues.
 *
 * Two outputs:
 *  - a persistent *mode* per agent, straight from ai_agent_runtime_status (working,
 *    waiting on a specialist, failed, …), and
 *  - one-shot *events* for delegations (hand-off, result) derived from task rows.
 *
 * Events are de-duplicated per task and phase, ignore stale or out-of-order snapshots, and
 * are seeded from the first snapshot so a page refresh never replays history. Nothing here
 * creates, delays, or modifies tasks; the office only animates what was recorded.
 */

export type DelegationSnapshot = {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type OfficeEvent =
  | { type: "handoff"; taskId: string; fromAgentId: string; toAgentId: string }
  | {
      type: "result";
      taskId: string;
      fromAgentId: string;
      toAgentId: string;
      outcome: "completed" | "failed" | "cancelled";
    };

export type AgentMode = "ambient" | "receiving" | "working" | "waiting" | "approval" | "failed";

type Handled = { rank: number; handoff?: true; result?: true };

export type CoordinatorState = {
  handled: Record<string, Handled>;
  lastServerTime: number;
};

/** Older hand-offs/results are shown as state, not replayed as fresh animations. */
export const EVENT_FRESH_MS = 2 * 60_000;

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const ACTIVE_LINK = new Set(["queued", "running", "awaiting_approval"]);

export function statusRank(status: string): number {
  if (TERMINAL.has(status)) return 2;
  if (status === "queued") return 0;
  return 1; // running, awaiting_approval
}

export function modeFromRuntime(state: string | undefined | null): AgentMode {
  switch (state) {
    case "working":
      return "working";
    case "receiving":
      return "receiving";
    case "awaiting_result":
      return "waiting";
    case "awaiting_approval":
      return "approval";
    case "failed":
    case "blocked":
      return "failed";
    default:
      return "ambient";
  }
}

/** Marks everything already visible at page load as handled (no replays after refresh). */
export function seedCoordinator(
  delegations: DelegationSnapshot[],
  serverTime: string,
): CoordinatorState {
  const handled: Record<string, Handled> = {};
  for (const d of delegations) {
    const rank = statusRank(d.status);
    handled[d.id] = { rank, handoff: true, ...(rank === 2 ? { result: true as const } : {}) };
  }
  return { handled, lastServerTime: Date.parse(serverTime) || 0 };
}

export function reconcile(
  state: CoordinatorState,
  input: { delegations: DelegationSnapshot[]; serverTime: string },
): { state: CoordinatorState; events: OfficeEvent[] } {
  const serverNow = Date.parse(input.serverTime) || 0;
  // A slower poll can land after a newer Realtime-triggered refresh; ignore it.
  if (serverNow < state.lastServerTime) return { state, events: [] };
  const handled = { ...state.handled };
  const events: OfficeEvent[] = [];
  const ordered = [...input.delegations].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  for (const d of ordered) {
    const rank = statusRank(d.status);
    const prev = handled[d.id];
    if (prev && rank < prev.rank) continue; // out-of-order (older) status for this task
    const next: Handled = { ...prev, rank };
    const base = { taskId: d.id, fromAgentId: d.fromAgentId, toAgentId: d.toAgentId };
    if (rank < 2 && !next.handoff) {
      next.handoff = true;
      if (serverNow - Date.parse(d.createdAt) < EVENT_FRESH_MS)
        events.push({ type: "handoff", ...base });
    }
    if (rank === 2 && !next.result) {
      // Finished before we ever saw it running (a very fast task): no walk, just the result.
      next.handoff = true;
      next.result = true;
      const finished = Date.parse(d.completedAt ?? d.createdAt);
      if (serverNow - finished < EVENT_FRESH_MS) {
        events.push({
          type: "result",
          ...base,
          outcome: d.status as "completed" | "failed" | "cancelled",
        });
      }
    }
    handled[d.id] = next;
  }
  return { state: { handled, lastServerTime: serverNow }, events };
}

/** Delegations that are genuinely in flight right now (for the collaboration link). */
export function activeDelegations(delegations: DelegationSnapshot[]): DelegationSnapshot[] {
  return delegations.filter((d) => ACTIVE_LINK.has(d.status));
}
