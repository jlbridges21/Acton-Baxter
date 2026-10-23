/**
 * Admin quality view for Baxter's organization routing:
 *   - an intent check: the first turn of every evaluation case run through the interpreter
 *     against the LIVE registry (pure — no model calls, no CRM, no delegation), and
 *   - aggregate routing traces from recent conversations (strategy / intent / agent / latency
 *     only — never message content or the trace's free-text reason, which can quote the question).
 * The full end-to-end evaluation (tests/unit/baxter-org-eval.test.ts) runs in CI.
 */

import "server-only";

import { getOrgDirectory } from "./directory";
import { interpretOrgRequest, type OrgIntentKind } from "./intent";
import {
  ORG_EVAL_CASES,
  ORG_EVAL_HELDOUT,
  ORG_EVAL_HELDOUT_2,
  type ExpectedRoute,
} from "./org-eval";

const ROUTE_FOR_KIND: Record<OrgIntentKind, ExpectedRoute> = {
  agent_info: "registry",
  agent_can_help: "registry",
  agent_status: "registry",
  org_roster: "registry",
  capability_inventory: "registry",
  agent_task: "delegate",
  clarify: "clarify",
  none: "crm",
};

export type IntentCheck = {
  set: string;
  id: string;
  question: string;
  expected: ExpectedRoute;
  actual: ExpectedRoute;
  agent: string | null;
  pass: boolean;
};

export type OrgQuality = {
  checks: IntentCheck[];
  traces: {
    total: number;
    byStrategy: Record<string, number>;
    byIntent: Record<string, number>;
    byAgent: Record<string, number>;
    medianLatencyMs: number | null;
    recent: Array<{
      createdAt: string;
      strategy: string;
      intent: string;
      agent: string | null;
      latencyMs: number | null;
    }>;
  };
};

export async function getOrgQuality(): Promise<OrgQuality> {
  const directory = await getOrgDirectory();
  const sets = [
    ["main", ORG_EVAL_CASES],
    ["held-out 1", ORG_EVAL_HELDOUT],
    ["held-out 2", ORG_EVAL_HELDOUT_2],
  ] as const;
  const checks: IntentCheck[] = [];
  for (const [set, cases] of sets) {
    for (const c of cases) {
      const turn = c.turns[0]!;
      // "pipeline" / "crm" both mean "not handled by the org layer" at the intent level.
      const expected = turn.route === "pipeline" ? "crm" : turn.route;
      const intent = interpretOrgRequest({ question: turn.question, history: [], directory });
      const actual = ROUTE_FOR_KIND[intent.kind];
      const agentOk =
        !turn.agent ||
        expected === "crm" ||
        intent.agent?.slug === turn.agent ||
        intent.kind === "org_roster";
      checks.push({
        set,
        id: c.id,
        question: turn.question,
        expected,
        actual,
        agent: intent.agent?.slug ?? null,
        pass: actual === expected && agentOk,
      });
    }
  }

  const { listRecentRoutingTraces } = await import("@/lib/baxter-ai/conversations");
  const rows = await listRecentRoutingTraces(200).catch(() => []);
  const count = (key: string) =>
    rows.reduce<Record<string, number>>((acc, r) => {
      const v = String(r.routing[key] ?? "none");
      acc[v] = (acc[v] ?? 0) + 1;
      return acc;
    }, {});
  const latencies = rows
    .map((r) => Number(r.routing.latencyMs))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  return {
    checks,
    traces: {
      total: rows.length,
      byStrategy: count("strategy"),
      byIntent: count("intent"),
      byAgent: count("agent"),
      medianLatencyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)]! : null,
      recent: rows.slice(0, 25).map((r) => ({
        createdAt: r.createdAt,
        strategy: String(r.routing.strategy ?? ""),
        intent: String(r.routing.intent ?? ""),
        agent: typeof r.routing.agent === "string" ? r.routing.agent : null,
        latencyMs: Number.isFinite(Number(r.routing.latencyMs))
          ? Number(r.routing.latencyMs)
          : null,
      })),
    },
  };
}
