/**
 * Relationship discovery: find how two sources can be joined, verified on real records.
 *
 * Only stable-id joins qualify. For each of the requester's visible text fields, discovery
 * measures how many values are ids of the other source's records (match rate), how many
 * records carry the key (coverage), and the cardinality (records per related record). A field
 * that matches names instead of ids is reported as "not a stable key" so Dexter asks rather
 * than guessing. Nothing is saved here.
 */

import "server-only";

import { canSeeField, type ReportsAccess } from "./access";
import type { Row } from "./compute";
import { loadSourceRows } from "./engine";
import type { FieldCatalog } from "./fields";
import { ID_FIELDS } from "./report-relationships";
import { SOURCE_REGISTRY } from "./sources";
import type { RelationshipSpec, ReportSource } from "./spec";

export type JoinCandidate = {
  /** Rows of `keySource` carry `key`, whose values are ids of `idSource` records. */
  keySource: ReportSource;
  idSource: ReportSource;
  key: string;
  keyLabel: string;
  declaredId: boolean;
  registered: string | null;
  recordsWithKey: number;
  records: number;
  matched: number;
  matchRate: number;
  /** Records of keySource per idSource record (fan-in). */
  perRelated: { min: number; avg: number; max: number } | null;
  verdict: "verified" | "uncertain" | "rejected";
  reason: string;
  /** Ready-to-use definitions (lookup brings idSource fields onto keySource rows; rollup the reverse). */
  lookup: (Omit<RelationshipSpec & { kind: "lookup" }, "fields"> & { fields: string[] }) | null;
  rollup: RelationshipSpec & { kind: "rollup" };
};

const VERIFIED_RATE = 0.95;
const UNCERTAIN_RATE = 0.5;

function scan(
  catalog: FieldCatalog,
  access: ReportsAccess,
  keySource: ReportSource,
  keyRows: Row[],
  idSource: ReportSource,
  ids: Set<string>,
  idNames: Set<string>,
  registered: Map<string, string>,
): {
  candidates: JoinCandidate[];
  nameMatches: Array<{ key: string; label: string; matched: number }>;
} {
  const candidates: JoinCandidate[] = [];
  const nameMatches: Array<{ key: string; label: string; matched: number }> = [];
  for (const f of catalog.bySource[keySource]) {
    if (f.type !== "text" || f.via || f.calc || f.source !== keySource) continue;
    if (!canSeeField(access, f)) continue;
    if (ID_FIELDS[f.key] && ID_FIELDS[f.key] !== idSource) continue;
    const values = keyRows
      .map((r) => r[f.key])
      .filter((v): v is string => typeof v === "string" && v !== "");
    if (!values.length) continue;
    let matched = 0;
    let names = 0;
    const per = new Map<string, number>();
    for (const v of values) {
      if (ids.has(v)) {
        matched++;
        per.set(v, (per.get(v) ?? 0) + 1);
      } else if (idNames.has(v.toLowerCase())) names++;
    }
    if (!matched) {
      if (names >= Math.max(3, values.length * 0.3))
        nameMatches.push({ key: f.key, label: f.label, matched: names });
      continue;
    }
    const rate = matched / values.length;
    const counts = [...per.values()];
    const declared = Boolean(ID_FIELDS[f.key]);
    const verdict: JoinCandidate["verdict"] =
      rate >= VERIFIED_RATE && matched >= Math.min(5, values.length)
        ? "verified"
        : rate >= UNCERTAIN_RATE
          ? "uncertain"
          : "rejected";
    const base = `${keySource}_${idSource}`.replace(/[^a-z0-9_]/g, "_").slice(0, 30);
    candidates.push({
      keySource,
      idSource,
      key: f.key,
      keyLabel: f.label,
      declaredId: declared,
      registered: registered.get(`${keySource}|${f.key}|${idSource}`) ?? null,
      recordsWithKey: values.length,
      records: keyRows.length,
      matched,
      matchRate: Math.round(rate * 1000) / 1000,
      perRelated: counts.length
        ? {
            min: Math.min(...counts),
            avg: Math.round((matched / counts.length) * 10) / 10,
            max: Math.max(...counts),
          }
        : null,
      verdict,
      reason:
        verdict === "verified"
          ? `${Math.round(rate * 100)}% of ${f.label} values are ${idSource} ids.`
          : verdict === "uncertain"
            ? `Only ${Math.round(rate * 100)}% of ${f.label} values match ${idSource} ids — confirm this is the intended link before relying on it.`
            : `Few ${f.label} values (${Math.round(rate * 100)}%) match ${idSource} ids; not a reliable key.`,
      lookup:
        idSource === "commissions"
          ? null
          : {
              id: `${base}_lookup`,
              kind: "lookup",
              label: SOURCE_REGISTRY[idSource].label,
              from: keySource,
              to: idSource as "jobs" | "catalog_models" | "cost_items",
              key: f.key,
              fields: [],
            },
      rollup: {
        id: `${base}_rollup`,
        kind: "rollup",
        label: SOURCE_REGISTRY[keySource].label,
        parent: idSource,
        child: keySource,
        childKey: f.key,
      },
    });
  }
  return { candidates, nameMatches };
}

/**
 * Join candidates between two sources in both directions, best first. `fieldsOf(to)` in the
 * result is a convenience for building a lookup's field list.
 */
export async function discoverRelationships(input: {
  a: ReportSource;
  b: ReportSource;
  access: ReportsAccess;
  ruleSet?: string;
}) {
  const [ra, rb] = await Promise.all([
    loadSourceRows(input.a, input.ruleSet),
    loadSourceRows(input.b, input.ruleSet),
  ]);
  const catalog = ra.catalog;
  const registered = new Map<string, string>();
  for (const l of catalog.lookupDefs.values()) registered.set(`${l.from}|${l.key}|${l.to}`, l.id);
  for (const r of catalog.rollupDefs.values())
    registered.set(`${r.child}|${r.childKey}|${r.parent}`, r.id);
  const names = (rows: Row[], source: ReportSource) =>
    new Set(
      rows
        .map((r) => r[SOURCE_REGISTRY[source].labelField])
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.toLowerCase()),
    );
  const ab = scan(
    catalog,
    input.access,
    input.a,
    ra.rows,
    input.b,
    new Set(rb.rows.map((r) => r.id)),
    names(rb.rows, input.b),
    registered,
  );
  const ba = scan(
    catalog,
    input.access,
    input.b,
    rb.rows,
    input.a,
    new Set(ra.rows.map((r) => r.id)),
    names(ra.rows, input.a),
    registered,
  );
  const order = { verified: 0, uncertain: 1, rejected: 2 } as const;
  const candidates = [...ab.candidates, ...ba.candidates].sort(
    (x, y) =>
      order[x.verdict] - order[y.verdict] || y.matchRate - x.matchRate || y.matched - x.matched,
  );
  return {
    candidates,
    nameOnlyMatches: [...ab.nameMatches, ...ba.nameMatches],
    records: { [input.a]: ra.rows.length, [input.b]: rb.rows.length },
  };
}
