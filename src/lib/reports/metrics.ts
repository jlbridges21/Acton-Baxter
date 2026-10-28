/**
 * Metric Library: shared calculated fields (calc:<key>) reusable in any report.
 *
 *   company  canonical company metrics — anyone can use them; only Reports managers
 *            (Dexter "manage" access or admins) create, edit, or archive them
 *   private  the owner's own metrics — usable in any report (the definition holds no data;
 *            viewers still need access to every field it reads), editable by the owner
 *
 * Every save is validated against the live field catalog and versioned
 * (bi_metric_versions); archiving keeps history and leaves reports with a clear message.
 */

import "server-only";

import { agentDb, eq, selectOne } from "@/lib/agents/store";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import type { ReportsAccess } from "./access";
import { extendCatalogWithCalcs, type CalcCatalog } from "./calculations";
import { getFieldCatalog } from "./fields";
import { listCompanyRelationships } from "./relationship-store";
import { extendCatalogWithRelationships, type RelCatalog } from "./report-relationships";
import { calculationSchema, type CalculationSpec, type ReportSpec } from "./spec";

export type MetricRow = {
  id: string;
  key: string;
  definition: CalculationSpec;
  visibility: "company" | "private";
  owner_id: string | null;
  version: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MetricVersionRow = {
  id: string;
  metric_id: string;
  version: number;
  definition: CalculationSpec;
  visibility: string;
  change_summary: string | null;
  author_id: string | null;
  author_kind: "user" | "dexter" | "system";
  created_at: string;
};

let cache: { at: number; rows: MetricRow[] } | null = null;

export function invalidateMetricLibrary() {
  cache = null;
}

/** Active library metrics (without the table — before migration 079 — the library is empty). */
export async function listLibraryMetrics(
  opts: { includeArchived?: boolean } = {},
): Promise<MetricRow[]> {
  if (!opts.includeArchived && cache && Date.now() - cache.at < 30_000) return cache.rows;
  const rows = await agentDb()
    .select<MetricRow>("bi_metrics", { order: { col: "key" }, limit: 2000 })
    .catch(() => [] as MetricRow[]);
  const parsed = rows.flatMap((r) => {
    const d = calculationSchema.safeParse(r.definition);
    return d.success ? [{ ...r, definition: d.data }] : [];
  });
  const active = parsed.filter((r) => !r.archived_at);
  if (!opts.includeArchived) cache = { at: Date.now(), rows: active };
  return opts.includeArchived ? parsed : active;
}

/**
 * The field catalog for a report: approved related fields, company and report relationships,
 * then Metric Library and report calculations (calculations can use related fields and
 * rollups through those relationships).
 */
export async function catalogFor(
  spec?: Partial<Pick<ReportSpec, "calculations" | "relationships">>,
): Promise<CalcCatalog & RelCatalog> {
  const [base, library, company] = await Promise.all([
    getFieldCatalog(),
    listLibraryMetrics(),
    listCompanyRelationships(),
  ]);
  const related = extendCatalogWithRelationships(base, [
    ...company.map((r) => ({ spec: r.definition, origin: "company" as const })),
    ...(spec?.relationships ?? []).map((r) => ({ spec: r, origin: "report" as const })),
  ]);
  return extendCatalogWithCalcs(related, [
    ...library.map((m) => ({ spec: m.definition, origin: "library" as const })),
    ...(spec?.calculations ?? []).map((c) => ({ spec: c, origin: "report" as const })),
  ]) as CalcCatalog & RelCatalog;
}

export function canEditMetric(
  access: ReportsAccess,
  userId: string | null,
  m: Pick<MetricRow, "visibility" | "owner_id">,
): boolean {
  if (access.isAdmin || access.canManage) return true;
  return m.visibility === "private" && !!userId && m.owner_id === userId;
}

/** Validate a definition against the catalog (and the rest of the library). */
export async function validateMetricDefinition(def: CalculationSpec): Promise<string | null> {
  const [fields, library, company] = await Promise.all([
    getFieldCatalog(),
    listLibraryMetrics(),
    listCompanyRelationships(),
  ]);
  const base = extendCatalogWithRelationships(
    fields,
    company.map((r) => ({ spec: r.definition, origin: "company" as const })),
  );
  const catalog = extendCatalogWithCalcs(base, [
    ...library
      .filter((m) => m.key !== def.key)
      .map((m) => ({ spec: m.definition, origin: "library" as const })),
    { spec: def, origin: "library" },
  ]);
  return catalog.calcErrors.get(`calc:${def.key}`) ?? null;
}

export async function getMetric(key: string): Promise<MetricRow | null> {
  const row = await selectOne<MetricRow>("bi_metrics", { filters: [eq("key", key)] }).catch(
    () => null,
  );
  return row;
}

export async function saveMetric(input: {
  definition: unknown;
  visibility: "company" | "private";
  access: ReportsAccess;
  userId: string | null;
  authorKind: MetricVersionRow["author_kind"];
  summary?: string;
  /** Required when updating: the version the editor started from. */
  expectedVersion?: number;
}): Promise<MetricRow> {
  const parsed = calculationSchema.safeParse(input.definition);
  if (!parsed.success)
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const def = parsed.data;
  if (input.visibility === "company" && !(input.access.isAdmin || input.access.canManage))
    throw new AuthorizationError(
      "Only Reports managers can publish company metrics. Save it as a private metric (or in the report) instead.",
    );
  const problem = await validateMetricDefinition(def);
  if (problem) throw new ValidationError(problem);
  const existing = await getMetric(def.key);
  const db = agentDb();
  let row: MetricRow;
  if (existing) {
    if (!canEditMetric(input.access, input.userId, existing))
      throw new AuthorizationError(
        existing.visibility === "company"
          ? `"${def.label}" is a company metric; only Reports managers can change it. Use a different key for your own version.`
          : `calc:${def.key} belongs to someone else. Use a different key.`,
      );
    if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version)
      throw new ValidationError("This metric changed since you opened it. Reload and try again.");
    const [updated] = await db.update<MetricRow>(
      "bi_metrics",
      [eq("id", existing.id), eq("version", existing.version)],
      {
        definition: def,
        visibility: input.visibility,
        version: existing.version + 1,
        archived_at: null,
        updated_at: new Date().toISOString(),
      },
    );
    if (!updated) throw new ValidationError("This metric was just changed. Reload and try again.");
    row = updated;
  } else {
    const [created] = await db.insert<MetricRow>("bi_metrics", {
      key: def.key,
      definition: def,
      visibility: input.visibility,
      owner_id: input.userId,
      version: 1,
    });
    row = created!;
  }
  await db.insert("bi_metric_versions", {
    metric_id: row.id,
    version: row.version,
    definition: def,
    visibility: input.visibility,
    change_summary: (input.summary ?? (existing ? "Updated" : "Created")).slice(0, 300),
    author_id: input.userId,
    author_kind: input.authorKind,
  });
  invalidateMetricLibrary();
  return { ...row, definition: def };
}

export async function archiveMetric(input: {
  key: string;
  archived: boolean;
  access: ReportsAccess;
  userId: string | null;
}): Promise<MetricRow> {
  const existing = await getMetric(input.key);
  if (!existing) throw new NotFoundError("Metric not found");
  if (!canEditMetric(input.access, input.userId, existing))
    throw new AuthorizationError("You can't change this metric.");
  const [row] = await agentDb().update<MetricRow>("bi_metrics", [eq("id", existing.id)], {
    archived_at: input.archived ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  invalidateMetricLibrary();
  return row!;
}

export async function listMetricVersions(metricId: string): Promise<MetricVersionRow[]> {
  return agentDb().select<MetricVersionRow>("bi_metric_versions", {
    filters: [eq("metric_id", metricId)],
    order: { col: "version", ascending: false },
    limit: 100,
  });
}

/** Reports and library metrics that use calc:<key> (for "used by" and safe archiving). */
export async function metricUsage(key: string): Promise<{
  reports: Array<{ id: string; title: string }>;
  metrics: string[];
}> {
  const ref = `calc:${key}`;
  const [reports, library] = await Promise.all([
    agentDb().select<{ id: string; title: string; spec: unknown; status: string }>("bi_reports", {
      columns: "id, title, spec, status",
      limit: 5000,
    }),
    listLibraryMetrics(),
  ]);
  const pattern = new RegExp(`${ref}(?![a-z0-9_])`);
  const uses = (v: unknown) => pattern.test(JSON.stringify(v));
  return {
    reports: reports.filter((r) => uses(r.spec)).map((r) => ({ id: r.id, title: r.title })),
    metrics: library.filter((m) => m.key !== key && uses(m.definition)).map((m) => m.key),
  };
}
