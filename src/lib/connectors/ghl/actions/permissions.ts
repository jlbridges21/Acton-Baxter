import "server-only";

import type { Profile } from "@/lib/research/db-types";
import type { GhlActionType, GhlWritePermission } from "./types";

/**
 * Check if GHL writes are enabled for the given user role.
 * Admins can always write. Salespeople can write if ENABLE_GHL_WRITES_FOR_SALES=true.
 * All other roles are read-only.
 */
export function canUserWriteGhl(user: Profile | null): GhlWritePermission {
  if (!user) {
    return {
      canWrite: false,
      reason: "User not authenticated",
    };
  }

  const writesEnabled =
    (process.env.ENABLE_GHL_INTEGRATION ?? "").toLowerCase() === "true" ||
    process.env.ENABLE_GHL_INTEGRATION === "1";

  if (!writesEnabled) {
    return {
      canWrite: false,
      reason: "GoHighLevel integration is disabled",
    };
  }

  // Admins can always write
  if (user.role === "admin") {
    return {
      canWrite: true,
      allowedActions: getAllowedActionsForRole("admin"),
    };
  }

  // Salespeople can write if enabled
  if (user.role === "salesperson") {
    const salesWritesEnabled =
      (process.env.ENABLE_GHL_WRITES_FOR_SALES ?? "").toLowerCase() === "true" ||
      process.env.ENABLE_GHL_WRITES_FOR_SALES === "1";

    if (salesWritesEnabled) {
      return {
        canWrite: true,
        allowedActions: getAllowedActionsForRole("salesperson"),
      };
    }

    return {
      canWrite: false,
      reason:
        "I can look that up, but CRM updates through Baxter are currently restricted to admins.",
      deniedActions: getAllowedActionsForRole("salesperson"),
    };
  }

  // All other roles are read-only
  return {
    canWrite: false,
    reason: `Write operations are not available for ${user.role} role.`,
  };
}

/**
 * Get allowed action types for a role.
 */
function getAllowedActionsForRole(role: string): GhlActionType[] {
  const baseActions: GhlActionType[] = [
    "update_contact_fields",
    "add_contact_tag",
    "remove_contact_tag",
    "update_opportunity",
    "move_opportunity_stage",
  ];

  // All roles with write access get the same actions for now
  if (role === "admin" || role === "salesperson") {
    return baseActions;
  }

  return [];
}

/**
 * Check if a specific action type is allowed for the user.
 */
export function isActionAllowed(user: Profile | null, actionType: GhlActionType): boolean {
  const permission = canUserWriteGhl(user);
  if (!permission.canWrite) return false;
  if (!permission.allowedActions) return false;
  return permission.allowedActions.includes(actionType);
}

/**
 * Get a user-friendly description of write permissions.
 */
export function describeWritePermissions(user: Profile | null): string {
  const permission = canUserWriteGhl(user);

  if (!permission.canWrite) {
    return permission.reason || "Write operations are not available.";
  }

  const actionDescriptions: Record<GhlActionType, string> = {
    update_contact_fields: "Update contact fields",
    add_contact_tag: "Add tags to contacts",
    remove_contact_tag: "Remove tags from contacts",
    update_opportunity: "Update opportunity details",
    move_opportunity_stage: "Move opportunities between stages",
  };

  const allowed = (permission.allowedActions || []).map((a) => actionDescriptions[a]).join(", ");

  return `You can: ${allowed}. All changes require confirmation before being applied.`;
}
