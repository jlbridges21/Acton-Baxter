import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";

export type GhlAuditStatus =
  | "planned"
  | "pending_approval"
  | "proposed"
  | "confirmed"
  | "executing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired"
  | "stale";

export type GhlAuditEntry = {
  id: string;
  actorUserId: string | null;
  conversationId: string | null;
  pendingActionId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  status: GhlAuditStatus;
  errorCode: string | null;
  metadata: Record<string, unknown>;
  channel: string | null;
  externalUserId: string | null;
  proposedAt: string | null;
  confirmedAt: string | null;
  executedAt: string | null;
  createdAt: string;
};

export type RecordAuditInput = {
  actorUserId?: string | null;
  conversationId?: string | null;
  pendingActionId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  status: GhlAuditStatus;
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
  channel?: string | null;
  externalUserId?: string | null;
  proposedAt?: string | null;
  confirmedAt?: string | null;
  executedAt?: string | null;
};

/**
 * Record an action audit entry.
 */
export async function recordActionAudit(input: RecordAuditInput): Promise<void> {
  const supabase = await createServiceClient();

  const { error } = await supabase.from("ghl_action_audit").insert({
    actor_user_id: input.actorUserId || null,
    conversation_id: input.conversationId || null,
    pending_action_id: input.pendingActionId || null,
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId || null,
    before_state: input.beforeState || null,
    after_state: input.afterState || null,
    status: input.status,
    error_code: input.errorCode || null,
    metadata: input.metadata || {},
    channel: input.channel || null,
    external_user_id: input.externalUserId || null,
    proposed_at: input.proposedAt || null,
    confirmed_at: input.confirmedAt || null,
    executed_at: input.executedAt || null,
  });

  if (error) {
    console.error("Failed to record GHL action audit:", error);
  }
}

/**
 * Get recent audit entries for admin review.
 */
export async function getRecentAuditEntries(options?: {
  limit?: number;
  resourceType?: string;
  status?: GhlAuditStatus;
}): Promise<GhlAuditEntry[]> {
  const supabase = await createServiceClient();

  let query = supabase
    .from("ghl_action_audit")
    .select()
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 50);

  if (options?.resourceType) {
    query = query.eq("resource_type", options.resourceType);
  }

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    actorUserId: row.actor_user_id,
    conversationId: row.conversation_id,
    pendingActionId: row.pending_action_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    beforeState: row.before_state,
    afterState: row.after_state,
    status: row.status,
    errorCode: row.error_code,
    metadata: row.metadata,
    channel: row.channel,
    externalUserId: row.external_user_id,
    proposedAt: row.proposed_at,
    confirmedAt: row.confirmed_at,
    executedAt: row.executed_at,
    createdAt: row.created_at,
  }));
}

/**
 * Get audit trail for a specific resource.
 */
export async function getResourceAuditTrail(
  resourceType: string,
  resourceId: string,
  limit?: number,
): Promise<GhlAuditEntry[]> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("ghl_action_audit")
    .select()
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .order("created_at", { ascending: false })
    .limit(limit ?? 20);

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    actorUserId: row.actor_user_id,
    conversationId: row.conversation_id,
    pendingActionId: row.pending_action_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    beforeState: row.before_state,
    afterState: row.after_state,
    status: row.status,
    errorCode: row.error_code,
    metadata: row.metadata,
    channel: row.channel,
    externalUserId: row.external_user_id,
    proposedAt: row.proposed_at,
    confirmedAt: row.confirmed_at,
    executedAt: row.executed_at,
    createdAt: row.created_at,
  }));
}

/**
 * Get audit entries for a pending action.
 */
export async function getAuditEntriesForAction(pendingActionId: string): Promise<GhlAuditEntry[]> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("ghl_action_audit")
    .select()
    .eq("pending_action_id", pendingActionId)
    .order("created_at", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    actorUserId: row.actor_user_id,
    conversationId: row.conversation_id,
    pendingActionId: row.pending_action_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    beforeState: row.before_state,
    afterState: row.after_state,
    status: row.status,
    errorCode: row.error_code,
    metadata: row.metadata,
    channel: row.channel,
    externalUserId: row.external_user_id,
    proposedAt: row.proposed_at,
    confirmedAt: row.confirmed_at,
    executedAt: row.executed_at,
    createdAt: row.created_at,
  }));
}
