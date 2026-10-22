/**
 * Admin Studio test tools: delegation tester, routing regression suite, and sandbox runs.
 * Sandbox runs execute for real (real model, real retrieval) but never save drafts or
 * approvals, and are labelled "sandbox" in task history.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { getConfigState } from "./admin";
import { executeSpecialistTask, type ExecutionOutcome } from "./executor";
import { resolveAccessLevels, loadAccessPolicies } from "./permissions";
import {
  getOrchestrator,
  getResolvedAgent,
  listDelegationTargets,
  listResolvedAgents,
} from "./registry";
import { routeRequest, type RoutingDecision } from "./router";
import { createTask } from "./tasks";
import type { Requester, ResolvedAgent, TaskRow } from "./types";

export type RoutingTestResult = {
  question: string;
  expected: string | null;
  actual: string;
  passed: boolean | null;
  method: RoutingDecision["method"];
  explanation: string;
  scores: RoutingDecision["scores"];
  aiUsed: boolean;
  authorization: { allowed: boolean; reason: string } | null;
};

export async function testRouting(input: {
  question: string;
  expectedSlug: string | null;
  simulateAs: Requester | null;
  useAi: boolean;
  /** Test a specialist's unpublished draft delegation settings. */
  draftOverrideFor?: string | null;
}): Promise<RoutingTestResult> {
  const orchestrator = await getOrchestrator();
  if (!orchestrator) throw new Error("No active orchestrator agent.");
  let targets = await listDelegationTargets(orchestrator.row.id);
  if (input.draftOverrideFor) {
    targets = await Promise.all(
      targets.map((t) => (t.row.slug === input.draftOverrideFor ? withDraftConfig(t) : t)),
    );
  }
  const routing = await routeRequest({
    question: input.question,
    orchestrator,
    targets,
    rulesOnly: !input.useAi,
  });
  const actual = routing.target?.row.slug ?? orchestrator.row.slug;
  let authorization: RoutingTestResult["authorization"] = null;
  if (routing.target && input.simulateAs) {
    const levels = resolveAccessLevels(
      input.simulateAs,
      await loadAccessPolicies(routing.target.row.id),
    );
    authorization = levels.has("use_via_baxter")
      ? {
          allowed: true,
          reason: `${input.simulateAs.label} may use ${routing.target.row.display_name} through Baxter.`,
        }
      : {
          allowed: false,
          reason: `${input.simulateAs.label} would be politely denied — no access to ${routing.target.row.display_name}.`,
        };
  }
  return {
    question: input.question,
    expected: input.expectedSlug,
    actual,
    passed: input.expectedSlug ? input.expectedSlug === actual : null,
    method: routing.method,
    explanation: routing.explanation,
    scores: routing.scores,
    aiUsed: routing.aiUsed,
    authorization,
  };
}

export async function withDraftConfig(agent: ResolvedAgent): Promise<ResolvedAgent> {
  const { draft } = await getConfigState(agent.row.id);
  return draft
    ? { ...agent, config: draft.parsed, versionId: draft.id, versionNumber: draft.version_number }
    : agent;
}

/**
 * Regression suite: every specialist's positive examples must route to it and every
 * negative example must stay with Baxter. Rules-only by default (no model cost).
 */
export async function runRoutingRegression(options: {
  useAi: boolean;
  draftOverrideFor?: string | null;
}) {
  const orchestrator = await getOrchestrator();
  if (!orchestrator) throw new Error("No active orchestrator agent.");
  const agents = await listResolvedAgents();
  let targets = agents.filter(
    (a) =>
      a.row.kind === "specialist" &&
      a.row.status === "active" &&
      a.config.delegation.acceptsDelegation,
  );
  if (options.draftOverrideFor) {
    targets = await Promise.all(
      targets.map((t) => (t.row.slug === options.draftOverrideFor ? withDraftConfig(t) : t)),
    );
  }
  const cases = targets.flatMap((t) => [
    ...t.config.delegation.positiveExamples.map((q) => ({ question: q, expected: t.row.slug })),
    ...t.config.delegation.negativeExamples.map((q) => ({
      question: q,
      expected: orchestrator.row.slug,
    })),
  ]);
  const results: RoutingTestResult[] = [];
  for (const c of cases) {
    const routing = await routeRequest({
      question: c.question,
      orchestrator,
      targets,
      rulesOnly: !options.useAi,
    });
    const actual = routing.target?.row.slug ?? orchestrator.row.slug;
    results.push({
      question: c.question,
      expected: c.expected,
      actual,
      passed: actual === c.expected,
      method: routing.method,
      explanation: routing.explanation,
      scores: routing.scores,
      aiUsed: routing.aiUsed,
      authorization: null,
    });
  }
  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    results,
  };
}

/** Run a specialist for real against its draft (or published) config, saving nothing but the task log. */
export async function runSandbox(input: {
  agentSlug: string;
  question: string;
  actor: Requester;
  useDraft: boolean;
}): Promise<{ outcome: ExecutionOutcome; task: TaskRow; usedDraft: boolean }> {
  const agent = await getResolvedAgent(input.agentSlug, { fresh: true });
  if (!agent) throw new Error("Agent not found");
  const target = input.useDraft ? await withDraftConfig(agent) : agent;
  const usedDraft = target.versionId !== agent.versionId;
  const runnable: ResolvedAgent = { ...target, row: { ...target.row, status: "active" } };
  const { task } = await createTask({
    idempotencyKey: `sandbox:${randomUUID()}`,
    initiatingUserId: input.actor.userId,
    initiatingUserLabel: input.actor.label,
    channel: "sandbox",
    assigningAgentId: null,
    assignedAgentId: agent.row.id,
    configVersionId: target.versionId,
    taskType: "sandbox_test",
    title: `Test: ${input.question.slice(0, 100)}`,
    instructions: input.question,
    delegationDepth: 0,
    routing: { method: "sandbox", usedDraft },
    allowedContext: {
      requester: {
        userId: input.actor.userId,
        label: input.actor.label,
        verifiedVia: input.actor.verifiedVia,
      },
    },
    sensitivity: agent.config.delegation.sensitivity,
    maxAttempts: 1,
  });
  if (!runnable.versionId) throw new Error("This agent has no configuration to test yet.");
  const outcome = await executeSpecialistTask(task.id, {
    requester: input.actor,
    agentOverride: runnable,
  });
  return { outcome, task: outcome.task ?? task, usedDraft };
}
