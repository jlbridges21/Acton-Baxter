/**
 * Baxter's organization-aware first stage, shared by Slack and web (called from
 * answerBaxterQuestion before delegation and before any CRM / knowledge search).
 *
 *   - Questions ABOUT agents, the AI team, or available tools → answered from the live Agent
 *     Registry (no specialist run, no external search).
 *   - Work FOR an agent → handed to delegation with pronouns resolved ("ask her…" → "ask Sam…").
 *   - A bare name that could be an agent or a person → one focused clarification question.
 *   - Everything else → unchanged pipeline.
 *
 * Kill switch: BAXTER_ORG_ROUTING=off restores the previous behaviour (used for baselines).
 */

import "server-only";

import type { BaxterSourceReference } from "@/lib/baxter-ai/types";
import { getOrgDirectory, type OrgDirectory } from "./directory";
import { interpretOrgRequest, type HistoryTurn, type OrgIntent } from "./intent";
import { composeOrgAnswer } from "./org-answers";
import type { DelegationRequest } from "./orchestrator";

export type RoutingTrace = {
  strategy: "registry" | "clarify" | "delegation" | "pipeline";
  intent: string;
  agent: string | null;
  reason: string;
  latencyMs: number;
};

export type OrgRoutingResult =
  | { handled: true; answer: string; sources: BaxterSourceReference[]; trace: RoutingTrace }
  | { handled: false; routingQuestion: string; trace: RoutingTrace; skipDelegation?: boolean };

/** Lookups here must never slow Baxter down: each is capped, and failures back off briefly. */
const LOOKUP_TIMEOUT_MS = 1_500;
const BACKOFF_MS = 60_000;
let unavailableUntil = 0;

function withTimeout<T>(p: Promise<T>, ms = LOOKUP_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** "Who is Sam?" / "what's sam" — the only shape where an employee sharing the name matters. */
const SHORT_WHO_IS = /^\s*(who('s| is)|what('s| is))\s+@?\S+\s*\??\s*$/i;

let peopleCache: { at: number; names: string[] } | null = null;
async function peopleFirstNames(): Promise<string[]> {
  if (peopleCache && Date.now() - peopleCache.at < 60_000) return peopleCache.names;
  try {
    const { getReportStore } = await import("@/lib/research/report-store");
    const names = (await withTimeout(getReportStore().listProfiles()))
      .map((p) => (p.full_name ?? "").trim().split(/\s+/)[0] ?? "")
      .filter((n) => n.length > 1);
    peopleCache = { at: Date.now(), names };
    return names;
  } catch {
    peopleCache = { at: Date.now(), names: [] }; // don't retry on every message
    return [];
  }
}
export function resetOrgRoutingCacheForTests() {
  peopleCache = null;
  unavailableUntil = 0;
}

export async function routeOrganizationRequest(
  input: Omit<DelegationRequest, "history"> & { history: HistoryTurn[] },
): Promise<OrgRoutingResult | null> {
  if ((process.env.BAXTER_ORG_ROUTING ?? "").toLowerCase() === "off") return null;
  if (Date.now() < unavailableUntil) return null;
  const started = Date.now();
  let directory: OrgDirectory;
  try {
    directory = await withTimeout(getOrgDirectory());
  } catch {
    unavailableUntil = Date.now() + BACKOFF_MS;
    return null; // registry unavailable → previous behaviour
  }
  const intent: OrgIntent = interpretOrgRequest({
    question: input.question,
    history: input.history,
    directory,
    peopleFirstNames: SHORT_WHO_IS.test(input.question) ? await peopleFirstNames() : [],
  });
  const trace = (strategy: RoutingTrace["strategy"]): RoutingTrace => ({
    strategy,
    intent: intent.kind,
    agent: intent.agent?.slug ?? null,
    reason: intent.reason,
    latencyMs: Date.now() - started,
  });

  if (intent.kind === "agent_task" || intent.kind === "none") {
    return {
      handled: false,
      routingQuestion: intent.resolvedQuestion,
      trace: trace(intent.kind === "agent_task" ? "delegation" : "pipeline"),
      ...(intent.recordReference ? { skipDelegation: true } : {}),
    };
  }
  const { resolveRequester } = await import("./orchestrator");
  const requester = await resolveRequester({ ...input, history: input.history });
  const { getPublicAppBaseUrl } = await import("@/lib/slack/config");
  const composed = await composeOrgAnswer({
    intent,
    directory,
    requester,
    channel: input.channel,
    baseUrl: getPublicAppBaseUrl(),
  });
  if (!composed.answer)
    return { handled: false, routingQuestion: intent.resolvedQuestion, trace: trace("pipeline") };
  return {
    handled: true,
    answer: composed.answer,
    sources: composed.sources,
    trace: trace(intent.kind === "clarify" ? "clarify" : "registry"),
  };
}
