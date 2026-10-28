/**
 * Report ↔ field-catalog audit and safe repair.
 *
 * The audit walks every place a field can be referenced — widget columns, filters, sorts,
 * grouping levels, controls, calculations (including formula text), relationships, color
 * bindings, saved personal views, and Metric Library definitions — and classifies each
 * reference against the live catalog by immutable id.
 *
 * Repairs:
 *   - automatic suggestions are only offered when identity is certain: a business name that
 *     reads a shared narrative field is replaced by that same field's native reference
 *     (cf:<same id>: identical values, honest label)
 *   - everything else (removed fields, ambiguous names) needs an explicit replacement chosen
 *     by a person; nothing is matched by label similarity
 *   - applying a repair saves a new report version (history is never rewritten; restoring
 *     the previous version is the rollback)
 */

import "server-only";

import { agentDb } from "@/lib/agents/store";
import { listCustomFields } from "@/lib/jobtread/metadata";
import { ValidationError } from "@/lib/errors";
import type { ReportsAccess } from "./access";
import { checkSpecFields } from "./engine";
import { resolveField } from "./fields";
import { parseFormula, type FormulaNode } from "./formula";
import { catalogFor, listLibraryMetrics } from "./metrics";
import { getReport, saveReportVersion, type ReportRow } from "./repo";
import { collectFieldRefs, fieldRef, parseReportSpec, type ReportSpec } from "./spec";

export type FindingKind =
  "missing" | "stale" | "conflict" | "ambiguous" | "shared_text" | "deprecated" | "type_changed";

export type AuditFinding = {
  where: "report" | "saved_view" | "metric";
  reportId: string | null;
  title: string;
  path: string;
  ref: string;
  kind: FindingKind;
  severity: "error" | "warning";
  message: string;
  /** Certain replacement (same JobTread field id), when one exists. */
  suggestion: { to: string; label: string } | null;
  /** Possible replacements a person must choose between (never applied automatically). */
  candidates: Array<{ ref: string; label: string }>;
};

const isRef = (s: string) => fieldRef.safeParse(s).success;

function formulaRefs(text: string): string[] {
  try {
    const out: string[] = [];
    const walk = (n: FormulaNode) => {
      if (n.k === "field") out.push(n.ref);
      if (n.k === "neg" || n.k === "not") walk(n.a);
      if (n.k === "bin") {
        walk(n.a);
        walk(n.b);
      }
      if (n.k === "call") n.args.forEach(walk);
    };
    walk(parseFormula(text));
    return out;
  } catch {
    return [];
  }
}

/** Every field reference in a JSON value with its path (values, object keys, formulas). */
export function collectRefUses(value: unknown, base = ""): Array<{ ref: string; path: string }> {
  const out: Array<{ ref: string; path: string }> = [];
  const walk = (v: unknown, path: string, key?: string) => {
    if (typeof v === "string") {
      if (isRef(v)) out.push({ ref: v, path });
      else if (key === "formula") for (const r of formulaRefs(v)) out.push({ ref: r, path });
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (isRef(k)) out.push({ ref: k, path: `${path}.${k}` });
        walk(x, path ? `${path}.${k}` : k, k);
      }
  };
  walk(value, base);
  return out;
}

async function classify(
  uses: Array<{ ref: string; path: string }>,
  ctx: {
    where: AuditFinding["where"];
    reportId: string | null;
    title: string;
    since: string | null;
  },
  spec?: Pick<ReportSpec, "calculations" | "relationships">,
): Promise<AuditFinding[]> {
  const catalog = await catalogFor(spec);
  const typeChanges = new Map(
    (await listCustomFields({ includeRemoved: true }).catch(() => []))
      .filter((f) => f.type_changed_at)
      .map((f) => [f.id, f]),
  );
  const out: AuditFinding[] = [];
  const seen = new Set<string>();
  for (const u of uses) {
    const k = `${u.path}|${u.ref}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const base = {
      where: ctx.where,
      reportId: ctx.reportId,
      title: ctx.title,
      path: u.path,
      ref: u.ref,
    };
    if (u.ref.startsWith("sem:")) {
      const sem = catalog.semantic.get(u.ref);
      const status = sem?.status;
      if (status === "shared_text" || status === "deprecated") {
        const def = sem?.ref ? catalog.byKey.get(sem.ref) : undefined;
        out.push({
          ...base,
          kind: status,
          severity: "warning",
          message: sem!.warning ?? "Deprecated business name.",
          suggestion: sem?.ref && def ? { to: sem.ref, label: def.label } : null,
          candidates: [],
        });
        continue;
      }
      if (status === "conflict" || status === "ambiguous" || status === "stale") {
        out.push({
          ...base,
          kind: status,
          severity: "error",
          message: sem!.unavailable ?? "This business name can't be used.",
          suggestion: null,
          candidates: [],
        });
        continue;
      }
    }
    const r = resolveField(catalog, u.ref);
    if (!r.ok) {
      const stale = catalog.stale?.get(u.ref);
      out.push({
        ...base,
        kind: stale ? "stale" : "missing",
        severity: "error",
        message: r.reason,
        suggestion: null,
        candidates: [],
      });
      continue;
    }
    if (r.def.customFieldId && ctx.since) {
      const t = typeChanges.get(r.def.customFieldId);
      if (t?.type_changed_at && t.type_changed_at > ctx.since)
        out.push({
          ...base,
          kind: "type_changed",
          severity: "warning",
          message: `${r.def.label} changed type in JobTread (${t.previous_type} → ${t.type}) after this was last saved; check filters and formatting that depend on it.`,
          suggestion: null,
          candidates: [],
        });
    }
  }
  return out;
}

export async function auditReport(report: Pick<ReportRow, "id" | "title" | "spec" | "updated_at">) {
  return classify(
    collectRefUses(report.spec),
    { where: "report", reportId: report.id, title: report.title, since: report.updated_at },
    report.spec,
  );
}

/** Audit every active report, saved view, and library metric (bounded). */
export async function auditAll(opts: { limit?: number } = {}) {
  const reports = await agentDb().select<ReportRow>("bi_reports", { limit: 2000 });
  const findings: AuditFinding[] = [];
  for (const r of reports) findings.push(...(await auditReport(r)));
  const views = await agentDb()
    .select<{ id: string; report_id: string; name: string; state: unknown }>(
      "bi_report_saved_views",
      { limit: 5000 },
    )
    .catch(() => []);
  const titles = new Map(reports.map((r) => [r.id, r]));
  for (const v of views) {
    const report = titles.get(v.report_id);
    findings.push(
      ...(await classify(
        collectRefUses(v.state, "state"),
        {
          where: "saved_view",
          reportId: v.report_id,
          title: `${report?.title ?? "Report"} — view “${v.name}”`,
          since: null,
        },
        report?.spec,
      )),
    );
  }
  for (const m of await listLibraryMetrics().catch(() => [])) {
    findings.push(
      ...(await classify(collectRefUses(m.definition, "definition"), {
        where: "metric",
        reportId: null,
        title: `Metric calc:${m.key}`,
        since: m.updated_at,
      })),
    );
  }
  const limit = opts.limit ?? 500;
  const summary: Record<string, number> = {};
  for (const f of findings) summary[f.kind] = (summary[f.kind] ?? 0) + 1;
  return {
    reportsChecked: reports.length,
    viewsChecked: views.length,
    summary,
    total: findings.length,
    findings: findings.slice(0, limit),
  };
}

/** Replace field references (values, object keys, formula tokens); dedupe repeated fields. */
export function replaceRefs(spec: ReportSpec, map: Record<string, string>) {
  const changes: Array<{ path: string; from: string; to: string }> = [];
  const formulaSwap = (text: string, path: string) => {
    let out = text;
    for (const [from, to] of Object.entries(map)) {
      const re = new RegExp(
        `(?<![\\w:.])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`,
        "g",
      );
      if (re.test(out)) {
        changes.push({ path, from, to });
        out = out.replace(re, to);
      }
    }
    return out;
  };
  const walk = (v: unknown, path: string, key?: string): unknown => {
    if (typeof v === "string") {
      if (map[v]) {
        changes.push({ path, from: v, to: map[v]! });
        return map[v];
      }
      return key === "formula" ? formulaSwap(v, path) : v;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => {
          const nk = map[k] ?? k;
          if (map[k]) changes.push({ path: `${path}.${k}`, from: k, to: nk });
          return [nk, walk(x, path ? `${path}.${k}` : k, k)];
        }),
      );
    return v;
  };
  const next = walk(structuredClone(spec), "") as ReportSpec;
  // A widget listing the same field twice after replacement keeps the first occurrence.
  const removed: string[] = [];
  for (const w of next.widgets as Array<Record<string, unknown>>) {
    for (const listKey of ["fields", "columns"]) {
      const list = w[listKey];
      if (!Array.isArray(list)) continue;
      const seen = new Set<string>();
      w[listKey] = list.filter((item: unknown) => {
        const f = typeof item === "string" ? item : (item as { field?: string })?.field;
        if (!f) return true;
        if (seen.has(f)) {
          removed.push(`${String(w.id)}.${listKey}: duplicate ${f}`);
          return false;
        }
        seen.add(f);
        return true;
      });
    }
  }
  return { spec: next, changes, removed };
}

/** Certain replacements for a report (same field id, honest native reference). */
export async function suggestedReplacements(
  report: Pick<ReportRow, "id" | "title" | "spec" | "updated_at">,
) {
  const findings = await auditReport(report);
  const map: Record<string, string> = {};
  for (const f of findings) if (f.suggestion) map[f.ref] = f.suggestion.to;
  return { findings, map };
}

/** Dry run: what a repair would change, and whether the result validates. */
export async function previewReportRepair(input: {
  reportId: string;
  access: ReportsAccess;
  /** Explicit replacements chosen by a person; defaults to the certain suggestions. */
  replacements?: Record<string, string>;
}) {
  const report = await getReport(input.reportId);
  if (!report) throw new ValidationError("Report not found.");
  const { findings, map } = await suggestedReplacements(report);
  const replacements = input.replacements ?? map;
  const catalog = await catalogFor(report.spec);
  for (const to of Object.values(replacements)) {
    const r = resolveField(catalog, to);
    if (!r.ok) throw new ValidationError(`Replacement ${to}: ${r.reason}`);
  }
  const { spec, changes, removed } = replaceRefs(report.spec, replacements);
  const parsed = parseReportSpec(spec);
  const issues = parsed.ok ? [] : parsed.issues.map((i) => `${i.path}: ${i.message}`);
  const before = await checkSpecFields(report.spec, input.access, collectFieldRefs(report.spec));
  const after = parsed.ok
    ? await checkSpecFields(parsed.spec, input.access, collectFieldRefs(parsed.spec))
    : { missing: [], restricted: [] };
  return {
    reportId: report.id,
    title: report.title,
    version: report.version,
    findings,
    replacements,
    changes,
    removedDuplicates: removed,
    valid: parsed.ok && issues.length === 0,
    issues,
    problemsBefore: before.missing.length,
    problemsAfter: after.missing.length,
    spec: parsed.ok ? parsed.spec : null,
  };
}

export async function applyReportRepair(input: {
  reportId: string;
  access: ReportsAccess;
  userId: string | null;
  authorKind: "user" | "dexter" | "system";
  replacements?: Record<string, string>;
  expectedVersion?: number;
}) {
  const preview = await previewReportRepair(input);
  if (!preview.valid || !preview.spec)
    throw new ValidationError(`The repaired report doesn't validate: ${preview.issues.join("; ")}`);
  if (!preview.changes.length) return { ...preview, saved: false, version: preview.version };
  if (preview.problemsAfter > preview.problemsBefore)
    throw new ValidationError("This repair would introduce new field problems; nothing was saved.");
  const report = (await getReport(input.reportId))!;
  const { report: saved } = await saveReportVersion({
    report,
    spec: preview.spec,
    authorId: input.userId,
    authorKind: input.authorKind,
    summary:
      `Field repair: ${[...new Set(preview.changes.map((c) => `${c.from} → ${c.to}`))].join(", ")}`.slice(
        0,
        500,
      ),
    expectedVersion: input.expectedVersion ?? report.version,
  });
  return { ...preview, saved: true, version: saved.version, previousVersion: report.version };
}
