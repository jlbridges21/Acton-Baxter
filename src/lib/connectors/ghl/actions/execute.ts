import "server-only";

import { ghlPut, ghlPost, ghlDelete, ghlGet } from "../client";
import type { GhlPendingAction, GhlActionResult } from "./types";
import { getPendingAction, updatePendingActionStatus, markActionStale } from "./pending-actions";
import { recordActionAudit } from "./audit";
import { filterContactChanges, filterOpportunityChanges } from "./allowlist";

/**
 * Execute a confirmed pending action.
 * Actions are idempotent - executing an already completed action returns success.
 */
export async function executeAction(actionId: string): Promise<GhlActionResult> {
  const action = await getPendingAction(actionId);

  if (!action) {
    return {
      success: false,
      actionId,
      resourceId: "",
      resourceType: "contact",
      actionType: "update_contact_fields",
      errorCode: "ACTION_NOT_FOUND",
      errorMessage: "Action not found",
    };
  }

  // Idempotency: already completed actions return success
  if (action.status === "completed") {
    return {
      success: true,
      actionId,
      resourceId: action.resourceId,
      resourceType: action.resourceType,
      actionType: action.actionType,
    };
  }

  // Check if action is in a valid state for execution
  if (action.status !== "confirmed") {
    return {
      success: false,
      actionId,
      resourceId: action.resourceId,
      resourceType: action.resourceType,
      actionType: action.actionType,
      errorCode: "INVALID_STATUS",
      errorMessage: `Action is ${action.status}, expected confirmed`,
    };
  }

  // Check for expiration
  if (new Date(action.expiresAt) < new Date()) {
    await updatePendingActionStatus(actionId, "expired");
    return {
      success: false,
      actionId,
      resourceId: action.resourceId,
      resourceType: action.resourceType,
      actionType: action.actionType,
      errorCode: "BAXTER_GHL_ACTION_EXPIRED",
      errorMessage: "Action has expired",
    };
  }

  // Mark as executing
  await updatePendingActionStatus(actionId, "executing");

  try {
    // Pre-execution stale check
    const staleCheck = await checkForStaleState(action);
    if (staleCheck.isStale) {
      await markActionStale(actionId, staleCheck.reason || "Resource changed");
      await recordActionAudit({
        pendingActionId: actionId,
        action: action.actionType,
        resourceType: action.resourceType,
        resourceId: action.resourceId,
        status: "stale",
        errorCode: "BAXTER_GHL_STALE_STATE",
        metadata: { staleReason: staleCheck.reason },
      });
      return {
        success: false,
        actionId,
        resourceId: action.resourceId,
        resourceType: action.resourceType,
        actionType: action.actionType,
        errorCode: "BAXTER_GHL_STALE_STATE",
        errorMessage: staleCheck.reason || "Resource has been modified since proposal",
      };
    }

    // Execute based on action type
    let result: GhlActionResult;
    switch (action.actionType) {
      case "update_contact_fields":
        result = await executeUpdateContactFields(action);
        break;
      case "add_contact_tag":
        result = await executeAddContactTag(action);
        break;
      case "remove_contact_tag":
        result = await executeRemoveContactTag(action);
        break;
      case "update_opportunity":
        result = await executeUpdateOpportunity(action);
        break;
      case "move_opportunity_stage":
        result = await executeMoveOpportunityStage(action);
        break;
      default:
        result = {
          success: false,
          actionId,
          resourceId: action.resourceId,
          resourceType: action.resourceType,
          actionType: action.actionType,
          errorCode: "UNSUPPORTED_ACTION",
          errorMessage: `Action type ${action.actionType} is not supported`,
        };
    }

    // Update status based on result
    if (result.success) {
      await updatePendingActionStatus(actionId, "completed", {
        executedAt: new Date().toISOString(),
      });
      await recordActionAudit({
        pendingActionId: actionId,
        action: action.actionType,
        resourceType: action.resourceType,
        resourceId: action.resourceId,
        status: "succeeded",
        beforeState: action.beforeState,
        afterState: result.afterState,
      });
    } else {
      await updatePendingActionStatus(actionId, "failed", {
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
      await recordActionAudit({
        pendingActionId: actionId,
        action: action.actionType,
        resourceType: action.resourceType,
        resourceId: action.resourceId,
        status: "failed",
        errorCode: result.errorCode,
        metadata: { errorMessage: result.errorMessage },
      });
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Execution failed";
    await updatePendingActionStatus(actionId, "failed", {
      errorCode: "EXECUTION_ERROR",
      errorMessage,
    });
    await recordActionAudit({
      pendingActionId: actionId,
      action: action.actionType,
      resourceType: action.resourceType,
      resourceId: action.resourceId,
      status: "failed",
      errorCode: "EXECUTION_ERROR",
      metadata: { errorMessage },
    });
    return {
      success: false,
      actionId,
      resourceId: action.resourceId,
      resourceType: action.resourceType,
      actionType: action.actionType,
      errorCode: "EXECUTION_ERROR",
      errorMessage,
    };
  }
}

/**
 * Check if the resource has changed since the before_state was captured.
 */
async function checkForStaleState(
  action: GhlPendingAction,
): Promise<{ isStale: boolean; reason?: string }> {
  try {
    if (action.resourceType === "contact") {
      const current = await ghlGet<{ contact: Record<string, unknown> }>(
        `/contacts/${action.resourceId}`,
      );
      const currentUpdatedAt = current?.contact?.dateUpdated as string | undefined;
      const beforeUpdatedAt = action.beforeState?.dateUpdated as string | undefined;

      if (currentUpdatedAt && beforeUpdatedAt && currentUpdatedAt !== beforeUpdatedAt) {
        return {
          isStale: true,
          reason: `Contact was updated at ${currentUpdatedAt}, after proposal was created`,
        };
      }
    } else if (action.resourceType === "opportunity") {
      const current = await ghlGet<{ opportunity: Record<string, unknown> }>(
        `/opportunities/${action.resourceId}`,
      );
      const currentUpdatedAt = current?.opportunity?.dateUpdated as string | undefined;
      const beforeUpdatedAt = action.beforeState?.dateUpdated as string | undefined;

      if (currentUpdatedAt && beforeUpdatedAt && currentUpdatedAt !== beforeUpdatedAt) {
        return {
          isStale: true,
          reason: `Opportunity was updated at ${currentUpdatedAt}, after proposal was created`,
        };
      }
    }

    return { isStale: false };
  } catch {
    // If we can't fetch current state, proceed with execution
    return { isStale: false };
  }
}

async function executeUpdateContactFields(action: GhlPendingAction): Promise<GhlActionResult> {
  const { allowed, rejected } = filterContactChanges(action.proposedChanges);

  if (rejected.length > 0) {
    return {
      success: false,
      actionId: action.id,
      resourceId: action.resourceId,
      resourceType: "contact",
      actionType: "update_contact_fields",
      errorCode: "INVALID_FIELDS",
      errorMessage: `Fields not allowed: ${rejected.join(", ")}`,
    };
  }

  if (Object.keys(allowed).length === 0) {
    return {
      success: false,
      actionId: action.id,
      resourceId: action.resourceId,
      resourceType: "contact",
      actionType: "update_contact_fields",
      errorCode: "NO_CHANGES",
      errorMessage: "No valid fields to update",
    };
  }

  const response = await ghlPut<{ contact: Record<string, unknown> }>(
    `/contacts/${action.resourceId}`,
    allowed,
  );

  return {
    success: true,
    actionId: action.id,
    resourceId: action.resourceId,
    resourceType: "contact",
    actionType: "update_contact_fields",
    afterState: response?.contact,
  };
}

async function executeAddContactTag(action: GhlPendingAction): Promise<GhlActionResult> {
  const tagId = action.proposedChanges.tagId as string;
  if (!tagId) {
    return {
      success: false,
      actionId: action.id,
      resourceId: action.resourceId,
      resourceType: "contact",
      actionType: "add_contact_tag",
      errorCode: "MISSING_TAG_ID",
      errorMessage: "Tag ID is required",
    };
  }

  await ghlPost(`/contacts/${action.resourceId}/tags`, { tags: [tagId] });

  return {
    success: true,
    actionId: action.id,
    resourceId: action.resourceId,
    resourceType: "contact",
    actionType: "add_contact_tag",
  };
}

async function executeRemoveContactTag(action: GhlPendingAction): Promise<GhlActionResult> {
  const tagId = action.proposedChanges.tagId as string;
  if (!tagId) {
    return {
      success: false,
      actionId: action.id,
      resourceId: action.resourceId,
      resourceType: "contact",
      actionType: "remove_contact_tag",
      errorCode: "MISSING_TAG_ID",
      errorMessage: "Tag ID is required",
    };
  }

  await ghlDelete(`/contacts/${action.resourceId}/tags/${tagId}`);

  return {
    success: true,
    actionId: action.id,
    resourceId: action.resourceId,
    resourceType: "contact",
    actionType: "remove_contact_tag",
  };
}

async function executeUpdateOpportunity(action: GhlPendingAction): Promise<GhlActionResult> {
  const { allowed, rejected } = filterOpportunityChanges(action.proposedChanges);

  if (rejected.length > 0) {
    return {
      success: false,
      actionId: action.id,
      resourceId: action.resourceId,
      resourceType: "opportunity",
      actionType: "update_opportunity",
      errorCode: "INVALID_FIELDS",
      errorMessage: `Fields not allowed: ${rejected.join(", ")}`,
    };
  }

  if (Object.keys(allowed).length === 0) {
    return {
      success: false,
      actionId: action.id,
      resourceId: action.resourceId,
      resourceType: "opportunity",
      actionType: "update_opportunity",
      errorCode: "NO_CHANGES",
      errorMessage: "No valid fields to update",
    };
  }

  const response = await ghlPut<{ opportunity: Record<string, unknown> }>(
    `/opportunities/${action.resourceId}`,
    allowed,
  );

  return {
    success: true,
    actionId: action.id,
    resourceId: action.resourceId,
    resourceType: "opportunity",
    actionType: "update_opportunity",
    afterState: response?.opportunity,
  };
}

async function executeMoveOpportunityStage(action: GhlPendingAction): Promise<GhlActionResult> {
  const stageId = action.proposedChanges.pipelineStageId as string;
  if (!stageId) {
    return {
      success: false,
      actionId: action.id,
      resourceId: action.resourceId,
      resourceType: "opportunity",
      actionType: "move_opportunity_stage",
      errorCode: "MISSING_STAGE_ID",
      errorMessage: "Pipeline stage ID is required",
    };
  }

  const response = await ghlPut<{ opportunity: Record<string, unknown> }>(
    `/opportunities/${action.resourceId}`,
    { pipelineStageId: stageId },
  );

  return {
    success: true,
    actionId: action.id,
    resourceId: action.resourceId,
    resourceType: "opportunity",
    actionType: "move_opportunity_stage",
    afterState: response?.opportunity,
  };
}

/**
 * Confirm and execute an action in one call.
 * This is the main entry point for processing user confirmations.
 */
export async function confirmAndExecuteAction(actionId: string): Promise<GhlActionResult> {
  const action = await getPendingAction(actionId);

  if (!action) {
    return {
      success: false,
      actionId,
      resourceId: "",
      resourceType: "contact",
      actionType: "update_contact_fields",
      errorCode: "ACTION_NOT_FOUND",
      errorMessage: "Action not found",
    };
  }

  // Idempotency: already completed
  if (action.status === "completed") {
    return {
      success: true,
      actionId,
      resourceId: action.resourceId,
      resourceType: action.resourceType,
      actionType: action.actionType,
    };
  }

  // Only pending actions can be confirmed
  if (action.status !== "pending") {
    return {
      success: false,
      actionId,
      resourceId: action.resourceId,
      resourceType: action.resourceType,
      actionType: action.actionType,
      errorCode: "INVALID_STATUS",
      errorMessage: `Action is ${action.status}, cannot confirm`,
    };
  }

  // Check expiration
  if (new Date(action.expiresAt) < new Date()) {
    await updatePendingActionStatus(actionId, "expired");
    return {
      success: false,
      actionId,
      resourceId: action.resourceId,
      resourceType: action.resourceType,
      actionType: action.actionType,
      errorCode: "BAXTER_GHL_ACTION_EXPIRED",
      errorMessage: "Action has expired",
    };
  }

  // Confirm
  await updatePendingActionStatus(actionId, "confirmed", {
    confirmedAt: new Date().toISOString(),
  });

  // Execute
  return executeAction(actionId);
}
