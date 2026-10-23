/**
 * Saved reports: persistence, revisions, sharing, and per-report permissions.
 *
 * A report stores a definition (spec), never data. Viewing re-executes it with the
 * viewer's own data access, so sharing a report never shares restricted values.
 *
 * Who may do what:
 *   view   — owner, admins, anyone when visibility = company, explicit shares (view/edit)
 *   edit   — owner, admins, edit shares; templates: admins and Dexter managers
 *   share / transfer / delete — owner or admin
 */

import "server-only";

import { NotFoundError, ValidationError, AuthorizationError } from "@/lib/errors";
import { agentDb, eq, inList, isUniqueViolation, selectOne } from "@/lib/agents/store";
import type { Requester } from "@/lib/agents/types";
import type { ReportsAccess } from "./access";
import { diffSpecs } from "./ops";
import type { ReportPermission } from "./repo-types";
import { parseReportSpec, type ReportSpec } from "./spec";
import { REPORT_TEMPLATES } from "./templates";

export type ReportRow = {
  id: string;
  title: string;
  description: string;
  owner_id: string | null;
  visibility: "private" | "shared" | "company";
  is_template: boolean;
  template_key: string | null;
  status: "active" | "archived";
  spec: ReportSpec;
  version: number;
  created_by_agent: boolean;
  last_data_refresh_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RevisionRow = {
  id: string;
  report_id: string;
  version: number;
  spec: ReportSpec;
  title: string;
  change_summary: string | null;
  author_id: string | null;
  author_kind: "user" | "dexter" | "system";
  task_id: string | null;
  created_at: string;
};

export type ShareRow = {
  id: string;
  report_id: string;
  principal_type: "user" | "department" | "role";
  principal_value: string;
  permission: "view" | "edit";
  created_by: string | null;
  created_at: string;
};

export type { ReportPermission };

let templatesSeeded: Promise<void> | null = null;

export function resetReportTemplatesForTests() {
  templatesSeeded = null;
}

/** Create missing starter templates once per server instance (never overwrites edits). */
export function ensureReportTemplates(): Promise<void> {
  templatesSeeded ??= (async () => {
    for (const t of REPORT_TEMPLATES) {
      const existing = await selectOne<ReportRow>("bi_reports", {
        filters: [eq("template_key", t.key)],
      });
      if (existing) continue;
      try {
        const [row] = await agentDb().insert<ReportRow>("bi_reports", {
          title: t.spec.title,
          description: t.spec.description,
          owner_id: null,
          visibility: "company",
          is_template: true,
          template_key: t.key,
          status: "active",
          spec: t.spec,
          version: 1,
          created_by_agent: false,
        });
        await agentDb().insert("bi_report_revisions", {
          report_id: row!.id,
          version: 1,
          spec: t.spec,
          title: t.spec.title,
          change_summary: "Starter template",
          author_id: null,
          author_kind: "system",
          task_id: null,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
  })().catch((error) => {
    templatesSeeded = null;
    throw error;
  });
  return templatesSeeded;
}

export async function listShares(reportId: string): Promise<ShareRow[]> {
  return agentDb().select<ShareRow>("bi_report_shares", {
    filters: [eq("report_id", reportId)],
    order: { col: "created_at" },
  });
}

function shareApplies(share: ShareRow, requester: Requester): boolean {
  return (
    (share.principal_type === "user" && share.principal_value === requester.userId) ||
    (share.principal_type === "role" && share.principal_value === requester.role) ||
    (share.principal_type === "department" &&
      requester.departmentId != null &&
      share.principal_value === requester.departmentId)
  );
}

export function permissionFor(
  report: ReportRow,
  requester: Requester,
  access: ReportsAccess,
  shares: ShareRow[],
): ReportPermission {
  if (!access.canUse) return { canView: false, canEdit: false, canShare: false, canDelete: false };
  const isOwner = report.owner_id !== null && report.owner_id === requester.userId;
  const applicable = shares.filter((s) => shareApplies(s, requester));
  const editShare = applicable.some((s) => s.permission === "edit");
  if (report.is_template) {
    const manage = access.isAdmin || access.canManage;
    return { canView: true, canEdit: manage, canShare: false, canDelete: access.isAdmin };
  }
  const canView =
    isOwner || access.isAdmin || report.visibility === "company" || applicable.length > 0;
  return {
    canView,
    canEdit: isOwner || access.isAdmin || editShare,
    canShare: isOwner || access.isAdmin,
    canDelete: isOwner || access.isAdmin,
  };
}

export async function getReport(id: string): Promise<ReportRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return selectOne<ReportRow>("bi_reports", { filters: [eq("id", id)] });
}

/** Load a report the requester may view, or throw NotFound (same error for missing/forbidden). */
export async function loadReportFor(id: string, requester: Requester, access: ReportsAccess) {
  await ensureReportTemplates();
  const report = await getReport(id);
  if (!report) throw new NotFoundError("Report not found");
  const shares = await listShares(id);
  const permission = permissionFor(report, requester, access, shares);
  if (!permission.canView) throw new NotFoundError("Report not found");
  return { report, permission, shares };
}

export async function listReportsFor(requester: Requester, access: ReportsAccess) {
  await ensureReportTemplates();
  const db = agentDb();
  const all = await db.select<ReportRow>("bi_reports", {
    order: { col: "updated_at", ascending: false },
    limit: 1000,
  });
  const shares = await db.select<ShareRow>("bi_report_shares", {
    filters: all.length
      ? [
          inList(
            "report_id",
            all.map((r) => r.id),
          ),
        ]
      : [],
    limit: 5000,
  });
  const sharesBy = new Map<string, ShareRow[]>();
  for (const s of shares) sharesBy.set(s.report_id, [...(sharesBy.get(s.report_id) ?? []), s]);
  const views = requester.userId
    ? await db.select<{ report_id: string; viewed_at: string }>("bi_report_views", {
        filters: [eq("user_id", requester.userId)],
      })
    : [];
  const viewedAt = new Map(views.map((v) => [v.report_id, v.viewed_at]));
  const pins = requester.userId
    ? await db.select<{ report_id: string }>("bi_report_pins", {
        filters: [eq("user_id", requester.userId)],
      })
    : [];
  const pinned = new Set(pins.map((p) => p.report_id));
  return all
    .map((r) => ({
      report: r,
      permission: permissionFor(r, requester, access, sharesBy.get(r.id) ?? []),
      viewedAt: viewedAt.get(r.id) ?? null,
      pinned: pinned.has(r.id),
      shareCount: (sharesBy.get(r.id) ?? []).length,
    }))
    .filter((x) => x.permission.canView);
}

function assertValid(spec: unknown): ReportSpec {
  const parsed = parseReportSpec(spec);
  if (!parsed.ok) {
    throw new ValidationError(
      `The report definition isn't valid: ${parsed.issues.map((i) => `${i.path || "report"} — ${i.message}`).join("; ")}`,
    );
  }
  return parsed.spec;
}

export async function createReport(input: {
  spec: unknown;
  ownerId: string | null;
  authorKind: RevisionRow["author_kind"];
  taskId?: string | null;
  summary?: string;
}): Promise<ReportRow> {
  const spec = assertValid(input.spec);
  const [row] = await agentDb().insert<ReportRow>("bi_reports", {
    title: spec.title,
    description: spec.description,
    owner_id: input.ownerId,
    visibility: "private",
    is_template: false,
    template_key: null,
    status: "active",
    spec,
    version: 1,
    created_by_agent: input.authorKind === "dexter",
  });
  await agentDb().insert("bi_report_revisions", {
    report_id: row!.id,
    version: 1,
    spec,
    title: spec.title,
    change_summary: input.summary ?? "Created",
    author_id: input.ownerId,
    author_kind: input.authorKind,
    task_id: input.taskId ?? null,
  });
  return row!;
}

/**
 * Save a new version. `expectedVersion` guards against overwriting someone else's change
 * (optimistic concurrency); pass the version the editor started from.
 */
export async function saveReportVersion(input: {
  report: ReportRow;
  spec: unknown;
  authorId: string | null;
  authorKind: RevisionRow["author_kind"];
  summary?: string | null;
  taskId?: string | null;
  expectedVersion?: number;
}): Promise<{ report: ReportRow; changes: string[] }> {
  const spec = assertValid(input.spec);
  if (input.expectedVersion !== undefined && input.expectedVersion !== input.report.version) {
    throw new ValidationError(
      "This report changed since you opened it. Reload to see the latest version.",
    );
  }
  const changes = diffSpecs(input.report.spec, spec);
  if (changes.length === 0) return { report: input.report, changes };
  const nextVersion = input.report.version + 1;
  const [updated] = await agentDb().update<ReportRow>(
    "bi_reports",
    [eq("id", input.report.id), eq("version", input.report.version)],
    { spec, title: spec.title, description: spec.description, version: nextVersion },
  );
  if (!updated)
    throw new ValidationError(
      "This report was just changed by someone else. Reload and try again.",
    );
  await agentDb().insert("bi_report_revisions", {
    report_id: input.report.id,
    version: nextVersion,
    spec,
    title: spec.title,
    change_summary: (input.summary || changes.slice(0, 4).join("; ")).slice(0, 500),
    author_id: input.authorId,
    author_kind: input.authorKind,
    task_id: input.taskId ?? null,
  });
  return { report: updated, changes };
}

export async function listRevisions(reportId: string): Promise<RevisionRow[]> {
  return agentDb().select<RevisionRow>("bi_report_revisions", {
    filters: [eq("report_id", reportId)],
    order: { col: "version", ascending: false },
    limit: 200,
  });
}

/** Restore = copy an old version forward as a new version (history is never rewritten). */
export async function restoreRevision(report: ReportRow, version: number, authorId: string | null) {
  const [rev] = await agentDb().select<RevisionRow>("bi_report_revisions", {
    filters: [eq("report_id", report.id), eq("version", version)],
  });
  if (!rev) throw new NotFoundError("Version not found");
  return saveReportVersion({
    report,
    spec: rev.spec,
    authorId,
    authorKind: "user",
    summary: `Restored version ${version}`,
  });
}

export async function duplicateReport(report: ReportRow, ownerId: string | null, title?: string) {
  const spec = {
    ...report.spec,
    title: title ?? (report.is_template ? report.spec.title : `${report.spec.title} (copy)`),
  };
  return createReport({
    spec,
    ownerId,
    authorKind: "user",
    summary: report.is_template
      ? `Created from the ${report.spec.title} template`
      : `Duplicated from "${report.title}"`,
  });
}

export async function updateReportMeta(
  report: ReportRow,
  patch: Partial<Pick<ReportRow, "visibility" | "status" | "owner_id" | "last_data_refresh_at">>,
) {
  const [updated] = await agentDb().update<ReportRow>("bi_reports", [eq("id", report.id)], patch);
  return updated!;
}

export async function deleteReport(report: ReportRow) {
  if (report.is_template)
    throw new AuthorizationError("Templates can be archived but not deleted.");
  await agentDb().remove("bi_reports", [eq("id", report.id)]);
  // Memory store has no cascades; Supabase cascades revisions/shares/views/messages.
  for (const t of [
    "bi_report_revisions",
    "bi_report_shares",
    "bi_report_views",
    "bi_report_pins",
    "bi_report_chat_messages",
  ]) {
    await agentDb().remove(t, [eq("report_id", report.id)]);
  }
}

export async function addShare(input: Omit<ShareRow, "id" | "created_at">): Promise<void> {
  await agentDb().upsert("bi_report_shares", input, [
    "report_id",
    "principal_type",
    "principal_value",
  ]);
}

export async function removeShare(reportId: string, shareId: string): Promise<void> {
  await agentDb().remove("bi_report_shares", [eq("id", shareId), eq("report_id", reportId)]);
}

export async function recordView(reportId: string, userId: string | null): Promise<void> {
  if (!userId) return;
  await agentDb().upsert(
    "bi_report_views",
    { report_id: reportId, user_id: userId, viewed_at: new Date().toISOString() },
    ["report_id", "user_id"],
  );
}

export async function isPinned(reportId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  return Boolean(
    await selectOne("bi_report_pins", {
      filters: [eq("report_id", reportId), eq("user_id", userId)],
    }),
  );
}

export async function setPinned(reportId: string, userId: string, pinned: boolean): Promise<void> {
  if (pinned)
    await agentDb().upsert("bi_report_pins", { report_id: reportId, user_id: userId }, [
      "report_id",
      "user_id",
    ]);
  else await agentDb().remove("bi_report_pins", [eq("report_id", reportId), eq("user_id", userId)]);
}

export async function recordExecution(input: {
  reportId: string | null;
  userId: string | null;
  kind: "view" | "drilldown" | "export" | "dexter_tool";
  durationMs: number;
  restrictedWidgets?: number;
  liveRequests?: number;
}): Promise<void> {
  try {
    await agentDb().insert("bi_report_executions", {
      report_id: input.reportId,
      user_id: input.userId,
      kind: input.kind,
      rows_scanned: 0,
      live_api_requests: input.liveRequests ?? 0,
      duration_ms: input.durationMs,
      restricted_widgets: input.restrictedWidgets ?? 0,
    });
  } catch {
    // Usage metrics are best-effort.
  }
}

export type ChatMessageRow = {
  id: string;
  report_id: string | null;
  user_id: string;
  role: "user" | "dexter";
  content: string;
  task_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export async function listChatMessages(
  userId: string,
  reportId: string | null,
  limit = 40,
): Promise<ChatMessageRow[]> {
  const rows = await agentDb().select<ChatMessageRow>("bi_report_chat_messages", {
    filters: [
      eq("user_id", userId),
      reportId ? eq("report_id", reportId) : { col: "report_id", op: "is_null" },
    ],
    order: { col: "created_at", ascending: false },
    limit,
  });
  return rows.reverse();
}

export async function appendChatMessage(
  input: Omit<ChatMessageRow, "id" | "created_at">,
): Promise<ChatMessageRow> {
  const [row] = await agentDb().insert<ChatMessageRow>("bi_report_chat_messages", input);
  return row!;
}

/** Move an unsaved conversation (report_id null) onto the report Dexter just created. */
export async function attachChatToReport(userId: string, reportId: string): Promise<void> {
  await agentDb().update(
    "bi_report_chat_messages",
    [eq("user_id", userId), { col: "report_id", op: "is_null" }],
    { report_id: reportId },
  );
}
