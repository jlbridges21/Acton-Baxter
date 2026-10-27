/**
 * Report dependency model: which synced JobTread datasets each report and widget reads, and
 * whether that data is fresh enough to trust. Derived from the spec on every call (never
 * stored), so it can't drift from what the engine actually executes.
 */

import type { SyncEntityKey } from "@/lib/jobtread/entities";
import type { DataHealthSummary, FreshnessLevel } from "./result-types";
import { SOURCE_REGISTRY } from "./sources";
import {
  collectFieldRefs,
  type Condition,
  type ReportSource,
  type ReportSpec,
  type WidgetSpec,
} from "./spec";

/** Job fields computed from cached financial documents (JOB_FINANCIAL_FIELDS minus actualCost). */
const DOCUMENT_FIELD = /^job\.(order[A-Z]\w*|invoicedTotal|amountPaid|balanceDue|lastInvoiceDate)$/;
const LIVE_WIDGETS = new Set<WidgetSpec["type"]>(["milestones", "documents", "project_header"]);

export type DatasetDependency = {
  entity: SyncEntityKey;
  reasons: string[];
  widgets: string[];
};

export type ReportDependencies = {
  datasets: DatasetDependency[];
  /** Widgets that read JobTread live per project (not the cache). */
  liveWidgets: string[];
  /** Widgets that use Baxter business rules (commission rates, assignments). */
  ruleWidgets: string[];
  /** Widgets that use admin value mappings (e.g. model region). */
  mappingWidgets: string[];
};

function widgetRefs(w: WidgetSpec): string[] {
  const refs: string[] = [];
  const add = (f?: string) => f && refs.push(f);
  const conds = (cs: Condition[]) => cs.forEach((c) => add(c.field));
  if (w.type === "kpi") {
    add(w.metric.field);
    conds(w.filters);
  } else if (w.type === "chart") {
    [w.groupBy, w.seriesBy, w.x, w.y, w.metric.field].forEach(add);
    conds(w.filters);
  } else if (w.type === "table") {
    w.columns.forEach((c) => add(c.field));
    w.sort.forEach((s) => add(s.field));
    add(w.groupBy);
    conds(w.filters);
    w.highlight.forEach((h) => add(h.field));
  } else if (w.type === "detail") w.fields.forEach((f) => add(f.field));
  else if (w.type === "project_header") w.fields.forEach(add);
  return refs;
}

export function reportDependencies(spec: ReportSpec): ReportDependencies {
  const deps = new Map<SyncEntityKey, { reasons: Set<string>; widgets: Set<string> }>();
  const need = (entity: SyncEntityKey, reason: string, widget?: string) => {
    if (!deps.has(entity)) deps.set(entity, { reasons: new Set(), widgets: new Set() });
    const d = deps.get(entity)!;
    d.reasons.add(reason);
    if (widget) d.widgets.add(widget);
  };
  const refsNeed = (refs: string[], widget?: string) => {
    for (const ref of refs) {
      if (ref.startsWith("cf:") || ref.startsWith("sem:"))
        need("custom_fields", "Uses JobTread custom fields", widget);
      if (DOCUMENT_FIELD.test(ref))
        need("documents", `Uses ${ref} (from financial documents)`, widget);
    }
  };
  const sourceNeed = (source: ReportSource, label: string, widget?: string) => {
    if (source === "jobs") {
      need("jobs", `Reads ${label}`, widget);
      return;
    }
    if (source === "commissions") {
      need("jobs", "Commissions are calculated per job", widget);
      need("documents", "Commissions use customer order gross profit", widget);
      need("custom_fields", "Commissions use the salesperson field", widget);
      return;
    }
    // Every other source declares the synced datasets it reads in the source registry.
    for (const entity of SOURCE_REGISTRY[source].syncEntities)
      need(entity, `Reads ${label}`, widget);
  };

  for (const ds of spec.datasets) {
    sourceNeed(ds.source, ds.label ?? ds.id);
    refsNeed(ds.filters.map((f) => f.field));
  }
  const datasetById = new Map(spec.datasets.map((d) => [d.id, d]));
  const liveWidgets: string[] = [];
  const ruleWidgets: string[] = [];
  const mappingWidgets: string[] = [];
  for (const w of spec.widgets) {
    if (LIVE_WIDGETS.has(w.type)) liveWidgets.push(w.id);
    if (w.type === "rate_editor" || w.type === "assignment_editor") ruleWidgets.push(w.id);
    if ("dataset" in w) {
      const ds = datasetById.get(w.dataset);
      if (ds) {
        sourceNeed(ds.source, ds.label ?? ds.id, w.id);
        refsNeed(
          ds.filters.map((f) => f.field),
          w.id,
        );
        if (ds.source === "commissions") ruleWidgets.push(w.id);
      }
    }
    const refs = widgetRefs(w);
    refsNeed(refs, w.id);
    if (refs.includes("model.region")) mappingWidgets.push(w.id);
  }
  // Fields referenced only by controls still need their data.
  refsNeed(collectFieldRefs(spec));

  return {
    datasets: [...deps.entries()].map(([entity, d]) => ({
      entity,
      reasons: [...d.reasons],
      widgets: [...d.widgets],
    })),
    liveWidgets,
    ruleWidgets: [...new Set(ruleWidgets)],
    mappingWidgets,
  };
}

/** What freshness assessment needs about a dataset (a subset of the Sync Manager overview). */
export type FreshnessInput = {
  key: SyncEntityKey;
  label: string;
  status: string;
  enabled: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
};

/** Daily schedule + a grace window. */
export const STALE_AFTER_HOURS = 36;

function ageText(iso: string, now: number): string {
  const hours = Math.max(0, (now - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function assessFreshness(
  e: FreshnessInput,
  now = Date.now(),
): { level: FreshnessLevel; message: string | null } {
  const since = e.lastSuccessAt ? ` Showing data from ${ageText(e.lastSuccessAt, now)}.` : "";
  if (e.status === "not_configured")
    return {
      level: "not_configured",
      message: `JobTread isn't connected, so ${e.label} can't refresh.${since}`,
    };
  if (!e.enabled)
    return {
      level: "disabled",
      message: e.lastSuccessAt
        ? `${e.label} sync is turned off.${since}`
        : `${e.label} isn't synced (turned off in Data settings), so widgets using it have no data.`,
    };
  if (!e.lastSuccessAt) {
    if (e.status === "queued" || e.status === "running")
      return { level: "running", message: `${e.label} is syncing for the first time.` };
    return {
      level: "never",
      message:
        e.status === "permission_blocked"
          ? `JobTread's grant doesn't allow reading ${e.label}, so widgets using it have no data.`
          : `${e.label} hasn't been synced yet, so widgets using it may be empty.`,
    };
  }
  if (["failed", "partial", "permission_blocked"].includes(e.status))
    return {
      level: "failed",
      message: `The last ${e.label} sync ${e.status === "partial" ? "stopped partway" : e.status === "permission_blocked" ? "was blocked by JobTread permissions" : "failed"}.${since}`,
    };
  const hours = (now - new Date(e.lastSuccessAt).getTime()) / 3_600_000;
  if (hours > STALE_AFTER_HOURS)
    return {
      level: "stale",
      message: `${e.label} was last synced ${ageText(e.lastSuccessAt, now)}.`,
    };
  return { level: "fresh", message: null };
}

/** Combine dependencies with dataset freshness into report- and widget-level warnings. */
export function summarizeDataHealth(
  deps: ReportDependencies,
  datasets: FreshnessInput[],
  now = Date.now(),
): DataHealthSummary {
  const entities: DataHealthSummary["entities"] = [];
  const widgetWarnings: Record<string, string[]> = {};
  for (const dep of deps.datasets) {
    const e = datasets.find((d) => d.key === dep.entity);
    if (!e) continue;
    const { level, message } = assessFreshness(e, now);
    entities.push({
      entity: e.key,
      label: e.label,
      level,
      lastSuccessAt: e.lastSuccessAt,
      message,
      widgets: dep.widgets,
    });
    if (!message) continue;
    for (const w of dep.widgets) (widgetWarnings[w] ??= []).push(message);
  }
  const warnings = [...new Set(entities.map((e) => e.message).filter((m): m is string => !!m))];
  return {
    status: warnings.length ? "warning" : "ok",
    entities,
    warnings,
    widgetWarnings,
    liveWidgets: deps.liveWidgets,
  };
}
