/**
 * Validate a calculated field against real data and preview it (Metric Library builder and
 * Dexter's reports_calculation_check). Read-only; returns small samples and counts.
 */

import "server-only";

import { canSeeField, type ReportsAccess } from "./access";
import { aggregateCalcNumber } from "./calculations";
import { groupRows, isBlank } from "./compute";
import { loadSourceRows } from "./engine";
import { resolveField } from "./fields";
import { catalogFor } from "./metrics";
import { SOURCE_REGISTRY } from "./sources";
import type { CalculationSpec } from "./spec";

const sampleValue = (v: unknown) =>
  Array.isArray(v) ? v.join(", ") : typeof v === "number" ? Math.round(v * 100) / 100 : v;

export async function previewCalculation(input: {
  calculation: CalculationSpec;
  access: ReportsAccess;
  /** Other calculations in scope (e.g. the report's own). */
  context?: CalculationSpec[];
  groupBy?: string;
  ruleSet?: string;
}): Promise<Record<string, unknown>> {
  const c = input.calculation;
  const calcs = [...(input.context ?? []).filter((x) => x.key !== c.key), c];
  const catalog = await catalogFor({ calculations: calcs });
  const ref = `calc:${c.key}`;
  const error = catalog.calcErrors.get(ref);
  if (error) return { ok: false, problem: error };
  const compiled = catalog.calcs.get(ref)!;
  if (!canSeeField(input.access, compiled.def))
    return {
      ok: false,
      problem: `${c.label} reads fields you can't see (${(compiled.def.requires ?? []).join(", ")}).`,
    };
  const { rows } = await loadSourceRows(c.source, input.ruleSet, { calculations: calcs });
  const inputs = c.basis === "rollup" ? [] : compiled.deps;
  const labelKey = SOURCE_REGISTRY[c.source].labelField;
  const out: Record<string, unknown> = {
    ok: true,
    ref,
    basis: c.basis,
    type: c.type,
    accessRequired: compiled.def.category,
    records: rows.length,
  };
  if (c.basis === "aggregate") {
    out.overall = aggregateCalcNumber(catalog, ref, rows);
    if (input.groupBy) {
      const g = resolveField(catalog, input.groupBy);
      if (!g.ok) return { ok: false, problem: g.reason };
      out.byGroup = [...groupRows(rows, g.key).entries()].slice(0, 12).map(([k, rs]) => ({
        group: k,
        records: rs.length,
        value: aggregateCalcNumber(catalog, ref, rs),
      }));
    }
    out.note =
      "Aggregate: computed from each group's totals (weighted). To average per-record values instead, use a row formula with avg.";
    return out;
  }
  const blank = rows.filter((r) => isBlank(r[ref]));
  const blankWithInputs = blank.filter((r) => inputs.every((k) => !isBlank(r[k]))).length;
  out.computed = rows.length - blank.length;
  out.blank = blank.length;
  out.blankBecauseInputsMissing = blank.length - blankWithInputs;
  if (c.basis === "row")
    out.blankWithAllInputs = `${blankWithInputs} (usually division by zero or a non-numeric value)`;
  out.inputCoverage = inputs.map((k) => ({
    field: k,
    label: catalog.byKey.get(k)?.label ?? k,
    filled: rows.filter((r) => !isBlank(r[k])).length,
  }));
  out.samples = rows
    .filter((r) => !isBlank(r[ref]))
    .slice(0, 6)
    .map((r) => ({
      record: r[labelKey] ?? r.id,
      value: sampleValue(r[ref]),
      ...Object.fromEntries(inputs.slice(0, 5).map((k) => [k, sampleValue(r[k])])),
    }));
  return out;
}
