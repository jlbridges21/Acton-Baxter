/**
 * Data Health: freshness of every synced dataset, which reports depend on what, and the
 * mapping/governance gaps that make report numbers incomplete. Admin dashboard + report-level
 * warnings + Dexter's freshness tools all read from here.
 */

import "server-only";

import { agentDb, eq } from "@/lib/agents/store";
import { getJobTreadConfig } from "@/lib/jobtread/client";
import { getSyncEntity } from "@/lib/jobtread/entities";
import { listCustomFields, listSemanticFields } from "@/lib/jobtread/metadata";
import { getEntityOverviews, type EntityOverview } from "@/lib/jobtread/sync-manager";
import {
  assessFreshness,
  reportDependencies,
  summarizeDataHealth,
  type FreshnessInput,
} from "./dependencies";
import { isProductModel, loadModelScopeRules } from "./engine";
import { applyValueMappings, listValueMappings, suggestPrefixes } from "./mappings";
import { parseReportSpec } from "./spec";

const CACHE_MS = 30_000;
let cached: { at: number; value: FreshnessInput[] } | null = null;

export function invalidateDataHealthCache() {
  cached = null;
}

/** Core datasets synced before the Sync Manager existed fall back to the legacy run history. */
export function withLegacyFallback(
  overviews: EntityOverview[],
  legacySuccessAt: string | null,
): FreshnessInput[] {
  return overviews.map((o) => ({
    key: o.key,
    label: o.label,
    status: o.status,
    enabled: o.enabled,
    lastSuccessAt: o.lastSuccessAt ?? (o.kind === "core" ? legacySuccessAt : null),
    lastError: o.lastError,
  }));
}

/** Last successful legacy *full* sync (it refreshes all four core datasets at once). */
async function lastFullSyncAt(): Promise<string | null> {
  const [row] = await agentDb()
    .select<{ finished_at: string | null }>("jt_sync_runs", {
      filters: [eq("status", "succeeded"), eq("kind", "full")],
      order: { col: "started_at", ascending: false },
      limit: 1,
    })
    .catch(() => []);
  return row?.finished_at ?? null;
}

export async function getDatasetFreshness(): Promise<FreshnessInput[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const [overviews, legacy] = await Promise.all([getEntityOverviews(), lastFullSyncAt()]);
  const value = withLegacyFallback(overviews, legacy);
  cached = { at: Date.now(), value };
  return value;
}

/**
 * Phrases in report text widgets that state data facts (counts, import progress, sync status)
 * which go stale. Flagged for review only — user-authored text is never rewritten.
 */
const STATIC_DATA_CLAIM =
  /\b\d+\s+of\s+\d+\b|pending import|budgets? (are|is) (still )?pending|not (been )?(imported|synced) yet|(don'?t|do not|doesn'?t) exist in jobtread( yet)?|no templates carry|as of (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d)|last (successful )?sync(ed)? (on|at)/i;

export function staticDataClaims(spec: {
  widgets: Array<{ id: string; type: string; title?: string; body?: string }>;
}) {
  return spec.widgets.flatMap((w) => {
    if (w.type !== "text" || !w.body) return [];
    const m = STATIC_DATA_CLAIM.exec(w.body);
    if (!m) return [];
    const start = Math.max(0, m.index - 60);
    return [
      { widgetId: w.id, title: w.title ?? "", excerpt: w.body.slice(start, m.index + 80).trim() },
    ];
  });
}

export async function reportDataHealth(spec: Parameters<typeof reportDependencies>[0]) {
  return summarizeDataHealth(reportDependencies(spec), await getDatasetFreshness());
}

type ReportRow = {
  id: string;
  title: string;
  status: string;
  is_template: boolean;
  spec: unknown;
};

/** Admin Data Health dashboard. */
export async function getDataHealthDashboard() {
  invalidateDataHealthCache();
  const [overviews, legacy, reports, fields, semantic, rules, models] = await Promise.all([
    getEntityOverviews(),
    lastFullSyncAt(),
    agentDb().select<ReportRow>("bi_reports", {
      filters: [{ col: "status", op: "eq", value: "active" }],
      limit: 2000,
    }),
    listCustomFields(),
    listSemanticFields(),
    listValueMappings("region").catch(() => []),
    agentDb()
      .select<{ id: string; name: string; description: string | null }>("jt_catalog_models", {
        filters: [{ col: "removed_at", op: "is_null" }],
        limit: 5000,
      })
      .catch(() => []),
  ]);
  const freshness = withLegacyFallback(overviews, legacy);
  const now = Date.now();
  const datasets = overviews.map((o, i) => {
    const f = assessFreshness(freshness[i]!, now);
    return {
      ...o,
      lastSuccessAt: freshness[i]!.lastSuccessAt,
      level: f.level,
      message: f.message,
      coverage:
        o.sourceCount && o.recordsCached !== null
          ? Math.min(1, o.recordsCached / Math.max(1, o.sourceCount))
          : null,
    };
  });

  const affected: Array<{
    id: string;
    title: string;
    datasets: string[];
    warnings: string[];
    widgetsAffected: number;
  }> = [];
  const usage = new Map<string, number>();
  const staticNotes: Array<{
    reportId: string;
    reportTitle: string;
    widgetId: string;
    title: string;
    excerpt: string;
  }> = [];
  for (const r of reports.filter((x) => !x.is_template)) {
    const parsed = parseReportSpec(r.spec);
    if (!parsed.ok) continue;
    for (const claim of staticDataClaims(parsed.spec))
      staticNotes.push({ reportId: r.id, reportTitle: r.title, ...claim });
    const deps = reportDependencies(parsed.spec);
    for (const d of deps.datasets) usage.set(d.entity, (usage.get(d.entity) ?? 0) + 1);
    const health = summarizeDataHealth(deps, freshness, now);
    if (health.status === "warning")
      affected.push({
        id: r.id,
        title: r.title,
        datasets: health.entities.filter((e) => e.message).map((e) => e.label),
        warnings: health.warnings,
        widgetsAffected: Object.keys(health.widgetWarnings).length,
      });
  }

  const scopeRules = await loadModelScopeRules();
  const productModels = models.filter((m) => isProductModel(m, scopeRules));
  const regionRules = rules.filter((r) => r.source_field === "model.name");
  const unmappedModels = productModels.filter((m) => !applyValueMappings(m.name, regionRules));
  const byTarget = new Map<string, { total: number; excluded: number }>();
  for (const f of fields) {
    const t = byTarget.get(f.target_type) ?? { total: 0, excluded: 0 };
    t.total++;
    if (f.category === "excluded") t.excluded++;
    byTarget.set(f.target_type, t);
  }

  return {
    configured: Boolean(getJobTreadConfig()),
    summary: {
      fresh: datasets.filter((d) => d.enabled && d.level === "fresh").length,
      attention: datasets.filter((d) => d.enabled && !["fresh", "running"].includes(d.level))
        .length,
      disabled: datasets.filter((d) => !d.enabled).length,
      reportsAffected: affected.length,
      reportsChecked: reports.filter((x) => !x.is_template).length,
    },
    datasets: datasets.map((d) => ({
      key: d.key,
      label: d.label,
      kind: d.kind,
      sensitivity: d.sensitivity,
      enabled: d.enabled,
      status: d.status,
      level: d.level,
      message: d.message,
      lastSuccessAt: d.lastSuccessAt,
      recordsCached: d.recordsCached,
      sourceCount: d.sourceCount,
      coverage: d.coverage,
      droppedFields: d.droppedFields,
      lastError: d.lastError,
      reportsUsing: usage.get(d.key) ?? 0,
      dependsOn: d.dependsOn.map((k) => getSyncEntity(k)?.label ?? k),
    })),
    reportsAffected: affected.slice(0, 50),
    staticNotes: staticNotes.slice(0, 50),
    mappings: {
      semanticTotal: semantic.length,
      semanticUnmapped: semantic.filter((s) => !s.custom_field_id).length,
      regionRules: regionRules.length,
      productModels: productModels.length,
      modelsWithoutRegion: unmappedModels.length,
      suggestedPrefixes: suggestPrefixes(unmappedModels.map((m) => m.name)).slice(0, 10),
    },
    customFieldTargets: [...byTarget.entries()]
      .map(([target, t]) => ({ target, ...t }))
      .sort((a, b) => a.target.localeCompare(b.target)),
  };
}
