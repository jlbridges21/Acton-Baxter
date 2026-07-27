import "server-only";

export type GhlActionType =
  | "update_contact_fields"
  | "add_contact_tag"
  | "remove_contact_tag"
  | "update_opportunity"
  | "move_opportunity_stage";

export type GhlResourceType = "contact" | "opportunity";

export type GhlActionChannel = "web" | "slack" | "api";

export type GhlPendingActionStatus =
  | "pending"
  | "confirmed"
  | "executing"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled"
  | "stale";

export type GhlPendingAction = {
  id: string;
  userId: string | null;
  externalUserId: string | null;
  conversationId: string | null;
  channel: GhlActionChannel;
  actionType: GhlActionType;
  resourceType: GhlResourceType;
  resourceId: string;
  resourceName: string | null;
  beforeState: Record<string, unknown>;
  proposedChanges: Record<string, unknown>;
  status: GhlPendingActionStatus;
  expiresAt: string;
  createdAt: string;
  confirmedAt: string | null;
  executedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
};

export type GhlPendingActionRow = {
  id: string;
  user_id: string | null;
  external_user_id: string | null;
  conversation_id: string | null;
  channel: GhlActionChannel;
  action_type: GhlActionType;
  resource_type: GhlResourceType;
  resource_id: string;
  resource_name: string | null;
  before_state: Record<string, unknown>;
  proposed_changes: Record<string, unknown>;
  status: GhlPendingActionStatus;
  expires_at: string;
  created_at: string;
  confirmed_at: string | null;
  executed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
};

export type CreatePendingActionInput = {
  userId?: string | null;
  externalUserId?: string | null;
  conversationId?: string | null;
  channel: GhlActionChannel;
  actionType: GhlActionType;
  resourceType: GhlResourceType;
  resourceId: string;
  resourceName?: string | null;
  beforeState: Record<string, unknown>;
  proposedChanges: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type GhlActionResult = {
  success: boolean;
  actionId: string;
  resourceId: string;
  resourceType: GhlResourceType;
  actionType: GhlActionType;
  afterState?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
};

export type GhlWritePermission = {
  canWrite: boolean;
  reason?: string;
  allowedActions?: GhlActionType[];
  deniedActions?: GhlActionType[];
};

export function toGhlPendingAction(row: GhlPendingActionRow): GhlPendingAction {
  return {
    id: row.id,
    userId: row.user_id,
    externalUserId: row.external_user_id,
    conversationId: row.conversation_id,
    channel: row.channel,
    actionType: row.action_type,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    beforeState: row.before_state,
    proposedChanges: row.proposed_changes,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    executedAt: row.executed_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    metadata: row.metadata,
  };
}
