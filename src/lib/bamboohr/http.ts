/**
 * HTTP-facing service for /api/integrations/bamboohr/*. Every handler re-derives access from the
 * signed-in user; tokens never appear in any response.
 */

import "server-only";

import { z } from "zod";
import type { AiContext } from "@/lib/agents/http";
import { agentDb } from "@/lib/agents/store";
import { isAppAccessRole } from "@/lib/auth/roles";
import { getReportStore } from "@/lib/research/report-store";
import {
  getBambooAccess,
  readableCustomFields,
  setReadableCustomFields,
  type BambooAccess,
} from "./access";
import { runDiagnostics } from "./capabilities";
import {
  bambooRedirectUri,
  configProblems,
  disconnect,
  getConnection,
  publicConnection,
  refreshAccessToken,
} from "./connection";
import { BambooError } from "./errors";
import { confirmLink, listLinks, rejectOrUnlink, suggestLinksByEmail } from "./identity";
import { SCOPE_GROUPS } from "./scopes";
import { PLANNED_WRITES } from "./writes";

export async function bambooAccessFor(ctx: AiContext): Promise<BambooAccess> {
  return getBambooAccess(ctx.requester);
}

export async function loadBambooState(ctx: AiContext) {
  const access = await bambooAccessFor(ctx);
  const conn = await getConnection().catch(() => null);
  const base = {
    access: {
      canViewAll: access.canViewAll,
      canManageConnection: access.canManageConnection,
      canManageMappings: access.canManageMappings,
      linked: Boolean(access.ownEmployeeId),
      ownEmployeeId: access.ownEmployeeId,
    },
    connection:
      conn && conn.status !== "disconnected"
        ? {
            status: conn.status,
            companyName: conn.company_name,
            companyDomain: conn.company_domain,
            lastSuccessAt: conn.last_success_at,
          }
        : null,
  };
  if (!access.canManageConnection && !access.canViewAll) return { ...base, admin: null };
  const links =
    access.canManageMappings && conn && conn.status !== "disconnected"
      ? await listLinks(access)
      : [];
  const profiles = links.length
    ? (await getReportStore().listProfiles())
        .filter((p) => isAppAccessRole(p.role))
        .map((p) => ({ id: p.id, full_name: p.full_name }))
    : [];
  return {
    ...base,
    admin: {
      configProblems: configProblems(),
      redirectUri: bambooRedirectUri(),
      connection: publicConnection(conn),
      scopeGroups: SCOPE_GROUPS,
      plannedWrites: PLANNED_WRITES,
      readableCustomFields: await readableCustomFields(),
      links: links.map((l) => ({
        id: l.id,
        employeeId: l.bamboohr_employee_id,
        profileId: l.profile_id,
        profileName: profiles.find((p) => p.id === l.profile_id)?.full_name ?? null,
        workEmail: l.work_email,
        status: l.status,
        method: l.match_method,
        note: l.note,
        confirmedAt: l.confirmed_at,
      })),
    },
  };
}

const id = z.string().uuid();
export const bambooCommandSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("diagnostics") }),
  z.object({ op: z.literal("refresh") }),
  z.object({ op: z.literal("disconnect") }),
  z.object({ op: z.literal("suggest_links") }),
  z.object({
    op: z.literal("confirm_link"),
    linkId: id.optional(),
    profileId: id.optional(),
    employeeId: z
      .string()
      .regex(/^[0-9]{1,12}$/)
      .optional(),
    note: z.string().max(300).optional(),
  }),
  z.object({ op: z.literal("reject_link"), linkId: id }),
  z.object({ op: z.literal("custom_fields"), fields: z.array(z.string().max(80)).max(40) }),
]);

export async function runBambooCommand(ctx: AiContext, raw: unknown): Promise<unknown> {
  const cmd = bambooCommandSchema.parse(raw);
  const access = await bambooAccessFor(ctx);
  const actorLabel = ctx.user.profile.full_name || ctx.user.email;
  const manage = () => {
    if (!access.canManageConnection)
      throw new BambooError(
        "Only the COO manages the BambooHR connection (the COO controls system access).",
        "not_authorized",
      );
  };
  switch (cmd.op) {
    case "diagnostics":
      return runDiagnostics(access);
    case "refresh": {
      manage();
      const row = await getConnection();
      if (!row || row.status === "disconnected")
        throw new BambooError("BambooHR isn't connected.", "not_connected");
      await refreshAccessToken(row, true);
      return { refreshed: true };
    }
    case "disconnect":
      manage();
      await disconnect({ userId: ctx.user.id, actorLabel });
      return { disconnected: true };
    case "suggest_links":
      return suggestLinksByEmail(access);
    case "confirm_link":
      return confirmLink({ ...cmd, access });
    case "reject_link":
      return rejectOrUnlink(cmd.linkId, access);
    case "custom_fields":
      return setReadableCustomFields(cmd.fields, access);
  }
}

void agentDb;
