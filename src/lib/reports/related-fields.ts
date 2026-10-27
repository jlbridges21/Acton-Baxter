/**
 * Admin management of related report fields (Reports → Data settings → Cost items & models):
 * which fields of a related record (e.g. a budget line's job) reports may read. Admins can
 * only approve fields that already exist on the related source, for relationships declared
 * in relationships.ts — never define a join. Viewer field access still applies.
 */

import "server-only";

import { agentDb } from "@/lib/agents/store";
import { ValidationError } from "@/lib/errors";
import { isBlank } from "./compute";
import { loadSourceRows } from "./engine";
import { getFieldCatalog, invalidateFieldCatalog, resolveField } from "./fields";
import { RELATIONSHIPS, type RelationshipId } from "./relationships";

export async function getRelatedFieldsOverview() {
  const { catalog, rows } = await loadSourceRows("cost_items");
  const jobIds = new Set((await loadSourceRows("jobs")).rows.map((r) => r.id));
  return Object.values(RELATIONSHIPS).map((rel) => {
    const linked = rows.filter((r) => typeof r[rel.key] === "string");
    const matched = linked.filter((r) => jobIds.has(String(r[rel.key])));
    const approved = [...catalog.related[rel.from].values()].filter(
      (f) => f.relationship === rel.id,
    );
    const approvedKeys = new Set(approved.map((f) => f.key));
    const semByRef = new Map(
      [...catalog.semantic.entries()].flatMap(([k, s]) => (s.ref ? [[s.ref, k] as const] : [])),
    );
    return {
      id: rel.id,
      from: rel.from,
      to: rel.to,
      label: rel.label,
      key: rel.key,
      description: rel.description,
      linkedRows: linked.length,
      matchedRows: matched.length,
      unmatchedRows: linked.length - matched.length,
      approved: approved.map((f) => {
        const def = catalog.byKey.get(f.key)!;
        return {
          ref: f.ref,
          key: f.key,
          label: f.ref.startsWith("sem:")
            ? (catalog.semantic.get(f.ref)?.label ?? def.label)
            : def.label,
          type: def.type,
          category: def.category,
          approvedBy: f.approvedBy,
          filled: matched.filter((r) => !isBlank(r[f.key])).length,
        };
      }),
      eligible: catalog.bySource[rel.to]
        .filter((d) => !d.via && !approvedKeys.has(d.key))
        .map((d) => ({
          ref: semByRef.get(d.key) ?? d.key,
          key: d.key,
          label: d.label,
          type: d.type,
          category: d.category,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  });
}

/** Approve (enabled) or remove (disabled) a related field. Defaults can be removed too. */
export async function setRelatedField(
  input: { relationship: RelationshipId; ref: string; enabled: boolean },
  userId: string,
) {
  const rel = RELATIONSHIPS[input.relationship];
  if (!rel) throw new ValidationError("Unknown relationship.");
  const catalog = await getFieldCatalog();
  const r = resolveField(catalog, input.ref);
  if (!r.ok) throw new ValidationError(r.reason);
  if (r.def.source !== rel.to)
    throw new ValidationError(`"${r.def.label}" isn't a ${rel.to} field, so it can't be related.`);
  await agentDb().upsert(
    "bi_related_fields",
    {
      relationship: rel.id,
      field_ref: input.ref,
      enabled: input.enabled,
      created_by: userId,
      updated_at: new Date().toISOString(),
    },
    ["relationship", "field_ref"],
  );
  invalidateFieldCatalog();
}
