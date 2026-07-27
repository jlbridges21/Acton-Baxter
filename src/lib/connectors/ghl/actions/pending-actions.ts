import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import type {
  GhlPendingAction,
  GhlPendingActionRow,
  GhlPendingActionStatus,
  CreatePendingActionInput,
} from "./types";
import { toGhlPendingAction } from "./types";

const DEFAULT_EXPIRY_MINUTES = 10;

/**
 * Create a pending action that requires user confirmation.
 */
export async function createPendingAction(
  input: CreatePendingActionInput,
): Promise<GhlPendingAction> {
  const supabase = await createServiceClient();

  const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_MINUTES * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("ghl_pending_actions")
    .insert({
      user_id: input.userId || null,
      external_user_id: input.externalUserId || null,
      conversation_id: input.conversationId || null,
      channel: input.channel,
      action_type: input.actionType,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      resource_name: input.resourceName || null,
      before_state: input.beforeState,
      proposed_changes: input.proposedChanges,
      status: "pending",
      expires_at: expiresAt,
      metadata: input.metadata || {},
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create pending action: ${error?.message}`);
  }

  return toGhlPendingAction(data as GhlPendingActionRow);
}

/**
 * Get a pending action by ID.
 */
export async function getPendingAction(actionId: string): Promise<GhlPendingAction | null> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("ghl_pending_actions")
    .select()
    .eq("id", actionId)
    .single();

  if (error || !data) {
    return null;
  }

  return toGhlPendingAction(data as GhlPendingActionRow);
}

/**
 * Get pending action for a conversation (most recent non-expired).
 */
export async function getPendingActionForConversation(
  conversationId: string,
): Promise<GhlPendingAction | null> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("ghl_pending_actions")
    .select()
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return toGhlPendingAction(data as GhlPendingActionRow);
}

/**
 * List pending actions for a user.
 */
export async function listPendingActionsForUser(
  userId: string,
  options?: { includeExpired?: boolean; limit?: number },
): Promise<GhlPendingAction[]> {
  const supabase = await createServiceClient();

  let query = supabase
    .from("ghl_pending_actions")
    .select()
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 20);

  if (!options?.includeExpired) {
    query = query.in("status", ["pending", "confirmed", "executing"]);
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  return data.map((row) => toGhlPendingAction(row as GhlPendingActionRow));
}

/**
 * Update pending action status.
 */
export async function updatePendingActionStatus(
  actionId: string,
  status: GhlPendingActionStatus,
  additionalFields?: Partial<{
    confirmedAt: string;
    executedAt: string;
    errorCode: string;
    errorMessage: string;
  }>,
): Promise<GhlPendingAction | null> {
  const supabase = await createServiceClient();

  const updates: Record<string, unknown> = {
    status,
  };

  if (additionalFields?.confirmedAt) {
    updates.confirmed_at = additionalFields.confirmedAt;
  }
  if (additionalFields?.executedAt) {
    updates.executed_at = additionalFields.executedAt;
  }
  if (additionalFields?.errorCode) {
    updates.error_code = additionalFields.errorCode;
  }
  if (additionalFields?.errorMessage) {
    updates.error_message = additionalFields.errorMessage;
  }

  const { data, error } = await supabase
    .from("ghl_pending_actions")
    .update(updates)
    .eq("id", actionId)
    .select()
    .single();

  if (error || !data) {
    return null;
  }

  return toGhlPendingAction(data as GhlPendingActionRow);
}

/**
 * Confirm a pending action (set status to confirmed).
 */
export async function confirmPendingAction(
  actionId: string,
): Promise<{ success: boolean; action?: GhlPendingAction; error?: string }> {
  const action = await getPendingAction(actionId);

  if (!action) {
    return { success: false, error: "Action not found" };
  }

  if (action.status !== "pending") {
    return { success: false, error: `Action is ${action.status}, not pending` };
  }

  if (new Date(action.expiresAt) < new Date()) {
    await updatePendingActionStatus(actionId, "expired");
    return { success: false, error: "Action has expired" };
  }

  const updated = await updatePendingActionStatus(actionId, "confirmed", {
    confirmedAt: new Date().toISOString(),
  });

  if (!updated) {
    return { success: false, error: "Failed to confirm action" };
  }

  return { success: true, action: updated };
}

/**
 * Cancel a pending action.
 */
export async function cancelPendingAction(
  actionId: string,
): Promise<{ success: boolean; error?: string }> {
  const action = await getPendingAction(actionId);

  if (!action) {
    return { success: false, error: "Action not found" };
  }

  if (action.status !== "pending") {
    return { success: false, error: `Action is ${action.status}, cannot cancel` };
  }

  await updatePendingActionStatus(actionId, "cancelled");
  return { success: true };
}

/**
 * Mark action as stale (resource changed since proposal).
 */
export async function markActionStale(actionId: string, reason: string): Promise<void> {
  await updatePendingActionStatus(actionId, "stale", {
    errorMessage: reason,
  });
}

/**
 * Clean up expired pending actions.
 */
export async function cleanupExpiredPendingActions(): Promise<number> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("ghl_pending_actions")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");

  if (error) {
    console.error("Failed to cleanup expired pending actions:", error);
    return 0;
  }

  return data?.length ?? 0;
}

/**
 * Check if there's already a pending action for the same resource.
 * Prevents duplicate pending actions for the same resource.
 */
export async function hasPendingActionForResource(
  resourceType: string,
  resourceId: string,
): Promise<boolean> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("ghl_pending_actions")
    .select("id")
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .limit(1);

  if (error) {
    return false;
  }

  return (data?.length ?? 0) > 0;
}

/**
 * Cancel all pending GHL actions for a conversation (e.g. on /clear).
 */
export async function cancelPendingActionsForConversation(conversationId: string): Promise<number> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("ghl_pending_actions")
    .update({
      status: "cancelled",
      error_code: "CANCELLED_ON_CLEAR",
      error_message: "Cancelled because the conversation was cleared",
    })
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    console.error("Failed to cancel pending actions on clear:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * Confirm a pending action only if it belongs to this conversation + actor.
 * Prevents cross-thread / cross-user confirmation.
 */
export async function getPendingActionForActor(input: {
  conversationId: string;
  userId?: string | null;
  externalUserId?: string | null;
}): Promise<GhlPendingAction | null> {
  const pending = await getPendingActionForConversation(input.conversationId);
  if (!pending) return null;

  if (input.userId && pending.userId && pending.userId !== input.userId) {
    return null;
  }
  if (
    input.externalUserId &&
    pending.externalUserId &&
    pending.externalUserId !== input.externalUserId
  ) {
    return null;
  }
  return pending;
}

/**
 * List recent pending actions across users (admin Actions tab).
 */
export async function listRecentPendingActions(options?: {
  limit?: number;
}): Promise<GhlPendingAction[]> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("ghl_pending_actions")
    .select()
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 30);

  if (error || !data) {
    return [];
  }
  return (data as GhlPendingActionRow[]).map(toGhlPendingAction);
}
