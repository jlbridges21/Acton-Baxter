/**
 * Report groups (folders). A group organizes reports; it never grants access to them.
 *
 *   personal — visible and managed only by its owner; any report the owner can view may be filed.
 *   company  — every Reports user sees the group name; only reports they can already view are
 *              listed or counted. Created by Reports managers/admins. Filing a report into a
 *              company group requires edit rights on the report.
 *
 * Each viewer sees a report in at most one personal group and at most one company group
 * (filing it into another group of the same kind moves it).
 */

import "server-only";

import { recordAudit } from "@/lib/agents/audit";
import { agentDb, eq, inList, selectOne } from "@/lib/agents/store";
import type { Requester } from "@/lib/agents/types";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import type { ReportsAccess } from "./access";
import { listReportsFor, loadReportFor } from "./repo";

export const GROUP_COLORS = [
  "slate",
  "navy",
  "teal",
  "green",
  "amber",
  "orange",
  "red",
  "violet",
  "pink",
  "sky",
] as const;
export const GROUP_ICONS = [
  "folder",
  "chart",
  "dollar",
  "package",
  "pencil",
  "hammer",
  "clipboard",
  "briefcase",
  "building",
  "star",
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];
export type GroupIcon = (typeof GROUP_ICONS)[number];

export type GroupRow = {
  id: string;
  name: string;
  description: string;
  color: GroupColor;
  icon: GroupIcon;
  scope: "personal" | "company";
  owner_id: string | null;
  sort_order: number;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
type ItemRow = { group_id: string; report_id: string; added_by: string | null; created_at: string };

export type GroupView = {
  id: string;
  name: string;
  description: string;
  color: GroupColor;
  icon: GroupIcon;
  scope: "personal" | "company";
  isMine: boolean;
  canManage: boolean;
  reportCount: number;
  sortOrder: number;
  archived: boolean;
};

type Ctx = { requester: Requester; access: ReportsAccess; actorLabel: string };

const actor = (c: Ctx) => ({ userId: c.requester.userId, label: c.actorLabel });

export function canManageGroup(
  g: Pick<GroupRow, "scope" | "owner_id">,
  c: Pick<Ctx, "requester" | "access">,
): boolean {
  const uid = c.requester.userId;
  if (!uid) return false;
  if (g.scope === "personal") return g.owner_id === uid;
  return g.owner_id === uid || c.access.isAdmin || c.access.canManage;
}

function canSee(g: GroupRow, c: Pick<Ctx, "requester">): boolean {
  return g.scope === "company" || (g.owner_id !== null && g.owner_id === c.requester.userId);
}

async function visibleGroupRows(
  c: Pick<Ctx, "requester">,
  includeArchived = false,
): Promise<GroupRow[]> {
  const uid = c.requester.userId;
  if (!uid) return [];
  const rows = await agentDb().select<GroupRow>("bi_report_groups", {
    order: { col: "sort_order" },
    limit: 2000,
  });
  return rows
    .filter((g) => canSee(g, c) && (includeArchived || !g.archived_at))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

async function getGroupFor(id: string, c: Pick<Ctx, "requester">): Promise<GroupRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("Group not found");
  const g = await selectOne<GroupRow>("bi_report_groups", { filters: [eq("id", id)] });
  // Same error for missing and not-visible, so other people's personal groups aren't revealed.
  if (!g || !canSee(g, c)) throw new NotFoundError("Group not found");
  return g;
}

function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) throw new ValidationError("Give the group a name.");
  if (name.length > 60) throw new ValidationError("Group names can be up to 60 characters.");
  return name;
}

/** Groups this viewer can see, with counts of reports *they* can view (never others). */
export async function listGroupsFor(
  c: Pick<Ctx, "requester" | "access">,
  opts: { includeArchived?: boolean; visibleReportIds?: Set<string> } = {},
): Promise<{ groups: GroupView[]; membership: Map<string, string[]> }> {
  const groups = await visibleGroupRows(c, opts.includeArchived);
  const visible =
    opts.visibleReportIds ??
    new Set((await listReportsFor(c.requester, c.access)).map((x) => x.report.id));
  const items = groups.length
    ? await agentDb().select<ItemRow>("bi_report_group_items", {
        filters: [
          inList(
            "group_id",
            groups.map((g) => g.id),
          ),
        ],
        limit: 20_000,
      })
    : [];
  const membership = new Map<string, string[]>();
  const counts = new Map<string, number>();
  for (const it of items) {
    if (!visible.has(it.report_id)) continue;
    membership.set(it.report_id, [...(membership.get(it.report_id) ?? []), it.group_id]);
    counts.set(it.group_id, (counts.get(it.group_id) ?? 0) + 1);
  }
  return {
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      color: g.color,
      icon: g.icon,
      scope: g.scope,
      isMine: g.owner_id === c.requester.userId,
      canManage: canManageGroup(g, c),
      reportCount: counts.get(g.id) ?? 0,
      sortOrder: g.sort_order,
      archived: Boolean(g.archived_at),
    })),
    membership,
  };
}

export async function findGroupByName(
  name: string,
  c: Pick<Ctx, "requester">,
): Promise<GroupRow | null> {
  const n = name.trim().toLowerCase();
  return (await visibleGroupRows(c)).find((g) => g.name.toLowerCase() === n) ?? null;
}

export async function createGroup(
  input: {
    name: string;
    description?: string;
    color?: GroupColor;
    icon?: GroupIcon;
    scope?: "personal" | "company";
  } & Ctx,
): Promise<GroupRow> {
  const uid = input.requester.userId;
  if (!uid) throw new AuthorizationError("Sign in to create report groups.");
  const scope = input.scope ?? "personal";
  if (scope === "company" && !(input.access.isAdmin || input.access.canManage)) {
    throw new AuthorizationError(
      "Only Reports managers can create company-wide groups. Create a personal group instead.",
    );
  }
  const name = cleanName(input.name);
  const clash = (await visibleGroupRows(input, true)).find(
    (g) =>
      g.scope === scope &&
      g.name.toLowerCase() === name.toLowerCase() &&
      (scope === "company" || g.owner_id === uid),
  );
  if (clash)
    throw new ValidationError(
      clash.archived_at
        ? `An archived group named "${clash.name}" already exists. Restore it instead.`
        : `You already have a group named "${clash.name}".`,
    );
  const siblings = (await visibleGroupRows(input)).filter((g) => g.scope === scope);
  const [row] = await agentDb().insert<GroupRow>("bi_report_groups", {
    name,
    description: (input.description ?? "").trim().slice(0, 300),
    color: GROUP_COLORS.includes(input.color as GroupColor) ? input.color : "slate",
    icon: GROUP_ICONS.includes(input.icon as GroupIcon) ? input.icon : "folder",
    scope,
    owner_id: uid,
    sort_order: siblings.length ? Math.max(...siblings.map((g) => g.sort_order)) + 1 : 0,
    archived_at: null,
    created_by: uid,
  });
  await recordAudit({
    actor: actor(input),
    action: "reports.group_created",
    targetType: "bi_report_group",
    targetId: row!.id,
    summary: `Created ${scope} report group "${name}".`,
  });
  return row!;
}

export async function updateGroup(
  input: {
    groupId: string;
    patch: { name?: string; description?: string; color?: GroupColor; icon?: GroupIcon };
  } & Ctx,
): Promise<GroupRow> {
  const g = await getGroupFor(input.groupId, input);
  if (!canManageGroup(g, input)) throw new AuthorizationError("You can't change this group.");
  const patch: Partial<GroupRow> = {};
  if (input.patch.name !== undefined) {
    patch.name = cleanName(input.patch.name);
    const clash = (await visibleGroupRows(input, true)).find(
      (x) =>
        x.id !== g.id &&
        x.scope === g.scope &&
        x.name.toLowerCase() === patch.name!.toLowerCase() &&
        (g.scope === "company" || x.owner_id === g.owner_id),
    );
    if (clash) throw new ValidationError(`A group named "${clash.name}" already exists.`);
  }
  if (input.patch.description !== undefined)
    patch.description = input.patch.description.trim().slice(0, 300);
  if (input.patch.color && GROUP_COLORS.includes(input.patch.color))
    patch.color = input.patch.color;
  if (input.patch.icon && GROUP_ICONS.includes(input.patch.icon)) patch.icon = input.patch.icon;
  const [row] = await agentDb().update<GroupRow>("bi_report_groups", [eq("id", g.id)], patch);
  await recordAudit({
    actor: actor(input),
    action: "reports.group_updated",
    targetType: "bi_report_group",
    targetId: g.id,
    summary:
      patch.name && patch.name !== g.name
        ? `Renamed report group "${g.name}" to "${patch.name}".`
        : `Updated report group "${g.name}".`,
  });
  return row!;
}

export async function setGroupArchived(
  input: { groupId: string; archived: boolean } & Ctx,
): Promise<void> {
  const g = await getGroupFor(input.groupId, input);
  if (!canManageGroup(g, input)) throw new AuthorizationError("You can't change this group.");
  if (input.archived) {
    const items = await agentDb().select<ItemRow>("bi_report_group_items", {
      filters: [eq("group_id", g.id)],
      limit: 1,
    });
    if (items.length)
      throw new ValidationError(
        `"${g.name}" still has reports. Move them out first, then archive the group.`,
      );
  }
  await agentDb().update("bi_report_groups", [eq("id", g.id)], {
    archived_at: input.archived ? new Date().toISOString() : null,
  });
  await recordAudit({
    actor: actor(input),
    action: input.archived ? "reports.group_archived" : "reports.group_restored",
    targetType: "bi_report_group",
    targetId: g.id,
    summary: `${input.archived ? "Archived" : "Restored"} report group "${g.name}".`,
  });
}

/** Delete an empty group. Groups that still hold any reports (even ones you can't see) are kept. */
export async function deleteGroup(input: { groupId: string } & Ctx): Promise<void> {
  const g = await getGroupFor(input.groupId, input);
  if (!canManageGroup(g, input)) throw new AuthorizationError("You can't delete this group.");
  const items = await agentDb().select<ItemRow>("bi_report_group_items", {
    filters: [eq("group_id", g.id)],
    limit: 1,
  });
  if (items.length)
    throw new ValidationError(`"${g.name}" isn't empty. Move its reports out first.`);
  await agentDb().remove("bi_report_groups", [eq("id", g.id)]);
  await recordAudit({
    actor: actor(input),
    action: "reports.group_deleted",
    targetType: "bi_report_group",
    targetId: g.id,
    summary: `Deleted empty report group "${g.name}".`,
  });
}

/** Reorder the groups you manage (ids in the new order). */
export async function reorderGroups(input: { groupIds: string[] } & Ctx): Promise<void> {
  const rows = await visibleGroupRows(input);
  let i = 0;
  for (const id of input.groupIds) {
    const g = rows.find((r) => r.id === id);
    if (!g || !canManageGroup(g, input)) continue;
    await agentDb().update("bi_report_groups", [eq("id", g.id)], { sort_order: i++ });
  }
}

async function assertCanFile(reportId: string, g: GroupRow, c: Ctx) {
  const { report, permission } = await loadReportFor(reportId, c.requester, c.access); // NotFound if not viewable
  if (g.scope === "company") {
    if (!permission.canEdit)
      throw new AuthorizationError(
        `You can view "${report.title}" but not edit it, so you can't file it in a company group. Use a personal group instead.`,
      );
  } else if (!canManageGroup(g, c)) {
    throw new AuthorizationError("You can only file reports into your own personal groups.");
  }
  return report;
}

/**
 * File a report into a group (moving it out of any other group of the same kind for this
 * viewer). Never changes who can see the report.
 */
export async function assignReportToGroup(
  input: { reportId: string; groupId: string } & Ctx,
): Promise<{ moved: boolean; from: string | null }> {
  const g = await getGroupFor(input.groupId, input);
  if (g.archived_at) throw new ValidationError(`"${g.name}" is archived. Restore it first.`);
  const report = await assertCanFile(input.reportId, g, input);
  const siblings = (await visibleGroupRows(input, true)).filter(
    (x) =>
      x.id !== g.id && x.scope === g.scope && (g.scope === "company" || x.owner_id === g.owner_id),
  );
  const existing = siblings.length
    ? await agentDb().select<ItemRow>("bi_report_group_items", {
        filters: [
          eq("report_id", report.id),
          inList(
            "group_id",
            siblings.map((x) => x.id),
          ),
        ],
      })
    : [];
  for (const it of existing)
    await agentDb().remove("bi_report_group_items", [
      eq("group_id", it.group_id),
      eq("report_id", report.id),
    ]);
  const already = await selectOne<ItemRow>("bi_report_group_items", {
    filters: [eq("group_id", g.id), eq("report_id", report.id)],
  });
  if (!already)
    await agentDb().insert("bi_report_group_items", {
      group_id: g.id,
      report_id: report.id,
      added_by: input.requester.userId,
    });
  const from = existing.length
    ? (siblings.find((s) => s.id === existing[0]!.group_id)?.name ?? null)
    : null;
  await recordAudit({
    actor: actor(input),
    action: "reports.report_grouped",
    targetType: "bi_report",
    targetId: report.id,
    summary: `${from ? `Moved "${report.title}" from "${from}" to` : `Added "${report.title}" to`} group "${g.name}".`,
  });
  return { moved: Boolean(existing.length), from };
}

export async function removeReportFromGroup(
  input: { reportId: string; groupId: string } & Ctx,
): Promise<void> {
  const g = await getGroupFor(input.groupId, input);
  const report = await assertCanFile(input.reportId, g, input);
  await agentDb().remove("bi_report_group_items", [
    eq("group_id", g.id),
    eq("report_id", report.id),
  ]);
  await recordAudit({
    actor: actor(input),
    action: "reports.report_ungrouped",
    targetType: "bi_report",
    targetId: report.id,
    summary: `Removed "${report.title}" from group "${g.name}".`,
  });
}

/** Remove a report from every group this viewer may change (used for "ungroup"). */
export async function ungroupReport(input: { reportId: string } & Ctx): Promise<number> {
  const groups = await visibleGroupRows(input, true);
  const items = groups.length
    ? await agentDb().select<ItemRow>("bi_report_group_items", {
        filters: [
          eq("report_id", input.reportId),
          inList(
            "group_id",
            groups.map((g) => g.id),
          ),
        ],
      })
    : [];
  let n = 0;
  for (const it of items) {
    try {
      await removeReportFromGroup({ ...input, groupId: it.group_id });
      n++;
    } catch {
      // not permitted for that group; leave it
    }
  }
  return n;
}

/** Group ids (visible to this viewer) for each report. */
export async function groupIdsByReport(
  c: Pick<Ctx, "requester" | "access">,
  visibleReportIds: Set<string>,
): Promise<Map<string, string[]>> {
  return (await listGroupsFor(c, { visibleReportIds })).membership;
}

export async function getGroupById(id: string, c: Pick<Ctx, "requester">) {
  return getGroupFor(id, c);
}

/** File a just-created report into a group; a failure never undoes the report itself. */
export async function fileNewReport(
  ctx: {
    requester: Requester;
    access: ReportsAccess;
    user: { profile: { full_name: string | null }; email: string };
  },
  reportId: string,
  groupId: string,
) {
  await assignReportToGroup({
    reportId,
    groupId,
    requester: ctx.requester,
    access: ctx.access,
    actorLabel: ctx.user.profile.full_name || ctx.user.email,
  }).catch(() => undefined);
}
