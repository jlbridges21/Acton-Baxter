/**
 * Baxter account ↔ BambooHR employee links. Rules:
 *   - Never matched by name. Suggestions come only from an exact work-email match.
 *   - Suggestions grant nothing until HR or leadership confirms them.
 *   - One confirmed link per Baxter account and per BambooHR employee.
 *   - Two BambooHR records with the same email are flagged ambiguous and never auto-linked.
 *   - BambooHR employees without Baxter accounts simply have no link.
 */

import "server-only";

import { recordAudit } from "@/lib/agents/audit";
import { agentDb, eq, selectOne } from "@/lib/agents/store";
import { loadAuthEmailsByUserIds } from "@/lib/auth/load-profile-display";
import { getReportStore } from "@/lib/research/report-store";
import type { BambooAccess } from "./access";
import { getConnection } from "./connection";
import { BambooError } from "./errors";
import { findByWorkEmail } from "./service";

export type LinkRow = {
  id: string;
  company_domain: string;
  bamboohr_employee_id: string;
  profile_id: string | null;
  work_email: string | null;
  status: "suggested" | "confirmed" | "rejected";
  match_method: "email" | "manual";
  confirmed_by: string | null;
  confirmed_at: string | null;
  note: string;
  created_at: string;
  updated_at: string;
};

function requireMappings(access: BambooAccess) {
  if (!access.canManageMappings)
    throw new BambooError(
      "Only the CEO, COO, or an HR administrator can manage BambooHR identity links.",
      "not_authorized",
    );
}

async function domain(): Promise<string> {
  const conn = await getConnection();
  if (!conn || conn.status === "disconnected")
    throw new BambooError("BambooHR isn't connected.", "not_connected");
  return conn.company_domain;
}

export async function listLinks(access: BambooAccess): Promise<LinkRow[]> {
  requireMappings(access);
  const d = await domain();
  return agentDb().select<LinkRow>("bamboohr_identity_links", {
    filters: [eq("company_domain", d)],
    order: { col: "created_at", ascending: false },
    limit: 2000,
  });
}

/** Suggest links for Baxter accounts whose sign-in email exactly matches one BambooHR work email. */
export async function suggestLinksByEmail(
  access: BambooAccess,
): Promise<{ suggested: number; ambiguous: number; unmatched: number }> {
  requireMappings(access);
  const d = await domain();
  const profiles = (await getReportStore().listProfiles()).map((p) => p.id);
  const emails = await loadAuthEmailsByUserIds(profiles).catch(() => new Map<string, string>());
  const existing = await agentDb().select<LinkRow>("bamboohr_identity_links", {
    filters: [eq("company_domain", d)],
  });
  let suggested = 0;
  let ambiguous = 0;
  let unmatched = 0;
  for (const [profileId, email] of emails) {
    if (existing.some((l) => l.profile_id === profileId && l.status !== "rejected")) continue;
    const ids = await findByWorkEmail(email);
    if (ids.length === 0) {
      unmatched++;
      continue;
    }
    for (const id of ids) {
      if (existing.some((l) => l.profile_id === profileId && l.bamboohr_employee_id === id))
        continue;
      try {
        await agentDb().insert("bamboohr_identity_links", {
          company_domain: d,
          bamboohr_employee_id: id,
          profile_id: profileId,
          work_email: email.toLowerCase(),
          status: "suggested",
          match_method: "email",
          note:
            ids.length > 1
              ? `Ambiguous: ${ids.length} BambooHR records share this work email. Confirm the right one.`
              : "Exact work-email match.",
        });
      } catch {
        // already suggested concurrently
      }
    }
    if (ids.length > 1) ambiguous++;
    else suggested++;
  }
  await recordAudit({
    actor: { userId: access.userId, label: access.label },
    action: "bamboohr.links_suggested",
    targetType: "ops_integration",
    targetId: null,
    summary: `Suggested ${suggested} BambooHR link(s); ${ambiguous} ambiguous; ${unmatched} without a match.`,
  });
  return { suggested, ambiguous, unmatched };
}

/** Confirm a suggestion, or create a confirmed manual link after checking the employee exists. */
export async function confirmLink(input: {
  linkId?: string;
  profileId?: string;
  employeeId?: string;
  note?: string;
  access: BambooAccess;
}): Promise<LinkRow> {
  requireMappings(input.access);
  const d = await domain();
  let link: LinkRow | null = null;
  if (input.linkId) {
    link = await selectOne<LinkRow>("bamboohr_identity_links", {
      filters: [eq("id", input.linkId), eq("company_domain", d)],
    });
    if (!link) throw new BambooError("That link suggestion no longer exists.", "not_found");
  } else {
    if (!input.profileId || !input.employeeId || !/^[0-9]{1,12}$/.test(input.employeeId))
      throw new BambooError("Choose a Baxter account and a BambooHR employee id.", "invalid_field");
    // Verify the employee exists and is readable before linking (names only).
    const { getEmployeeFields } = await import("./service");
    await getEmployeeFields(input.employeeId, ["basic"]);
  }
  const profileId = link?.profile_id ?? input.profileId!;
  const employeeId = link?.bamboohr_employee_id ?? input.employeeId!;
  const confirmed = await agentDb().select<LinkRow>("bamboohr_identity_links", {
    filters: [eq("company_domain", d), eq("status", "confirmed")],
  });
  if (confirmed.some((l) => l.profile_id === profileId && l.bamboohr_employee_id !== employeeId))
    throw new BambooError(
      "That Baxter account is already linked to a different BambooHR employee. Unlink it first.",
      "ambiguous_mapping",
    );
  if (confirmed.some((l) => l.bamboohr_employee_id === employeeId && l.profile_id !== profileId))
    throw new BambooError(
      "That BambooHR employee is already linked to a different Baxter account. Unlink it first.",
      "ambiguous_mapping",
    );
  const patch = {
    status: "confirmed",
    confirmed_by: input.access.userId,
    confirmed_at: new Date().toISOString(),
    note: (input.note ?? link?.note ?? "").slice(0, 300),
  };
  let row: LinkRow | undefined;
  if (link)
    [row] = await agentDb().update<LinkRow>("bamboohr_identity_links", [eq("id", link.id)], patch);
  else {
    const prior = await selectOne<LinkRow>("bamboohr_identity_links", {
      filters: [
        eq("company_domain", d),
        eq("bamboohr_employee_id", employeeId),
        eq("profile_id", profileId),
      ],
    });
    [row] = prior
      ? await agentDb().update<LinkRow>("bamboohr_identity_links", [eq("id", prior.id)], patch)
      : await agentDb().insert<LinkRow>("bamboohr_identity_links", {
          company_domain: d,
          bamboohr_employee_id: employeeId,
          profile_id: profileId,
          work_email: null,
          match_method: "manual",
          ...patch,
        });
  }
  // Other suggestions for the same person or employee are no longer valid.
  for (const l of await agentDb().select<LinkRow>("bamboohr_identity_links", {
    filters: [eq("company_domain", d), eq("status", "suggested")],
  })) {
    if (l.id !== row!.id && (l.profile_id === profileId || l.bamboohr_employee_id === employeeId))
      await agentDb().update("bamboohr_identity_links", [eq("id", l.id)], {
        status: "rejected",
        note: "Superseded by a confirmed link.",
      });
  }
  // Keep Sam Operations' people register in step.
  await agentDb()
    .update("ops_people", [eq("profile_id", profileId)], { bamboohr_id: employeeId })
    .catch(() => undefined);
  await recordAudit({
    actor: { userId: input.access.userId, label: input.access.label },
    action: "bamboohr.link_confirmed",
    targetType: "bamboohr_employee",
    targetId: employeeId,
    summary: `Linked a Baxter account to BambooHR employee #${employeeId} (${row!.match_method}).`,
  });
  return row!;
}

export async function rejectOrUnlink(linkId: string, access: BambooAccess): Promise<void> {
  requireMappings(access);
  const link = await selectOne<LinkRow>("bamboohr_identity_links", { filters: [eq("id", linkId)] });
  if (!link) throw new BambooError("That link no longer exists.", "not_found");
  await agentDb().update("bamboohr_identity_links", [eq("id", linkId)], {
    status: "rejected",
    note: link.status === "confirmed" ? "Unlinked." : "Rejected.",
  });
  await recordAudit({
    actor: { userId: access.userId, label: access.label },
    action: link.status === "confirmed" ? "bamboohr.unlinked" : "bamboohr.link_rejected",
    targetType: "bamboohr_employee",
    targetId: link.bamboohr_employee_id,
    summary: `${link.status === "confirmed" ? "Unlinked" : "Rejected"} BambooHR employee #${link.bamboohr_employee_id}.`,
  });
}
