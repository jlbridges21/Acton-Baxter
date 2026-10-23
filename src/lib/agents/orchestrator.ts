/**
 * Baxter → specialist orchestration. Shared by web chat, Slack, direct agent chat,
 * and the Admin Studio sandbox so every channel runs the same routing, permission,
 * and execution path.
 *
 * Backward compatibility: if anything fails BEFORE a specialist is chosen (for example
 * the AI Workforce migration has not been applied yet), Baxter answers exactly as it
 * did before. Once a specialist is chosen, failures are reported honestly instead of
 * letting Baxter improvise an HR answer.
 */

import "server-only";

import { loadProfileSafe } from "./profiles";
import { createHash } from "node:crypto";
import { isAppAccessRole } from "@/lib/auth/roles";
import { getPublicAppBaseUrl } from "@/lib/slack/config";
import type { BaxterSourceReference } from "@/lib/baxter-ai/types";
import { recordAudit } from "./audit";
import { executeSpecialistTask, type ExecutionOutcome } from "./executor";
import { getAgentAccess } from "./permissions";
import { getOrchestrator, listDelegationTargets } from "./registry";
import { routeRequest, type RoutingDecision } from "./router";
import { createTask } from "./tasks";
import type { Requester, ResolvedAgent, SpecialistResult, TaskRow, TaskStatus } from "./types";

export type DelegationTrace = {
  taskId: string;
  agentSlug: string;
  agentName: string;
  agentTitle: string;
  avatarUrl: string | null;
  status: TaskStatus;
  outcome: SpecialistResult["outcome"] | null;
  method: RoutingDecision["method"];
  explanation: string;
  pendingApprovals: number;
  /** Reports Dexter created or changed for this request (verified by the tools). */
  reports: Array<{ id: string; title: string; url: string }>;
};

export type DelegationResult =
  | { handled: false; routing: RoutingDecision | null }
  | {
      handled: true;
      answer: string;
      sources: BaxterSourceReference[];
      confidence: "high" | "medium" | "low";
      insufficientKnowledge: boolean;
      delegation: DelegationTrace | null;
      /** grounded = cited approved documents; error = hand-off failed; clarification = denied or redirected. */
      answerMode: "grounded" | "general" | "clarification" | "error";
      modelProvider: string | null;
      modelName: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
    };

export type DelegationRequest = {
  question: string;
  channel: "web" | "slack";
  userId: string | null;
  userName: string | null;
  conversationId: string;
  /** Unique per user message — makes retries of the same message idempotent. */
  messageId: string;
  slackUserId?: string | null;
  slackTeamId?: string | null;
  slackIsDirectMessage?: boolean;
  /** Where to post a follow-up if the work finishes in the background. */
  slackChannelId?: string | null;
  slackThreadTs?: string | null;
  /** Recent turns of the conversation, so a specialist can resolve follow-ups. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

/** Bounded transcript excerpt handed to a specialist (most recent turns, trimmed). */
export function conversationExcerpt(
  history: Array<{ role: "user" | "assistant"; content: string }> | undefined,
  maxChars = 4000,
): string | undefined {
  if (!history?.length) return undefined;
  const lines: string[] = [];
  let used = 0;
  for (const turn of [...history].reverse().slice(0, 8)) {
    const line = `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content.replace(/\s+/g, " ").slice(0, 800)}`;
    if (used + line.length > maxChars) break;
    lines.unshift(line);
    used += line.length;
  }
  return lines.length ? lines.join("\n") : undefined;
}

const REGISTRY_BACKOFF_MS = 60_000;
let registryUnavailableUntil = 0;

export function resetDelegationBackoffForTests(): void {
  registryUnavailableUntil = 0;
}

export function delegationKillSwitchActive(): boolean {
  return (process.env.AI_WORKFORCE_DELEGATION_ENABLED ?? "true").toLowerCase() === "false";
}

async function requesterFromProfileId(
  userId: string,
  verifiedVia: Requester["verifiedVia"],
  fallbackLabel: string,
): Promise<Requester> {
  const profile = await loadProfileSafe(userId);
  if (!profile || !isAppAccessRole(profile.role)) {
    return {
      userId,
      role: null,
      departmentId: null,
      label: fallbackLabel,
      verifiedVia: "unverified",
    };
  }
  return {
    userId: profile.id,
    role: profile.role,
    departmentId: profile.department_id ?? null,
    label: profile.full_name || fallbackLabel,
    verifiedVia,
  };
}

/** Web: the session user. Slack: only a verified Slack→Baxter mapping (never a display name). */
export async function resolveRequester(input: DelegationRequest): Promise<Requester> {
  const label = input.userName ?? "Employee";
  if (input.channel === "web" && input.userId) {
    return requesterFromProfileId(input.userId, "web_session", label);
  }
  if (input.channel === "slack" && input.slackUserId && input.slackTeamId) {
    const { resolveBaxterUserForSlackIdentity } = await import("@/lib/slack/identity");
    const match = await resolveBaxterUserForSlackIdentity({
      slackUserId: input.slackUserId,
      slackTeamId: input.slackTeamId,
    }).catch(() => null);
    if (match)
      return requesterFromProfileId(match.userId, "slack_mapping", match.displayName ?? label);
  }
  return { userId: null, role: null, departmentId: null, label, verifiedVia: "unverified" };
}

function appUrl(path: string, channel: "web" | "slack"): string {
  return channel === "slack" ? `${getPublicAppBaseUrl().replace(/\/$/, "")}${path}` : path;
}

function plain(
  handled: Omit<Extract<DelegationResult, { handled: true }>, "handled">,
): DelegationResult {
  return { handled: true, ...handled };
}

function trace(
  agent: ResolvedAgent,
  task: TaskRow,
  routing: RoutingDecision,
  result: SpecialistResult | null,
): DelegationTrace {
  return {
    taskId: task.id,
    agentSlug: agent.row.slug,
    agentName: agent.row.display_name,
    agentTitle: agent.department?.name ?? agent.row.title,
    avatarUrl: agent.row.avatar_url,
    status: task.status,
    outcome: result?.outcome ?? null,
    method: routing.method,
    explanation: routing.explanation,
    pendingApprovals: result?.proposedActions.filter((a) => a.approvalId).length ?? 0,
    reports: (result?.artifacts ?? []).map((a) => ({ id: a.id, title: a.title, url: a.url })),
  };
}

/** Baxter's deterministic review of the specialist's structured result, rendered for the employee. */
export function composeBaxterReply(input: {
  agent: ResolvedAgent;
  result: SpecialistResult;
  channel: "web" | "slack";
  remainder: string | null;
}): string {
  const { agent, result } = input;
  const who = `${agent.row.display_name} (${agent.department?.name ?? agent.row.title})`;
  const lines: string[] = [
    `I assigned this to ${who}. Here's what ${agent.row.display_name} found:`,
    "",
    result.summary.trim(),
  ];
  if (result.findings.length && !result.summary.includes(result.findings[0]!.slice(0, 40))) {
    lines.push("", ...result.findings.slice(0, 6).map((f) => `• ${f}`));
  }
  if (result.nextSteps.length) {
    lines.push("", "Next steps:", ...result.nextSteps.slice(0, 6).map((s, i) => `${i + 1}. ${s}`));
  }
  if (result.missingInformation.length) {
    lines.push(
      "",
      "Missing information:",
      ...result.missingInformation.slice(0, 5).map((m) => `• ${m}`),
    );
  }
  for (const artifact of result.artifacts) {
    lines.push("", `Open the report "${artifact.title}": ${appUrl(artifact.url, input.channel)}`);
  }
  const approvals = result.proposedActions.filter((a) => a.approvalId).length;
  if (approvals > 0) {
    lines.push(
      "",
      `${approvals === 1 ? "A draft was" : `${approvals} items were`} saved for human review — nothing has been sent. Review it in Approvals: ${appUrl("/ai/approvals", input.channel)}`,
    );
  }
  if (result.requiresHumanReview || result.outcome === "needs_review") {
    lines.push("", "This needs review by a qualified person before anyone acts on it.");
  }
  if (input.remainder) {
    lines.push(
      "",
      `You also asked: “${input.remainder}”. Ask me that on its own and I'll answer it directly.`,
    );
  }
  return lines.join("\n").trim();
}

function sourcesFrom(result: SpecialistResult, channel: "web" | "slack"): BaxterSourceReference[] {
  const reports: BaxterSourceReference[] = result.artifacts.map((a, index) => ({
    title: a.title,
    sourceName: "Reports",
    category: "Saved report",
    sourceUrl: appUrl(a.url, channel),
    citationLabel: a.title,
    sourceKind: "capability" as const,
    openLabel: "Open report",
    lastUpdated: null,
    relevanceScore: 100 - index,
    availability: "available" as const,
    knowledgeEntryId: `report-${a.id}`,
  }));
  return [
    ...reports,
    // BambooHR (and future external systems): attributed with record type and freshness.
    ...result.sources
      .filter((s) => s.provider === "bamboohr")
      .map((s, index) => ({
        title: s.title,
        sourceName: "BambooHR",
        category: s.recordType ?? "Employee record",
        sourceUrl: appUrl(
          s.recordId
            ? `/ai/operations?tab=employees&employee=${encodeURIComponent(s.recordId)}`
            : "/ai/operations?tab=employees",
          channel,
        ),
        citationLabel: `BambooHR — ${s.recordType ?? "Employee record"}`,
        sourceKind: "bamboohr" as const,
        openLabel: "Open in Sam Operations",
        lastUpdated: s.retrievedAt ?? null,
        relevanceScore: 100 - index,
        availability: "available" as const,
        knowledgeEntryId: `bamboohr-${s.recordType ?? "record"}-${s.recordId ?? index}`,
        recordType: s.recordType ?? null,
        freshness: s.freshness ?? null,
      })),
    ...result.sources
      .filter((s) => s.provider !== "bamboohr")
      .map((s, index) => ({
        title: s.title,
        sourceName: "AI Knowledge Hub",
        category: "Approved HR / admin document",
        sourceUrl: s.documentId
          ? appUrl(`/ai/knowledge?document=${s.documentId}`, channel)
          : appUrl("/ai/onboarding", channel),
        citationLabel: s.title,
        sourceKind: "agent_knowledge" as const,
        openLabel: "Open in AI Workspace",
        lastUpdated: null,
        relevanceScore: 100 - index,
        availability: "available" as const,
        knowledgeEntryId: s.documentId ? `agent-doc-${s.documentId}` : `agent-source-${index}`,
      })),
  ];
}

function failureReply(
  agent: ResolvedAgent,
  outcome: Extract<ExecutionOutcome, { ok: false }>,
  channel: "web" | "slack",
): string {
  const name = agent.row.display_name;
  if (outcome.code === "RETRY_SCHEDULED") {
    const followUp =
      channel === "slack"
        ? "I'll post the result in this thread when it's ready."
        : `You can follow it in Tasks: ${appUrl(`/ai/tasks/${outcome.task?.id ?? ""}`, channel)}`;
    return `I assigned this to ${name}. ${name} needs a little more time and is still working on it in the background. ${followUp}`;
  }
  if (outcome.code === "NOT_AUTHORIZED")
    return `This request needs ${name}, but you don't have access to ${name}. An administrator can grant access in the AI Workspace.`;
  if (outcome.code === "PROVIDER_NOT_CONFIGURED")
    return `I tried to assign this to ${name}, but ${name}'s AI provider isn't configured on this deployment. Please let an administrator know.`;
  return `I assigned this to ${name}, but the assignment failed (${outcome.code}). Nothing was changed. Please try again, or ask an administrator to check the task in the AI Workspace.`;
}

/**
 * Called by Baxter for every routable message. Returns handled:false when Baxter should
 * continue with its normal answer pipeline.
 */
export async function maybeDelegateBaxterRequest(
  input: DelegationRequest,
): Promise<DelegationResult> {
  if (delegationKillSwitchActive()) return { handled: false, routing: null };
  if (Date.now() < registryUnavailableUntil) return { handled: false, routing: null };

  let orchestrator: ResolvedAgent | null;
  let targets: ResolvedAgent[];
  let routing: RoutingDecision;
  try {
    orchestrator = await getOrchestrator();
    if (!orchestrator) return { handled: false, routing: null };
    targets = await listDelegationTargets(orchestrator.row.id);
    if (targets.length === 0) return { handled: false, routing: null };
    routing = await routeRequest({ question: input.question, orchestrator, targets });
  } catch (error) {
    // Back off briefly (e.g. migration not applied yet) so Baxter isn't slowed on every message.
    registryUnavailableUntil = Date.now() + REGISTRY_BACKOFF_MS;
    console.error("[agents.delegation.routing_unavailable]", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { handled: false, routing: null };
  }
  if (!routing.target) return { handled: false, routing };
  const agent = routing.target;
  try {
    return await delegateToTarget(input, orchestrator, agent, routing);
  } catch (error) {
    // A specialist was chosen; report the failure rather than letting Baxter improvise.
    console.error("[agents.delegation.failed]", {
      agent: agent.row.slug,
      error: error instanceof Error ? error.message : String(error),
    });
    return plain({
      answer: `I tried to hand this to ${agent.row.display_name}, but the AI Workspace ran into a problem. Nothing was changed — please try again shortly.`,
      sources: [],
      confidence: "low",
      insufficientKnowledge: true,
      delegation: null,
      answerMode: "error",
      modelProvider: "agents",
      modelName: "error",
      inputTokens: null,
      outputTokens: null,
    });
  }
}

async function delegateToTarget(
  input: DelegationRequest,
  orchestrator: ResolvedAgent,
  agent: ResolvedAgent,
  routing: RoutingDecision,
): Promise<DelegationResult> {
  const requester = await resolveRequester(input);
  const deny = (answer: string): DelegationResult =>
    plain({
      answer,
      sources: [],
      confidence: "high",
      insufficientKnowledge: false,
      delegation: null,
      answerMode: "clarification",
      modelProvider: "agents",
      modelName: "authorization",
      inputTokens: null,
      outputTokens: null,
    });

  if (requester.verifiedVia === "unverified") {
    await recordAudit({
      actor: { userId: null, label: requester.label },
      action: "authorization.denied",
      targetType: "agent",
      targetId: agent.row.id,
      summary: `Unverified ${input.channel} user asked for ${agent.row.display_name}.`,
      details: { channel: input.channel },
    });
    return deny(
      input.channel === "slack"
        ? `That sounds like a question for ${agent.row.display_name}, our ${agent.row.title}. I couldn't match your Slack account to an approved Baxter account, so I can't share ${agent.row.display_name}'s information here. Sign in to Baxter on the web with your Acton email, or ask an administrator to link your account.`
        : `That sounds like a question for ${agent.row.display_name}, but I couldn't verify your access.`,
    );
  }

  const access = await getAgentAccess(requester, agent);
  if (!access.has("use_via_baxter")) {
    await recordAudit({
      actor: { userId: requester.userId, label: requester.label },
      action: "authorization.denied",
      targetType: "agent",
      targetId: agent.row.id,
      summary: `${requester.label} asked for ${agent.row.display_name} without access.`,
      details: { channel: input.channel },
    });
    return deny(
      `That's a question for ${agent.row.display_name}, our ${agent.row.title}, and your account doesn't have access to ${agent.row.display_name} yet. Please contact an administrator if you need it.`,
    );
  }

  const publicSlack = input.channel === "slack" && !input.slackIsDirectMessage;
  if (publicSlack && !agent.config.delegation.allowPublicChannelResults) {
    return deny(
      `That's a question for ${agent.row.display_name}, our ${agent.row.title}. To keep HR information private, please send it to me in a direct message.`,
    );
  }

  const specialistRequest = routing.specialistRequest || input.question;
  const { task } = await createTask({
    idempotencyKey: `baxter:${input.channel}:${input.messageId}`,
    initiatingUserId: requester.userId,
    initiatingUserLabel: requester.label,
    channel: input.channel,
    conversationId: input.conversationId,
    assigningAgentId: orchestrator.row.id,
    assignedAgentId: agent.row.id,
    configVersionId: agent.versionId,
    taskType: "delegated_request",
    title: specialistRequest.slice(0, 120),
    instructions: specialistRequest,
    delegationDepth: 1,
    routing: {
      method: routing.method,
      confidence: routing.confidence,
      explanation: routing.explanation,
      aiUsed: routing.aiUsed,
      aiError: routing.aiError,
    },
    allowedContext: {
      requester: {
        userId: requester.userId,
        label: requester.label,
        verifiedVia: requester.verifiedVia,
      },
      channel: input.channel,
      slackDirectMessage: Boolean(input.slackIsDirectMessage),
      ...(conversationExcerpt(input.history)
        ? { conversation: conversationExcerpt(input.history) }
        : {}),
    },
    sensitivity: agent.config.delegation.sensitivity,
    maxAttempts: 3,
  });
  await recordAudit({
    actor: { userId: requester.userId, label: requester.label },
    action: "task.delegated",
    targetType: "task",
    targetId: task.id,
    summary: `Baxter delegated a request to ${agent.row.display_name} (${routing.method}).`,
    details: { agentId: agent.row.id, channel: input.channel },
  });

  const outcome = await executeSpecialistTask(task.id, {
    requester,
    // Slack's handler stops waiting at 55s; leave room to post the reply.
    timeoutCapMs: input.channel === "slack" ? 40_000 : 120_000,
  });

  if (!outcome.ok) {
    if (outcome.code === "RETRY_SCHEDULED" && outcome.task) {
      const { enqueueAgentTaskJob } = await import("./jobs");
      await enqueueAgentTaskJob(outcome.task.id, {
        delaySeconds: 20,
        slackTarget:
          input.channel === "slack" && input.slackChannelId
            ? { channelId: input.slackChannelId, threadTs: input.slackThreadTs ?? null }
            : null,
      }).catch(() => undefined);
    }
    const failedTask = outcome.task ?? task;
    return plain({
      answer: failureReply(agent, outcome, input.channel),
      sources: [],
      confidence: "low",
      insufficientKnowledge: true,
      delegation: trace(agent, failedTask, routing, null),
      answerMode: "error",
      modelProvider: failedTask.model_provider,
      modelName: failedTask.model_name,
      inputTokens: failedTask.input_tokens || null,
      outputTokens: failedTask.output_tokens || null,
    });
  }

  const answer = composeBaxterReply({
    agent,
    result: outcome.result,
    channel: input.channel,
    remainder: routing.remainder,
  });
  return plain({
    answer,
    sources: sourcesFrom(outcome.result, input.channel),
    confidence:
      outcome.result.outcome === "answered"
        ? "high"
        : outcome.result.outcome === "partial"
          ? "medium"
          : "low",
    insufficientKnowledge: outcome.result.outcome === "missing_information",
    delegation: trace(agent, outcome.task, routing, outcome.result),
    answerMode: outcome.result.sources.length ? "grounded" : "general",
    modelProvider: outcome.task.model_provider,
    modelName: outcome.task.model_name,
    inputTokens: outcome.task.input_tokens,
    outputTokens: outcome.task.output_tokens,
  });
}

/** Direct chat with a specialist from the AI Workspace (requires direct_chat access). */
export async function runDirectAgentRequest(input: {
  agent: ResolvedAgent;
  requester: Requester;
  question: string;
  requestId: string;
  /** Extra context for the specialist (e.g. the report being viewed and recent chat turns). */
  context?: {
    reportId?: string | null;
    conversation?: string;
    session?: string;
    attachments?: string;
    focus?: string;
  };
}): Promise<{ outcome: ExecutionOutcome; task: TaskRow }> {
  const { task } = await createTask({
    idempotencyKey: `direct:${input.requester.userId}:${input.requestId}`,
    initiatingUserId: input.requester.userId,
    initiatingUserLabel: input.requester.label,
    channel: "direct",
    assigningAgentId: null,
    assignedAgentId: input.agent.row.id,
    configVersionId: input.agent.versionId,
    taskType: "direct_request",
    title: input.question.slice(0, 120),
    instructions: input.question,
    delegationDepth: 0,
    routing: { method: "direct" },
    allowedContext: {
      requester: {
        userId: input.requester.userId,
        label: input.requester.label,
        verifiedVia: input.requester.verifiedVia,
      },
      channel: "direct",
      ...(input.context?.reportId ? { reportId: input.context.reportId } : {}),
      ...(input.context?.conversation ? { conversation: input.context.conversation } : {}),
      ...(input.context?.session ? { session: input.context.session } : {}),
      ...(input.context?.attachments ? { attachments: input.context.attachments } : {}),
      ...(input.context?.focus ? { focus: input.context.focus } : {}),
    },
    sensitivity: input.agent.config.delegation.sensitivity,
  });
  const outcome = await executeSpecialistTask(task.id, { requester: input.requester });
  return { outcome, task: outcome.task ?? task };
}

export function hashQuestion(question: string): string {
  return createHash("sha256").update(question).digest("hex").slice(0, 16);
}
