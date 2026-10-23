/**
 * Reports authorization. Reuses the AI Workforce permission model: access to Reports and
 * to each data category comes from the requester's access to the Dexter agent
 * (admins implicitly have everything).
 *
 *   general   — anyone who can use Dexter (Ask through Baxter or Chat directly)
 *   customer  — "Customer details (Reports)"
 *   financial — "Financial figures (Reports)"
 *   internal  — "Manage agent" on Dexter (or admin)
 *
 * Report sharing never widens data access: every execution re-checks these categories.
 */

import "server-only";

import { AuthorizationError } from "@/lib/errors";
import { isAdminRole } from "@/lib/auth/roles";
import { getAgentAccess } from "@/lib/agents/permissions";
import { getResolvedAgent } from "@/lib/agents/registry";
import type { Requester } from "@/lib/agents/types";
import type { FieldDef } from "./fields";

export const DEXTER_SLUG = "dexter";

export type ReportsAccess = {
  canUse: boolean;
  canChat: boolean;
  canManage: boolean;
  /** Set commission rates / project assignments (requires financial access too). */
  canEditRules: boolean;
  isAdmin: boolean;
  categories: Set<FieldDef["category"]>;
};

export async function getReportsAccess(requester: Requester): Promise<ReportsAccess> {
  const isAdmin = isAdminRole(requester.role) && requester.verifiedVia !== "unverified";
  const dexter = await getResolvedAgent(DEXTER_SLUG).catch(() => null);
  const levels = dexter ? await getAgentAccess(requester, dexter) : new Set<string>();
  const canUse = isAdmin || levels.has("use_via_baxter") || levels.has("direct_chat");
  const categories = new Set<FieldDef["category"]>();
  if (canUse) categories.add("general");
  if (isAdmin || levels.has("customer_data")) categories.add("customer");
  if (isAdmin || levels.has("financial_data")) categories.add("financial");
  if (isAdmin || levels.has("manage")) categories.add("internal");
  return {
    canUse,
    canChat: isAdmin || levels.has("direct_chat"),
    canManage: isAdmin || levels.has("manage"),
    canEditRules: isAdmin || (levels.has("business_rules") && levels.has("financial_data")),
    isAdmin,
    categories,
  };
}

export async function requireReportsAccess(requester: Requester): Promise<ReportsAccess> {
  const access = await getReportsAccess(requester);
  if (!access.canUse) {
    throw new AuthorizationError(
      "You don't have access to Reports. An administrator can grant it on Dexter's Access tab.",
    );
  }
  return access;
}

export function canSeeField(access: ReportsAccess, def: Pick<FieldDef, "category">): boolean {
  return access.categories.has(def.category);
}

export const CATEGORY_LABELS: Record<FieldDef["category"], string> = {
  general: "Project information",
  customer: "Customer details",
  financial: "Financial figures",
  internal: "Internal sales notes",
};
