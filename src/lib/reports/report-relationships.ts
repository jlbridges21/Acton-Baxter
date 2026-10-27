/**
 * Report-specific and company relationships between sources (beyond the built-in registry).
 *
 * Correctness is structural, not a matter of trust:
 *   - every join is on a key field whose values are the related record's stable JobTread id
 *     (a field declared as an id of a different source is rejected; data match rates are
 *     checked at discovery and at run time)
 *   - lookups attach the related record's fields to each row many-to-one: rows are never
 *     added or dropped, so totals over the source stay exact
 *   - rollups are used through calculations that pre-aggregate children per parent
 *   - a field already reachable through another join is rejected (no ambiguous values)
 *   - viewers still need access to every related field's own category
 */

import { resolveField, type FieldCatalog, type FieldDef, type RelatedField } from "./fields";
import { RELATIONSHIPS, ROLLUPS } from "./relationships";
import type { RelationshipSpec, ReportSource } from "./spec";

export type RelationshipOrigin = "registry" | "company" | "report";

export type LookupDef = {
  id: string;
  from: ReportSource;
  to: ReportSource;
  key: string;
  label: string;
  origin: RelationshipOrigin;
};
export type RollupDef = {
  id: string;
  parent: ReportSource;
  child: ReportSource;
  childKey: string;
  label: string;
  description?: string;
  origin: RelationshipOrigin;
};

export type RelCatalog = FieldCatalog & {
  lookupDefs: Map<string, LookupDef>;
  rollupDefs: Map<string, RollupDef>;
  /** relationship id → why it can't be used. */
  relationshipErrors: Map<string, string>;
};

/**
 * Fields that hold another record's stable JobTread id (the only keys the registry joins on).
 * Discovery also finds undeclared fields whose values match ids; those are checked on data.
 */
export const ID_FIELDS: Record<string, ReportSource> = {
  "item.jobId": "jobs",
  "item.modelId": "catalog_models",
  "com.jobId": "jobs",
  "item.id": "cost_items",
};

export function isRelCatalog(c: FieldCatalog): c is RelCatalog {
  return "lookupDefs" in c;
}

function registryDefs() {
  const lookups = new Map<string, LookupDef>(
    Object.values(RELATIONSHIPS).map((r) => [
      r.id,
      { id: r.id, from: r.from, to: r.to, key: r.key, label: r.label, origin: "registry" },
    ]),
  );
  const rollups = new Map<string, RollupDef>(
    Object.values(ROLLUPS).map((r) => [
      r.id,
      {
        id: r.id,
        parent: r.parent,
        child: r.child,
        childKey: r.childKey,
        label: r.label,
        description: r.description,
        origin: "registry",
      },
    ]),
  );
  return { lookups, rollups };
}

/** A key field: the source's own text field (not related, not calculated). */
function keyField(catalog: FieldCatalog, source: ReportSource, ref: string, target: ReportSource) {
  const r = resolveField(catalog, ref);
  if (!r.ok) throw new Error(r.reason);
  if (r.def.source !== source || r.def.via || r.def.calc)
    throw new Error(
      `${r.def.label} (${ref}) isn't a ${source} field of its own, so it can't be a join key.`,
    );
  if (r.def.type !== "text")
    throw new Error(
      `${r.def.label} isn't an id field (it's ${r.def.type}); joins use stable JobTread ids.`,
    );
  const declared = ID_FIELDS[r.key];
  if (declared && declared !== target)
    throw new Error(`${r.def.label} holds ${declared} ids, not ${target} ids.`);
  return r;
}

export function extendCatalogWithRelationships(
  base: FieldCatalog,
  defs: Array<{ spec: RelationshipSpec; origin: "company" | "report" }>,
): RelCatalog {
  const { lookups, rollups } = registryDefs();
  const related = Object.fromEntries(
    (Object.keys(base.related) as ReportSource[]).map((s) => [s, new Map(base.related[s])]),
  ) as FieldCatalog["related"];
  const listed: Record<ReportSource, FieldDef[]> = {
    jobs: [],
    catalog_models: [],
    cost_items: [],
    commissions: [],
  };
  const relationshipErrors = new Map<string, string>();
  // Report definitions replace company ones with the same id.
  const byId = new Map<string, { spec: RelationshipSpec; origin: "company" | "report" }>();
  for (const d of defs) byId.set(d.spec.id, d);

  for (const { spec, origin } of byId.values()) {
    try {
      if (spec.kind === "rollup") {
        const childKey = keyField(base, spec.child, spec.childKey, spec.parent);
        rollups.set(spec.id, {
          id: spec.id,
          parent: spec.parent,
          child: spec.child,
          childKey: childKey.key,
          label: spec.label,
          description: spec.description,
          origin,
        });
        continue;
      }
      const key = keyField(base, spec.from, spec.key, spec.to);
      const added: Array<{ field: RelatedField; def: FieldDef }> = [];
      for (const ref of spec.fields) {
        const r = resolveField(base, ref);
        if (!r.ok) throw new Error(r.reason);
        if (r.def.source !== spec.to || r.def.via || r.def.calc)
          throw new Error(`${r.def.label} (${ref}) isn't a ${spec.to} field of its own.`);
        const existing = related[spec.from].get(r.key);
        if (existing) {
          const existingKey = lookups.get(existing.relationship)?.key;
          if (existingKey === key.key) continue; // already available through the same join
          throw new Error(
            `${r.def.label} is already available on ${spec.from} through ${existing.relationship}; a second join would make its value ambiguous.`,
          );
        }
        if (r.def.source === spec.from) continue;
        added.push({
          field: { relationship: spec.id, ref, key: r.key, approvedBy: origin },
          def: {
            ...base.byKey.get(r.key)!,
            label: `${(ref.startsWith("sem:") && base.semantic.get(ref)?.label) || r.def.label} · ${spec.label}`,
            via: spec.id,
            description: `From the related ${spec.to} record (${spec.label}, joined on ${key.def.label}).`,
          },
        });
      }
      lookups.set(spec.id, {
        id: spec.id,
        from: spec.from,
        to: spec.to,
        key: key.key,
        label: spec.label,
        origin,
      });
      for (const a of added) {
        related[spec.from].set(a.field.key, a.field);
        listed[spec.from].push(a.def);
      }
    } catch (error) {
      relationshipErrors.set(
        spec.id,
        `Relationship "${spec.label}" (${spec.id}) can't be used: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    ...base,
    related,
    bySource: Object.fromEntries(
      (Object.keys(base.bySource) as ReportSource[]).map((s) => [
        s,
        [...base.bySource[s], ...listed[s]],
      ]),
    ) as FieldCatalog["bySource"],
    lookupDefs: lookups,
    rollupDefs: rollups,
    relationshipErrors,
  };
}
