/**
 * Server-side authorization for the AI Workforce.
 *
 * Every route and every runtime step calls these helpers; the UI only mirrors them.
 * Admins and super-admins hold implicit "manage" on every agent. Everyone else gets
 * exactly the access levels granted by ai_agent_access_policies (by role, user, or
 * department). Unverified requesters (e.g. an unmapped Slack user) get nothing.
 */

import "server-only";

import { isAdminRole, isAppAccessRole, isSuperAdminRole } from "@/lib/auth/roles";
import type { AuthUser } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/errors";
import { agentDb, eq } from "./store";
import type { AccessLevel, AccessPolicyRow, Requester, ResolvedAgent } from "./types";
import { ACCESS_LEVELS } from "./types";

export function requesterFromAuthUser(user: AuthUser): Requester {
  return {
    userId: user.id,
    role: user.profile.role,
    departmentId: user.profile.department_id ?? null,
    label: user.profile.full_name || user.email,
    verifiedVia: "web_session",
  };
}

export async function loadAccessPolicies(agentId: string): Promise<AccessPolicyRow[]> {
  return agentDb().select<AccessPolicyRow>("ai_agent_access_policies", {
    filters: [eq("agent_id", agentId)],
    order: { col: "created_at" },
  });
}

/** Pure resolution so it can be unit tested without a database. */
export function resolveAccessLevels(
  requester: Requester,
  policies: AccessPolicyRow[],
): Set<AccessLevel> {
  if (requester.verifiedVia === "unverified" || !requester.userId) return new Set();
  if (!isAppAccessRole(requester.role)) return new Set();
  if (isAdminRole(requester.role)) return new Set(ACCESS_LEVELS);

  const granted = new Set<AccessLevel>();
  for (const p of policies) {
    const applies =
      (p.principal_type === "role" && p.principal_value === requester.role) ||
      (p.principal_type === "user" && p.principal_value === requester.userId) ||
      (p.principal_type === "department" &&
        requester.departmentId != null &&
        p.principal_value === requester.departmentId);
    if (applies) granted.add(p.access_level);
  }
  if (granted.has("manage")) return new Set(ACCESS_LEVELS);
  return granted;
}

export async function getAgentAccess(
  requester: Requester,
  agent: ResolvedAgent,
): Promise<Set<AccessLevel>> {
  return resolveAccessLevels(requester, await loadAccessPolicies(agent.row.id));
}

export async function hasAgentAccess(
  requester: Requester,
  agent: ResolvedAgent,
  level: AccessLevel,
): Promise<boolean> {
  return (await getAgentAccess(requester, agent)).has(level);
}

export async function assertAgentAccess(
  requester: Requester,
  agent: ResolvedAgent,
  level: AccessLevel,
  message?: string,
): Promise<void> {
  if (!(await hasAgentAccess(requester, agent, level))) {
    throw new AuthorizationError(
      message ?? `You don't have permission to do that for ${agent.row.display_name}.`,
    );
  }
}

// --- Workspace-level capabilities -----------------------------------------

/** Any approved employee may open the AI Workspace and see the org (no confidential content). */
export function canViewWorkspace(requester: Requester): boolean {
  return requester.verifiedVia !== "unverified" && isAppAccessRole(requester.role);
}

/** Creating agents, changing access policies, and workspace layout are admin-only. */
export function canAdministerWorkspace(requester: Requester): boolean {
  return isAdminRole(requester.role);
}

export function isSuperAdminRequester(requester: Requester): boolean {
  return isSuperAdminRole(requester.role);
}

export function assertCanAdministerWorkspace(requester: Requester): void {
  if (!canAdministerWorkspace(requester)) {
    throw new AuthorizationError("Only administrators can change AI Workspace settings.");
  }
}
