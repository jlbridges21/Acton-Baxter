/**
 * The floating Dexter chat on Reports. Messages are stored per user and per report;
 * Dexter runs as a direct specialist request with the current report id and the recent
 * conversation as (data-only) context. Report changes come back as platform-verified
 * artifacts, never as text the model claims.
 */

import "server-only";

import { AuthorizationError } from "@/lib/errors";
import { requireAgentAccess, type AiContext } from "@/lib/agents/http";
import { runDirectAgentRequest } from "@/lib/agents/orchestrator";
import { listTaskEvents } from "@/lib/agents/tasks";
import { agentDb, eq } from "@/lib/agents/store";
import type { SpecialistResult, TaskRow } from "@/lib/agents/types";
import { DEXTER_SLUG, type ReportsAccess } from "./access";
import { appendChatMessage, listChatMessages, loadReportFor, type ChatMessageRow } from "./repo";

export type ChatMessageView = {
  id: string;
  role: "user" | "dexter";
  content: string;
  createdAt: string;
  artifacts: SpecialistResult["artifacts"];
  outcome: string | null;
  failed: boolean;
};

export function toChatView(m: ChatMessageRow): ChatMessageView {
  const meta = m.metadata ?? {};
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.created_at,
    artifacts: Array.isArray(meta.artifacts)
      ? (meta.artifacts as SpecialistResult["artifacts"])
      : [],
    outcome: typeof meta.outcome === "string" ? meta.outcome : null,
    failed: meta.failed === true,
  };
}

export function conversationFrom(messages: ChatMessageRow[]): string | undefined {
  const lines = messages
    .slice(-10)
    .map(
      (m) =>
        `${m.role === "user" ? "User" : "Dexter"}: ${m.content.replace(/\s+/g, " ").slice(0, 700)}`,
    );
  return lines.length ? lines.join("\n") : undefined;
}

function replyText(result: SpecialistResult): string {
  const parts = [result.summary];
  if (result.findings.length) parts.push(result.findings.map((f) => `• ${f}`).join("\n"));
  if (result.missingInformation.length)
    parts.push(`Missing: ${result.missingInformation.join("; ")}`);
  if (result.nextSteps.length) parts.push(`Next: ${result.nextSteps.join("; ")}`);
  return parts.join("\n\n");
}

export async function sendDexterMessage(input: {
  ctx: AiContext;
  access: ReportsAccess;
  reportId: string | null;
  message: string;
  requestId: string;
}): Promise<{ user: ChatMessageView; reply: ChatMessageView; taskId: string }> {
  if (!input.access.canChat) {
    throw new AuthorizationError(
      "You can view reports, but chatting with Dexter needs “Chat directly” access. An administrator can grant it on Dexter's Access tab.",
    );
  }
  const userId = input.ctx.user.id;
  let reportTitle: string | null = null;
  if (input.reportId) {
    const { report } = await loadReportFor(input.reportId, input.ctx.requester, input.access);
    reportTitle = report.title;
  }
  const agent = await requireAgentAccess(input.ctx, DEXTER_SLUG, "direct_chat");
  const history = await listChatMessages(userId, input.reportId, 20);
  const userMessage = await appendChatMessage({
    report_id: input.reportId,
    user_id: userId,
    role: "user",
    content: input.message,
    task_id: null,
    metadata: { requestId: input.requestId },
  });
  const question = reportTitle
    ? `[Viewing report "${reportTitle}"]\n${input.message}`
    : input.message;
  const { outcome, task } = await runDirectAgentRequest({
    agent,
    requester: input.ctx.requester,
    question,
    requestId: input.requestId,
    context: { reportId: input.reportId, conversation: conversationFrom(history) },
  });
  const reply = await appendChatMessage({
    // A report Dexter just created owns the conversation from here on.
    report_id: input.reportId ?? (outcome.ok ? (outcome.result.artifacts[0]?.id ?? null) : null),
    user_id: userId,
    role: "dexter",
    content: outcome.ok
      ? replyText(outcome.result)
      : friendlyFailure(outcome.code, outcome.message),
    task_id: task.id,
    metadata: outcome.ok
      ? {
          outcome: outcome.result.outcome,
          artifacts: outcome.result.artifacts,
          requestId: input.requestId,
        }
      : { failed: true, code: outcome.code, requestId: input.requestId },
  });
  if (!input.reportId && outcome.ok && outcome.result.artifacts[0]) {
    await agentDb().update("bi_report_chat_messages", [eq("id", userMessage.id)], {
      report_id: outcome.result.artifacts[0].id,
    });
  }
  return { user: toChatView(userMessage), reply: toChatView(reply), taskId: task.id };
}

function friendlyFailure(code: string, message: string): string {
  if (code === "RETRY_SCHEDULED")
    return "I hit a temporary problem and couldn't finish. Please try again in a moment.";
  if (code === "TIMEOUT" || code === "LIMIT_EXCEEDED")
    return "That took longer than I'm allowed for one request. Try asking for a smaller change.";
  if (code === "AGENT_DISABLED" || code === "AGENT_PAUSED")
    return "I'm turned off right now. An administrator can re-enable me in AI Studio.";
  return `I couldn't finish that (${message.slice(0, 160)}).`;
}

/** Live progress for an in-flight request: the task's status and its tool steps so far. */
export async function chatProgress(userId: string, requestId: string) {
  const [task] = await agentDb().select<TaskRow>("ai_tasks", {
    filters: [eq("idempotency_key", `direct:${userId}:${requestId}`)],
    limit: 1,
  });
  if (!task) return { status: "starting" as const, steps: [] as string[] };
  const events = await listTaskEvents(task.id);
  return {
    status: task.status,
    steps: events
      .filter((e) => e.event_type === "tool_call" || e.event_type === "tool_error")
      .map((e) => e.message)
      .slice(-8),
  };
}
