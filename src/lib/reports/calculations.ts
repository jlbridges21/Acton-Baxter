/**
 * Calculated fields in the report engine: compile the Metric Library's and a report's own
 * calculations into the field catalog, then compute them deterministically.
 *
 *   row        evaluated once per record after related fields and rollups are attached
 *   aggregate  evaluated over each group of records (KPI, chart point, table subtotal)
 *   rollup     pre-aggregates related child records onto each parent record by stable id
 *              (one value per parent → no join fan-out, so parent-level sums stay exact)
 *
 * A calculation's access requirement is the union of every field it reads (directly or
 * through other calculations), so a formula never reveals data its viewer can't see.
 */

import { aggregate, asNumber, matchesCondition, type CellValue, type Row } from "./compute";
import {
  fieldOnSource,
  resolveField,
  type FieldCatalog,
  type FieldDef,
  type FieldType,
} from "./fields";
import {
  analyzeFormula,
  calcRefs,
  evaluateAggregate,
  evaluateRow,
  FormulaError,
  kindOfFieldType,
  parseFormula,
  type FormulaNode,
  type ValueKind,
} from "./formula";
import { ROLLUPS } from "./relationships";
import { isRelCatalog, type RollupDef } from "./report-relationships";
import type { CalculationSpec, Condition, ReportSource } from "./spec";

export type CalcOrigin = "report" | "library";

export type CompiledCalc = {
  ref: string;
  spec: CalculationSpec;
  origin: CalcOrigin;
  def: FieldDef;
  tree: FormulaNode | null;
  /** Canonical field keys read (for rollups: on the child source). */
  deps: string[];
  calcDeps: string[];
  /** Rollup: canonical child field key and filter conditions. */
  rollup?: {
    id: string;
    child: ReportSource;
    childKey: string;
    field: string | null;
    filters: Condition[];
  };
};

export type CalcCatalog = FieldCatalog & {
  calcs: Map<string, CompiledCalc>;
  /** calc:<key> → why it can't be used (parse error, unknown field, cycle, type mismatch). */
  calcErrors: Map<string, string>;
  /** Row-level and rollup calculations per source, in dependency order. */
  calcOrder: Record<ReportSource, CompiledCalc[]>;
};

const NUMBER_TYPES = new Set<FieldType>(["number", "currency", "percent", "sqft"]);

function compatible(type: FieldType, kind: ValueKind): boolean {
  if (kind === "null") return true;
  if (NUMBER_TYPES.has(type)) return kind === "number";
  if (type === "boolean") return kind === "boolean";
  if (type === "date") return kind === "date" || kind === "text";
  return true; // text accepts anything (shown as text)
}

function describe(c: CalculationSpec): string {
  if (c.basis === "rollup" && c.rollup)
    return `Rollup: ${c.rollup.op}${c.rollup.field ? ` of ${c.rollup.field}` : ""} over ${c.rollup.relationship}${c.rollup.filters.length ? " (filtered)" : ""}`;
  return `${c.basis === "aggregate" ? "Aggregate formula" : "Formula"}: ${c.formula}`;
}

/**
 * Extend a field catalog with calculations (library first; a report's own calculation with
 * the same key takes precedence). Never throws: problems are reported in calcErrors.
 */
export function extendCatalogWithCalcs(
  base: FieldCatalog,
  calcs: Array<{ spec: CalculationSpec; origin: CalcOrigin }>,
): CalcCatalog {
  const byRef = new Map<string, { spec: CalculationSpec; origin: CalcOrigin }>();
  for (const c of calcs) byRef.set(`calc:${c.spec.key}`, c);

  const byKey = new Map(base.byKey);
  const calcErrors = new Map<string, string>();
  const provisional = new Map<string, FieldDef>();
  for (const [ref, { spec }] of byRef) {
    const def: FieldDef = {
      key: ref,
      label: spec.label,
      type: spec.type,
      category: "general",
      source: spec.source,
      origin: describe(spec),
      description: spec.description,
      calc: { basis: spec.basis, source: spec.source },
    };
    provisional.set(ref, def);
    byKey.set(ref, def);
  }
  const catalog: CalcCatalog = {
    ...base,
    byKey,
    calcs: new Map(),
    calcErrors,
    calcOrder: { jobs: [], catalog_models: [], cost_items: [], commissions: [] },
  };

  // Pass 1: parse + analyze each calculation against the (provisional) catalog.
  const compiled = new Map<string, CompiledCalc>();
  for (const [ref, { spec, origin }] of byRef) {
    const def = provisional.get(ref)!;
    try {
      if (spec.basis === "rollup") {
        const rollupDefs: Map<string, RollupDef | (typeof ROLLUPS)[keyof typeof ROLLUPS]> =
          isRelCatalog(base)
            ? base.rollupDefs
            : new Map(Object.values(ROLLUPS).map((r) => [r.id, r]));
        const rel = rollupDefs.get(spec.rollup!.relationship);
        if (!rel || rel.parent !== spec.source)
          throw new FormulaError(
            `"${spec.rollup!.relationship}" isn't a relationship from ${spec.source} to related records. Available: ${
              [...rollupDefs.values()]
                .filter((r) => r.parent === spec.source)
                .map((r) => r.id)
                .join(", ") || "none"
            }.`,
          );
        let field: string | null = null;
        const deps: string[] = [];
        const check = (f: string) => {
          const r = resolveField(catalog, f);
          if (!r.ok) throw new FormulaError(r.reason);
          const on = fieldOnSource(catalog, rel.child, { ...r.def, key: r.key });
          if (!on.ok) throw new FormulaError(on.reason);
          if (r.def.calc?.basis === "aggregate")
            throw new FormulaError(
              `${r.def.label} is an aggregate calculation; roll up a field or row calculation.`,
            );
          deps.push(r.key);
          return r;
        };
        if (spec.rollup!.field) {
          const r = check(spec.rollup!.field);
          field = r.key;
          if (["sum", "avg", "median"].includes(spec.rollup!.op) && !NUMBER_TYPES.has(r.def.type))
            throw new FormulaError(`Rollup ${spec.rollup!.op} needs a number field.`);
        }
        const filters = spec.rollup!.filters.map((c) => ({ ...c, field: check(c.field).key }));
        if (
          !["count", "count_distinct"].includes(spec.rollup!.op) &&
          field &&
          !compatible(spec.type, "number")
        )
          throw new FormulaError(`A ${spec.rollup!.op} rollup returns a number, not ${spec.type}.`);
        compiled.set(ref, {
          ref,
          spec,
          origin,
          def,
          tree: null,
          deps,
          calcDeps: deps.filter((d) => d.startsWith("calc:")),
          rollup: { id: rel.id, child: rel.child, childKey: rel.childKey, field, filters },
        });
        continue;
      }
      const tree = parseFormula(spec.formula!);
      const deps: string[] = [];
      const analysis = analyzeFormula(tree, spec.basis as "row" | "aggregate", (fieldRef) => {
        if (fieldRef === ref) throw new FormulaError(`${spec.label} can't reference itself.`);
        const r = resolveField(catalog, fieldRef);
        if (!r.ok) throw new FormulaError(r.reason);
        const on = fieldOnSource(catalog, spec.source, { ...r.def, key: r.key });
        if (!on.ok) throw new FormulaError(on.reason);
        deps.push(r.key);
        return {
          kind: kindOfFieldType(r.def.type),
          label: r.def.label,
          aggregate: r.def.calc?.basis === "aggregate",
        };
      });
      if (!compatible(spec.type, analysis.kind))
        throw new FormulaError(
          `The formula returns ${analysis.kind === "number" ? "a number" : analysis.kind}, but ${spec.label} is set to ${spec.type}.`,
        );
      // A formula that reads a field it rewrote to its canonical key keeps the original ref
      // in the tree; rows carry canonical keys, so rewrite field nodes once here.
      const canonical = rewriteRefs(tree, (r) => {
        const x = resolveField(catalog, r);
        return x.ok ? x.key : r;
      });
      compiled.set(ref, {
        ref,
        spec,
        origin,
        def,
        tree: canonical,
        deps,
        calcDeps: calcRefs(canonical),
      });
    } catch (error) {
      calcErrors.set(
        ref,
        `${spec.label} (${ref}) can't be calculated: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Pass 2: cycles and broken dependencies, in dependency order.
  const state = new Map<string, "visiting" | "done">();
  const order: CompiledCalc[] = [];
  const visit = (ref: string, path: string[]): boolean => {
    if (calcErrors.has(ref)) return false;
    const c = compiled.get(ref);
    if (!c) {
      return false;
    }
    if (state.get(ref) === "done") return true;
    if (state.get(ref) === "visiting") {
      calcErrors.set(
        ref,
        `${c.spec.label} (${ref}) can't be calculated: circular reference ${[...path, ref].join(" → ")}.`,
      );
      return false;
    }
    state.set(ref, "visiting");
    for (const dep of c.calcDeps) {
      if (!visit(dep, [...path, ref])) {
        if (!calcErrors.has(ref))
          calcErrors.set(
            ref,
            `${c.spec.label} (${ref}) can't be calculated: it uses ${dep}, which ${calcErrors.has(dep) ? "has a problem" : "doesn't exist"}.`,
          );
        state.set(ref, "done");
        return false;
      }
    }
    state.set(ref, "done");
    order.push(c);
    return true;
  };
  for (const ref of compiled.keys()) visit(ref, []);

  // Pass 3: register usable calculations with inherited access requirements.
  for (const c of order) {
    if (calcErrors.has(c.ref)) continue;
    const requires = new Set<FieldDef["category"]>();
    for (const dep of c.deps) {
      const d = catalog.calcs.get(dep)?.def ?? byKey.get(dep);
      if (!d) continue;
      requires.add(d.category);
      for (const r of d.requires ?? []) requires.add(r);
    }
    requires.delete("general");
    const def: FieldDef = {
      ...c.def,
      category: requires.has("financial")
        ? "financial"
        : requires.has("customer")
          ? "customer"
          : requires.has("internal")
            ? "internal"
            : "general",
      requires: [...requires],
    };
    const done = { ...c, def };
    catalog.calcs.set(c.ref, done);
    byKey.set(c.ref, def);
    if (c.spec.basis !== "aggregate") catalog.calcOrder[c.spec.source].push(done);
  }
  for (const ref of calcErrors.keys()) byKey.delete(ref);
  catalog.bySource = Object.fromEntries(
    (Object.keys(base.bySource) as ReportSource[]).map((s) => [
      s,
      [
        ...base.bySource[s].filter((f) => !f.key.startsWith("calc:")),
        ...[...catalog.calcs.values()].filter((c) => c.spec.source === s).map((c) => c.def),
      ],
    ]),
  ) as FieldCatalog["bySource"];
  return catalog;
}

function rewriteRefs(n: FormulaNode, map: (ref: string) => string): FormulaNode {
  switch (n.k) {
    case "field":
      return { k: "field", ref: map(n.ref) };
    case "neg":
    case "not":
      return { ...n, a: rewriteRefs(n.a, map) };
    case "bin":
      return { ...n, a: rewriteRefs(n.a, map), b: rewriteRefs(n.b, map) };
    case "call":
      return { ...n, args: n.args.map((a) => rewriteRefs(a, map)) };
    default:
      return n;
  }
}

export function isCalcCatalog(c: FieldCatalog): c is CalcCatalog {
  return "calcs" in c;
}

/** Evaluate an aggregate calculation over records (nested aggregate calcs resolve too). */
export function evaluateAggregateCalc(catalog: CalcCatalog, ref: string, rows: Row[]): CellValue {
  const c = catalog.calcs.get(ref);
  if (!c?.tree) return null;
  const lookup = (r: string, rs: Row[]) => evaluateAggregateCalc(catalog, r, rs);
  if (c.spec.basis === "aggregate") return evaluateAggregate(c.tree, rows, lookup);
  return null;
}

/** Numeric value of an aggregate calculation (for metrics); blank stays blank. */
export function aggregateCalcNumber(catalog: CalcCatalog, ref: string, rows: Row[]): number | null {
  const v = evaluateAggregateCalc(catalog, ref, rows);
  return typeof v === "boolean" ? (v ? 1 : 0) : asNumber(v);
}

/**
 * Apply rollups and row calculations for one source, in dependency order. Returns new row
 * objects only when there is something to compute; never adds or drops rows.
 */
export async function applyCalculations(
  catalog: CalcCatalog,
  source: ReportSource,
  rows: Row[],
  loadChild: (source: ReportSource, ruleSet?: string) => Promise<Row[]>,
): Promise<Row[]> {
  const order = catalog.calcOrder[source];
  if (!order.length) return rows;
  const out = rows.map((r) => ({ ...r }));
  for (const c of order) {
    if (c.rollup) {
      const rel = c.rollup;
      const children = await loadChild(rel.child, c.spec.rollup?.ruleSet);
      const byParent = new Map<string, Row[]>();
      for (const child of children) {
        if (!c.rollup.filters.every((f) => matches(child, f))) continue;
        const pid = child[rel.childKey];
        if (typeof pid !== "string") continue;
        const list = byParent.get(pid);
        if (list) list.push(child);
        else byParent.set(pid, [child]);
      }
      const op = c.spec.rollup!.op;
      for (const r of out) {
        const kids = byParent.get(r.id) ?? [];
        r[c.ref] = kids.length
          ? aggregate(kids, { op, field: c.rollup.field ?? undefined }).value
          : op === "count" || op === "count_distinct"
            ? 0
            : null;
      }
      continue;
    }
    for (const r of out) r[c.ref] = evaluateRow(c.tree!, r);
  }
  return out;
}

const matches = (row: Row, c: Condition) => matchesCondition(row[c.field], c);
