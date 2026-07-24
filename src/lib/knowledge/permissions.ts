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

export function canRoleReadEntry(entry: KnowledgeEntry, role: string | null | undefined): boolean {
  if (isAdminRole(role)) return true;
  return canEmployeeReadEntry(entry);
}

export function employeeRetrievalVisibility(): KnowledgeVisibility {
  return "internal";
}
