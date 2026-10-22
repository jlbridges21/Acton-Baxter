/**
 * AI Workforce audit trail. Records who changed what — never document bodies,
 * HR record content, prompts, or secrets.
 */

import "server-only";

import { agentDb, eq, type Filter } from "./store";
import type { AuditRow } from "./types";

export type AuditActor = { userId: string | null; label: string | null };

export const SYSTEM_ACTOR: AuditActor = { userId: null, label: "System" };

export async function recordAudit(input: {
  actor: AuditActor;
  action: string;
  targetType: string;
  targetId?: string | null;
  summary: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await agentDb().insert("ai_audit_log", {
      actor_user_id: input.actor.userId,
      actor_label: input.actor.label,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId ?? null,
      summary: input.summary.slice(0, 500),
      details: input.details ?? {},
    });
  } catch (error) {
    // Auditing must never take down the action it records; surface in server logs.
    console.error("[agents.audit.failed]", {
      action: input.action,
      targetType: input.targetType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function listAudit(options: {
  targetType?: string;
  targetId?: string;
  limit?: number;
}): Promise<AuditRow[]> {
  const filters: Filter[] = [];
  if (options.targetType) filters.push(eq("target_type", options.targetType));
  if (options.targetId) filters.push(eq("target_id", options.targetId));
  return agentDb().select<AuditRow>("ai_audit_log", {
    filters,
    order: { col: "created_at", ascending: false },
    limit: options.limit ?? 50,
  });
}
