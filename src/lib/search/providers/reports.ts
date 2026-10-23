/**
 * Dexter Reports and report groups — live through the Reports permission model
 * (listReportsFor / listGroupsFor), so a new report or group is searchable immediately and a
 * private report never reaches anyone but its owner, sharees, and admins.
 *
 * Only report metadata is searched (title, description, groups, report type, your relationship
 * to it). Report data is never indexed: viewing re-executes the report with the viewer's own
 * data access.
 */

import "server-only";

import type { ReportRow } from "@/lib/reports/repo";
import type { SearchContext } from "../context";
import type { ProviderHit, SearchProvider } from "../provider";
import { safeId } from "../safety";

const UUID = /^[0-9a-f-]{36}$/i;

const SOURCE_LABEL: Record<string, string> = {
  jobs: "Jobs",
  catalog_models: "Product Library",
  commissions: "Commissions",
};

function reportType(report: ReportRow): string {
  const sources = [...new Set((report.spec?.datasets ?? []).map((d) => d.source))];
  const label = sources.map((s) => SOURCE_LABEL[s] ?? s).join(" + ");
  return label ? `${label} report` : "Report";
}

function relationship(
  r: ReportRow,
  userId: string,
  shareCount: number,
): "Template" | "Yours" | "Company" | "Shared with you" {
  if (r.is_template) return "Template";
  if (r.owner_id === userId) return "Yours";
  if (r.visibility === "company") return "Company";
  return shareCount > 0 ? "Shared with you" : "Company";
}

async function loadReports(ctx: SearchContext) {
  const access = await ctx.reportsAccess();
  if (!access?.canUse) return null;
  const [{ listReportsFor }, { listGroupsFor }] = await Promise.all([
    import("@/lib/reports/repo"),
    import("@/lib/reports/groups"),
  ]);
  const reports = await listReportsFor(ctx.requester, access);
  const visible = new Set(reports.map((r) => r.report.id));
  const { groups, membership } = await listGroupsFor(
    { requester: ctx.requester, access },
    { visibleReportIds: visible },
  );
  return { reports, groups, membership };
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadReports>>>;

function reportHit(
  ctx: SearchContext,
  x: Loaded["reports"][number],
  data: Loaded,
  fields: Set<string>,
): ProviderHit | null {
  const id = safeId(x.report.id, UUID);
  if (!id) return null;
  const groupNames = (data.membership.get(id) ?? [])
    .map((g) => data.groups.find((v) => v.id === g)?.name)
    .filter((n): n is string => Boolean(n));
  const rel = relationship(x.report, ctx.user.id, x.shareCount);
  const type = reportType(x.report);
  const archived = x.report.status === "archived";
  return {
    recordId: id,
    title: x.report.title,
    subtitle: [type, rel, archived ? "Archived" : null].filter(Boolean).join(" · "),
    description: x.report.description || null,
    breadcrumb: ["Reports", ...(groupNames.length ? [groupNames[0]!] : [])],
    url: `/reports/${id}`,
    icon: "bar-chart",
    updatedAt: x.report.updated_at,
    preview: groupNames.length ? [{ label: "Groups", value: groupNames.join(", ") }] : [],
    auth: "record",
    actions: [
      {
        kind: "pin_report",
        label: x.pinned ? "Unpin report" : "Pin report",
        reportId: id,
        pinned: x.pinned,
      },
    ],
    match: {
      title: x.report.title,
      subtitle: type,
      fields: [...(fields.has("groups") ? groupNames : []), fields.has("type") ? type : null, rel],
      keywords: x.report.created_by_agent ? ["dexter"] : [],
      description: fields.has("description") ? x.report.description : null,
    },
    boost: { pinned: x.pinned, recent: Boolean(x.viewedAt) },
  };
}

function groupHit(g: Loaded["groups"][number]): ProviderHit | null {
  const id = safeId(g.id, UUID);
  if (!id || g.archived) return null;
  return {
    recordId: `group:${id}`,
    title: g.name,
    subtitle: `Report group · ${g.scope === "company" ? "Company" : "Personal"} · ${g.reportCount} report${g.reportCount === 1 ? "" : "s"}`,
    description: g.description || null,
    breadcrumb: ["Reports", "Groups"],
    url: `/reports?group=${id}`,
    icon: "folder-kanban",
    auth: "record",
    match: { title: g.name, keywords: ["group", "folder"], description: g.description },
  };
}

export const reportsProvider: SearchProvider = {
  id: "reports",
  category: "reports",
  name: "Dexter Reports",
  icon: "bar-chart",
  sourceSystem: "dexter_reports",
  description: "Saved reports, templates, and report groups you can open.",
  searchableFields: [
    { key: "title", label: "Title", sensitivity: "standard", defaultEnabled: true },
    { key: "description", label: "Description", sensitivity: "standard", defaultEnabled: true },
    { key: "groups", label: "Group names", sensitivity: "standard", defaultEnabled: true },
    { key: "type", label: "Report type", sensitivity: "standard", defaultEnabled: true },
    { key: "data", label: "Report data values", sensitivity: "restricted", defaultEnabled: false },
  ],
  optional: false,
  indexing: "live",
  permissionSummary:
    "Requires Reports access (Dexter access policy). Each report is checked with the Reports permission rules: owner, admins, company visibility, or a share.",
  minQueryLength: 1,
  timeoutMs: 3000,
  async canUse(ctx) {
    return Boolean((await ctx.reportsAccess())?.canUse);
  },
  async availability() {
    return { available: true };
  },
  async search(ctx, input) {
    const data = await loadReports(ctx);
    if (!data) return { hits: [] };
    const hits = [
      ...data.reports.map((x) => reportHit(ctx, x, data, input.fields)),
      ...data.groups.map(groupHit),
    ];
    return { hits: hits.filter((h): h is ProviderHit => h !== null), freshness: { kind: "live" } };
  },
  async lookup(ctx, ids) {
    const data = await loadReports(ctx);
    if (!data) return [];
    const all = new Set(["groups", "type", "description"]);
    return [
      ...data.reports
        .filter((x) => ids.includes(x.report.id))
        .map((x) => reportHit(ctx, x, data, all)),
      ...data.groups.filter((g) => ids.includes(`group:${g.id}`)).map(groupHit),
    ].filter((h): h is ProviderHit => h !== null);
  },
  async emptyState(ctx) {
    const data = await loadReports(ctx);
    if (!data) return [];
    const all = new Set(["groups", "type", "description"]);
    return data.reports
      .filter((x) => x.pinned && x.report.status === "active")
      .slice(0, 6)
      .map((x) => reportHit(ctx, x, data, all))
      .filter((h): h is ProviderHit => h !== null);
  },
};
