/**
 * Dexter's report-organization tools. They call the same group services as the Reports page,
 * so every action is checked against the requester's permissions (never the model's judgment).
 * Bulk moves are two-step: a preview returns a signed token that only works in a *later* turn,
 * after the person has confirmed.
 */

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ReportsAccess } from "@/lib/reports/access";
import type { AgentTool, ToolContext } from "./tools";

async function accessFor(ctx: ToolContext): Promise<ReportsAccess> {
  const { getReportsAccess } = await import("@/lib/reports/access");
  return getReportsAccess(ctx.requester);
}

async function gctx(ctx: ToolContext) {
  return {
    requester: ctx.requester,
    access: await accessFor(ctx),
    actorLabel: `Dexter for ${ctx.requester.label}`,
  };
}

/** Errors become plain data for the model (never thrown past the tool). */
async function guarded<T>(run: () => Promise<T>, summary: (r: T) => string) {
  try {
    const data = await run();
    return { data, logSummary: summary(data) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "That didn't work.";
    return {
      data: { ok: false, problem: message },
      logSummary: `Report organization refused: ${message.slice(0, 80)}`,
    };
  }
}

/** Resolve a group by id or (case-insensitive) name among the groups this person can see. */
async function resolveGroup(ref: string, ctx: ToolContext) {
  const { getGroupById, findGroupByName } = await import("@/lib/reports/groups");
  if (/^[0-9a-f-]{36}$/i.test(ref)) return getGroupById(ref, { requester: ctx.requester });
  const g = await findGroupByName(ref, { requester: ctx.requester });
  if (!g)
    throw new Error(
      `There's no group named "${ref}". List groups, or create it only if the person asked you to.`,
    );
  return g;
}

// ---------------------------------------------------------------------------
// Bulk-move confirmation tokens (stateless, signed, single-use per turn boundary)
// ---------------------------------------------------------------------------
function secret(): string {
  return (
    process.env.REPORTS_ACTION_SECRET ||
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "baxter-dev-only"
  );
}
function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}
export function bulkToken(
  userId: string,
  groupId: string | null,
  reportIds: string[],
  taskId: string,
  issuedAt = Date.now(),
): string {
  const body = Buffer.from(
    JSON.stringify({ u: userId, g: groupId, r: [...reportIds].sort(), t: taskId, at: issuedAt }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}
export function checkBulkToken(
  token: string,
  userId: string,
  groupId: string | null,
  reportIds: string[],
  currentTaskId: string,
): string | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return "Invalid confirmation token. Preview the move again.";
  const expected = sign(body);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig)))
    return "Invalid confirmation token. Preview the move again.";
  const p = JSON.parse(Buffer.from(body, "base64url").toString()) as {
    u: string;
    g: string | null;
    r: string[];
    t: string;
    at: number;
  };
  if (
    p.u !== userId ||
    p.g !== groupId ||
    JSON.stringify(p.r) !== JSON.stringify([...reportIds].sort())
  )
    return "The confirmed move doesn't match this request. Preview it again.";
  if (Date.now() - p.at > 30 * 60_000) return "The preview expired. Preview the move again.";
  if (p.t === currentTaskId)
    return "Show the preview to the person and wait for them to confirm in their next message before moving.";
  return null;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const listGroups: AgentTool = {
  key: "reports_groups",
  label: "List report groups",
  description:
    "The report groups (folders) this person can see, with report counts and how many reports are ungrouped.",
  modelUsage:
    "reports_groups {} — groups (id, name, personal/company, count) visible to the requester, plus the number of ungrouped reports.",
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({}).passthrough(),
  async execute(ctx) {
    return guarded(
      async () => {
        const c = await gctx(ctx);
        const { listReportsFor } = await import("@/lib/reports/repo");
        const { listGroupsFor } = await import("@/lib/reports/groups");
        const reports = (await listReportsFor(c.requester, c.access)).filter(
          (x) => x.report.status === "active" && !x.report.is_template,
        );
        const { groups, membership } = await listGroupsFor(c, {
          visibleReportIds: new Set(reports.map((x) => x.report.id)),
        });
        return {
          groups: groups.map((g) => ({
            id: g.id,
            name: g.name,
            scope: g.scope,
            reports: g.reportCount,
            canManage: g.canManage,
          })),
          ungroupedReports: reports.filter((x) => !(membership.get(x.report.id) ?? []).length)
            .length,
        };
      },
      (r) => `Listed ${r.groups.length} report group(s).`,
    );
  },
};

const createGroupTool: AgentTool = {
  key: "reports_group_create",
  label: "Create a report group",
  description: "Creates a personal report group (or a company group, for Reports managers).",
  modelUsage:
    'reports_group_create {"name": string, "description"?: string, "scope"?: "personal"|"company"} — only when the person asked for the group or clearly agreed to create it. Default personal.',
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({
    name: z.string().trim().min(1).max(60),
    description: z.string().max(300).optional(),
    scope: z.enum(["personal", "company"]).optional(),
  }),
  async execute(ctx, raw) {
    const a = this.args.parse(raw) as {
      name: string;
      description?: string;
      scope?: "personal" | "company";
    };
    return guarded(
      async () => {
        const { createGroup } = await import("@/lib/reports/groups");
        const g = await createGroup({
          ...(await gctx(ctx)),
          name: a.name,
          description: a.description,
          scope: a.scope,
        });
        return { ok: true, group: { id: g.id, name: g.name, scope: g.scope } };
      },
      () => `Created report group "${a.name}".`,
    );
  },
};

const updateGroupTool: AgentTool = {
  key: "reports_group_update",
  label: "Rename or describe a report group",
  description: "Renames a report group or changes its description (owner/manager only).",
  modelUsage:
    'reports_group_update {"group": name or id, "name"?: string, "description"?: string} — rename or describe a group.',
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({
    group: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(60).optional(),
    description: z.string().max(300).optional(),
  }),
  async execute(ctx, raw) {
    const a = this.args.parse(raw) as { group: string; name?: string; description?: string };
    return guarded(
      async () => {
        const g = await resolveGroup(a.group, ctx);
        const { updateGroup } = await import("@/lib/reports/groups");
        const u = await updateGroup({
          ...(await gctx(ctx)),
          groupId: g.id,
          patch: { name: a.name, description: a.description },
        });
        return { ok: true, group: { id: u.id, name: u.name } };
      },
      () => `Updated report group "${a.group}".`,
    );
  },
};

const groupReports: AgentTool = {
  key: "reports_group_reports",
  label: "List reports in a group",
  description: 'Reports in one group, or the ungrouped ones ("ungrouped").',
  modelUsage:
    'reports_group_reports {"group": name, id, or "ungrouped", "search"?: string} — reports (id, title, mine/shared, canEdit) the requester can open in that group.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({
    group: z.string().trim().min(1).max(80),
    search: z.string().trim().max(80).optional(),
  }),
  async execute(ctx, raw) {
    const a = this.args.parse(raw) as { group: string; search?: string };
    return guarded(
      async () => {
        const c = await gctx(ctx);
        const { listReportsFor } = await import("@/lib/reports/repo");
        const { listGroupsFor } = await import("@/lib/reports/groups");
        const reports = (await listReportsFor(c.requester, c.access)).filter(
          (x) => x.report.status === "active" && !x.report.is_template,
        );
        const { membership } = await listGroupsFor(c, {
          visibleReportIds: new Set(reports.map((x) => x.report.id)),
        });
        const ungrouped = a.group.trim().toLowerCase() === "ungrouped";
        const g = ungrouped ? null : await resolveGroup(a.group, ctx);
        const q = a.search?.toLowerCase();
        const items = reports
          .filter((x) =>
            ungrouped
              ? !(membership.get(x.report.id) ?? []).length
              : (membership.get(x.report.id) ?? []).includes(g!.id),
          )
          .filter((x) => !q || x.report.title.toLowerCase().includes(q))
          .slice(0, 60)
          .map((x) => ({
            id: x.report.id,
            title: x.report.title,
            mine: x.report.owner_id === c.requester.userId,
            canEdit: x.permission.canEdit,
            url: `/reports/${x.report.id}`,
          }));
        return { group: ungrouped ? "Ungrouped" : g!.name, reports: items };
      },
      (r) => `Listed ${r.reports.length} report(s) in ${r.group}.`,
    );
  },
};

const assignTool: AgentTool = {
  key: "reports_group_assign",
  label: "Move a report into a group",
  description:
    "Files one report into a group (moving it out of its current group of the same kind). Never changes who can see the report.",
  modelUsage:
    'reports_group_assign {"reportId", "group": name or id, "createIfMissing"?: boolean} — file ONE report. Use createIfMissing only when the person asked for that group by name. For several reports use reports_group_bulk_move.',
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({
    reportId: z.string().uuid(),
    group: z.string().trim().min(1).max(80),
    createIfMissing: z.boolean().optional(),
  }),
  async execute(ctx, raw) {
    const a = this.args.parse(raw) as {
      reportId: string;
      group: string;
      createIfMissing?: boolean;
    };
    return guarded(
      async () => {
        const c = await gctx(ctx);
        const { assignReportToGroup, createGroup, findGroupByName } =
          await import("@/lib/reports/groups");
        let g = /^[0-9a-f-]{36}$/i.test(a.group)
          ? await resolveGroup(a.group, ctx)
          : await findGroupByName(a.group, c);
        let created = false;
        if (!g) {
          if (!a.createIfMissing)
            throw new Error(`There's no group named "${a.group}". Ask whether to create it.`);
          g = await createGroup({ ...c, name: a.group });
          created = true;
        }
        const r = await assignReportToGroup({ ...c, reportId: a.reportId, groupId: g.id });
        return { ok: true, group: g.name, createdGroup: created, movedFrom: r.from };
      },
      (r) =>
        "group" in r ? `Filed a report in "${(r as { group: string }).group}".` : "Filing refused.",
    );
  },
};

const removeTool: AgentTool = {
  key: "reports_group_remove",
  label: "Take a report out of a group",
  description:
    "Removes a report from one group (or from all of the person's groups), making it ungrouped.",
  modelUsage:
    'reports_group_remove {"reportId", "group"?: name or id} — omit group to ungroup completely.',
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({
    reportId: z.string().uuid(),
    group: z.string().trim().min(1).max(80).optional(),
  }),
  async execute(ctx, raw) {
    const a = this.args.parse(raw) as { reportId: string; group?: string };
    return guarded(
      async () => {
        const c = await gctx(ctx);
        const { removeReportFromGroup, ungroupReport } = await import("@/lib/reports/groups");
        if (a.group) {
          const g = await resolveGroup(a.group, ctx);
          await removeReportFromGroup({ ...c, reportId: a.reportId, groupId: g.id });
          return { ok: true, removedFrom: g.name };
        }
        return {
          ok: true,
          removedFrom: `${await ungroupReport({ ...c, reportId: a.reportId })} group(s)`,
        };
      },
      () => "Removed a report from a group.",
    );
  },
};

const bulkMoveTool: AgentTool = {
  key: "reports_group_bulk_move",
  label: "Move several reports into a group",
  description:
    "Two-step bulk move: first a preview, then (after the person confirms in a later message) the move.",
  modelUsage:
    'reports_group_bulk_move {"reportIds": [ids], "group": name or id, "confirmationToken"?: string} — WITHOUT a token returns a preview and a token: show the list and ask the person to confirm. Only after they confirm in their next message, call again with the same reportIds, group, and the token.',
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({
    reportIds: z.array(z.string().uuid()).min(1).max(50),
    group: z.string().trim().min(1).max(80),
    confirmationToken: z.string().max(2000).optional(),
  }),
  async execute(ctx, raw) {
    const a = this.args.parse(raw) as {
      reportIds: string[];
      group: string;
      confirmationToken?: string;
    };
    return guarded(
      async () => {
        const c = await gctx(ctx);
        const g = await resolveGroup(a.group, ctx);
        const { loadReportFor } = await import("@/lib/reports/repo");
        const userId = c.requester.userId ?? "";
        if (!a.confirmationToken) {
          const preview = [];
          for (const id of a.reportIds) {
            try {
              const { report, permission } = await loadReportFor(id, c.requester, c.access);
              preview.push({
                id,
                title: report.title,
                allowed: g.scope === "personal" || permission.canEdit,
              });
            } catch {
              preview.push({ id, title: "(not available to you)", allowed: false });
            }
          }
          const ids = preview.filter((p) => p.allowed).map((p) => p.id);
          return {
            preview: true,
            group: g.name,
            willMove: preview.filter((p) => p.allowed).map((p) => p.title),
            skipped: preview.filter((p) => !p.allowed).map((p) => p.title),
            confirmationToken: ids.length ? bulkToken(userId, g.id, ids, ctx.task.id) : null,
            reportIds: ids,
            instruction:
              "Show this list and ask the person to confirm. Do not move anything until they confirm.",
          };
        }
        const problem = checkBulkToken(a.confirmationToken, userId, g.id, a.reportIds, ctx.task.id);
        if (problem) throw new Error(problem);
        const { assignReportToGroup } = await import("@/lib/reports/groups");
        const moved: string[] = [];
        const failed: string[] = [];
        for (const id of a.reportIds) {
          try {
            await assignReportToGroup({ ...c, reportId: id, groupId: g.id });
            moved.push(id);
          } catch (error) {
            failed.push(`${id}: ${error instanceof Error ? error.message : "failed"}`);
          }
        }
        return { preview: false, group: g.name, moved: moved.length, failed };
      },
      (r) =>
        (r as { preview?: boolean }).preview
          ? "Previewed a bulk report move."
          : "Moved reports into a group.",
    );
  },
};

/** Keyword hints mapping report content to the kind of group it usually belongs in. */
const GROUP_HINTS: Array<{ words: RegExp; groupWords: RegExp; label: string }> = [
  {
    words: /(commission|sales|salesperson|sales_rep|lead|revenue)/i,
    groupWords: /(sales|commission|revenue)/i,
    label: "Sales",
  },
  { words: /(design|drafter|handoff|floorplan)/i, groupWords: /design/i, label: "Design" },
  {
    words: /(model|product|catalog|catalog_models)/i,
    groupWords: /(product|model|catalog)/i,
    label: "Product Library",
  },
  { words: /(permit)/i, groupWords: /permit/i, label: "Permitting" },
  {
    words: /(milestone|schedule|project_manager|workload|active project|phase)/i,
    groupWords: /(operation|project|pm)/i,
    label: "Operations / Project Management",
  },
  {
    words: /(profit|margin|cost|price|budget)/i,
    groupWords: /(financ|account|profit)/i,
    label: "Finance",
  },
];

const suggestTool: AgentTool = {
  key: "reports_group_suggest",
  label: "Suggest groups for reports",
  description:
    "Proposes a group for each ungrouped report based on what it analyses. Proposes only — nothing is moved.",
  modelUsage:
    'reports_group_suggest {"reportIds"?: [ids]} — for ungrouped reports (or the given ones): likely existing group, or "ambiguous"/"no match". Present the proposal; if the person agrees, use reports_group_bulk_move (preview first). Never move on an ambiguous guess.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({ reportIds: z.array(z.string().uuid()).max(50).optional() }),
  async execute(ctx, raw) {
    const a = this.args.parse(raw) as { reportIds?: string[] };
    return guarded(
      async () => {
        const c = await gctx(ctx);
        const { listReportsFor } = await import("@/lib/reports/repo");
        const { listGroupsFor } = await import("@/lib/reports/groups");
        const { collectFieldRefs } = await import("@/lib/reports/spec");
        const reports = (await listReportsFor(c.requester, c.access)).filter(
          (x) => x.report.status === "active" && !x.report.is_template,
        );
        const { groups, membership } = await listGroupsFor(c, {
          visibleReportIds: new Set(reports.map((x) => x.report.id)),
        });
        const targets = reports
          .filter((x) =>
            a.reportIds
              ? a.reportIds.includes(x.report.id)
              : !(membership.get(x.report.id) ?? []).length,
          )
          .slice(0, 50);
        return {
          proposals: targets.map((x) => {
            const text = `${x.report.title} ${x.report.description} ${x.report.spec.datasets.map((d) => d.source).join(" ")} ${collectFieldRefs(x.report.spec).join(" ")}`;
            const kinds = GROUP_HINTS.filter((h) => h.words.test(text));
            const candidates = groups.filter((g) => kinds.some((k) => k.groupWords.test(g.name)));
            return {
              reportId: x.report.id,
              title: x.report.title,
              proposal: candidates.length === 1 ? candidates[0]!.name : null,
              confidence:
                candidates.length === 1 && kinds.length === 1
                  ? "likely"
                  : candidates.length
                    ? "ambiguous"
                    : "no match",
              options: candidates.map((g) => g.name),
              newGroupIdea: candidates.length ? null : (kinds[0]?.label ?? null),
            };
          }),
          note: "Ask before moving. For ambiguous ones, ask which group; for no match, suggest the newGroupIdea or leave ungrouped.",
        };
      },
      (r) => `Proposed groups for ${r.proposals.length} report(s).`,
    );
  },
};

export const REPORT_GROUP_TOOLS: AgentTool[] = [
  listGroups,
  createGroupTool,
  updateGroupTool,
  groupReports,
  assignTool,
  removeTool,
  bulkMoveTool,
  suggestTool,
];
export const REPORT_GROUP_TOOL_KEYS = REPORT_GROUP_TOOLS.map((t) => t.key);
