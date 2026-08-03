import { isAdminRole } from "@/lib/auth/roles";
import { AuthorizationError } from "@/lib/errors";
import type { KnowledgeEntry, KnowledgeVisibility } from "./types";

export function assertCanManageKnowledge(role: string | null | undefined): void {
  if (!isAdminRole(role)) {
    throw new AuthorizationError("Admin access required for Knowledge Base management");
  }
}

export function canEmployeeReadEntry(entry: KnowledgeEntry): boolean {
  return entry.status === "approved" && entry.visibility === "internal";
}

/**
 * What a signed-in app-access user may read in the Knowledge Center.
 * Admins: everything. Users: approved+internal, plus their own drafts (not archived / others' drafts).
 */
export function canUserReadKnowledgeEntry(
  entry: KnowledgeEntry,
  userId: string,
  role: string | null | undefined,
): boolean {
  if (isAdminRole(role)) return true;
  if (entry.status === "archived") return false;
  if (canEmployeeReadEntry(entry)) return true;
  return entry.status === "draft" && entry.created_by === userId;
}

export function filterKnowledgeVisibleToUser(
  entries: KnowledgeEntry[],
  userId: string,
  role: string | null | undefined,
): KnowledgeEntry[] {
  return entries.filter((entry) => canUserReadKnowledgeEntry(entry, userId, role));
}

export function canRoleReadEntry(entry: KnowledgeEntry, role: string | null | undefined): boolean {
  if (isAdminRole(role)) return true;
  return canEmployeeReadEntry(entry);
}

export function employeeRetrievalVisibility(): KnowledgeVisibility {
  return "internal";
}
