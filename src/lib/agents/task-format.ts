/** Shapes task rows for the browser (only ever called after visibility checks). */

import type { TaskRow } from "./types";

export function taskSummary(t: TaskRow) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    channel: t.channel,
    taskType: t.task_type,
    assignedAgentId: t.assigned_agent_id,
    assigningAgentId: t.assigning_agent_id,
    initiatingUserLabel: t.initiating_user_label,
    outcome: t.result?.outcome ?? null,
    errorCode: t.error_code,
    approvalState: t.approval_state,
    model: t.model_name,
    provider: t.model_provider,
    inputTokens: t.input_tokens,
    outputTokens: t.output_tokens,
    costUsd: Number(t.estimated_cost_usd) || 0,
    sensitivity: t.sensitivity,
    attempts: t.attempts,
    createdAt: t.created_at,
    startedAt: t.started_at,
    completedAt: t.completed_at,
  };
}

export type TaskSummary = ReturnType<typeof taskSummary>;
