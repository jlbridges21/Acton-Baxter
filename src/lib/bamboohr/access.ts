/**
 * Who may see which BambooHR data. Decided on the server from verified identity — never by the
 * model, and never inherited through Baxter delegation (the requester is always the original
 * employee).
 *
 *   CEO, COO, confirmed HR administrators → search employees; read approved fields for anyone,
 *                                            plus leadership-approved custom fields, files list,
 *                                            onboarding status.
 *   Any other verified employee            → only their own record, and only through a
 *                                            confirmed identity link; standard fields only.
 *   Unverified or unlinked                 → nothing.
 *   Connection management                  → the COO (the COO controls system access); the CEO
 *                                            if no COO is confirmed; an app admin only before
 *                                            any leadership account is confirmed.
 */

import "server-only";

import { recordAudit } from "@/lib/agents/audit";
import { agentDb, eq, selectOne } from "@/lib/agents/store";
import type { Requester } from "@/lib/agents/types";
import { getIntegrationSettings } from "@/lib/ops/integrations";
import { getOpsAccess, getOpsRoles } from "@/lib/ops/org";
import { BambooError } from "./errors";
import type { FieldGroup } from "./fields";

export type BambooAccess = {
  userId: string | null;
  label: string;
  canViewAll: boolean;
  canManageConnection: boolean;
  canManageMappings: boolean;
  ownEmployeeId: string | null;
};

export async function getBambooAccess(requester: Requester): Promise<BambooAccess> {
  const ops = await getOpsAccess(requester);
  const roles = await getOpsRoles();
  const canManageConnection = roles.coo ? ops.isCoo : roles.ceo ? ops.isCeo : ops.isAppAdmin;
  const domain = (process.env.BAMBOOHR_COMPANY_DOMAIN ?? "").trim().toLowerCase();
  const link =
    ops.userId && domain
      ? await selectOne<{ bamboohr_employee_id: string }>("bamboohr_identity_links", {
          filters: [
            eq("profile_id", ops.userId),
            eq("company_domain", domain),
            eq("status", "confirmed"),
          ],
        })
      : null;
  return {
    userId: ops.userId,
    label: requester.label,
    canViewAll: ops.canViewAll,
    canManageConnection,
    canManageMappings: ops.isLeadership || ops.isHrAdmin,
    ownEmployeeId: link?.bamboohr_employee_id ?? null,
  };
}

export async function readableCustomFields(): Promise<string[]> {
  const cfg = (await getIntegrationSettings("bamboohr")).config;
  return Array.isArray(cfg.readableCustomFields) ? (cfg.readableCustomFields as string[]) : [];
}

/** Field groups the requester may read for this employee, or a refusal that reveals nothing. */
export async function authorizeEmployee(
  access: BambooAccess,
  employeeId: string,
): Promise<{ groups: FieldGroup[]; custom: string[]; self: boolean }> {
  if (!access.userId)
    throw new BambooError(
      "Your identity couldn't be verified, so BambooHR records are unavailable.",
      "not_authorized",
    );
  if (access.canViewAll)
    return {
      groups: ["basic", "job", "contact"],
      custom: await readableCustomFields(),
      self: access.ownEmployeeId === employeeId,
    };
  if (access.ownEmployeeId && access.ownEmployeeId === employeeId)
    return { groups: ["basic", "job", "contact"], custom: [], self: true };
  if (!access.ownEmployeeId)
    throw new BambooError(
      "Your Baxter account isn't linked to a BambooHR employee record yet. Ask HR to confirm the link.",
      "not_mapped",
    );
  throw new BambooError(
    "That BambooHR information is restricted. You can only view your own record.",
    "not_authorized",
  );
}

export function requireViewAll(access: BambooAccess, what: string) {
  if (!access.canViewAll)
    throw new BambooError(
      `Only the CEO, COO, or an HR administrator can ${what}.`,
      "not_authorized",
    );
}

/** Log who read which employee record (never the contents). */
export async function auditRead(
  access: BambooAccess,
  employeeId: string | null,
  what: string,
  channel: "web" | "sam",
) {
  await recordAudit({
    actor: {
      userId: access.userId,
      label: channel === "sam" ? `Sam for ${access.label}` : access.label,
    },
    action: "bamboohr.read",
    targetType: "bamboohr_employee",
    targetId: employeeId,
    summary: `Read ${what} from BambooHR${employeeId ? ` (employee #${employeeId})` : ""}.`,
  });
}

/** Leadership-approved custom fields Baxter may read (sensitive names are rejected). */
export async function setReadableCustomFields(fields: string[], access: BambooAccess) {
  if (!access.canManageConnection)
    throw new BambooError(
      "Only the COO can change which BambooHR fields Baxter reads.",
      "not_authorized",
    );
  const { isSensitiveField } = await import("./fields");
  const bad = fields.filter((f) => isSensitiveField(f) || !/^[A-Za-z0-9_.]{1,80}$/.test(f));
  if (bad.length)
    throw new BambooError(
      `These fields can't be read by Baxter: ${bad.join(", ")}.`,
      "invalid_field",
    );
  const { saveIntegrationSettings } = await import("@/lib/ops/integrations");
  const current = await getIntegrationSettings("bamboohr");
  await saveIntegrationSettings(
    "bamboohr",
    { config: { ...current.config, readableCustomFields: [...new Set(fields)].slice(0, 40) } },
    access.userId,
  );
  await recordAudit({
    actor: { userId: access.userId, label: access.label },
    action: "bamboohr.custom_fields_changed",
    targetType: "ops_integration",
    targetId: null,
    summary: `Allowed ${fields.length} custom BambooHR field(s) for reading.`,
  });
}

void agentDb;
