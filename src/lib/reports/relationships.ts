/**
 * Related fields: approved attributes of a related record that a source's rows may carry.
 *
 * A relationship is declared here (never configured ad hoc): it names the source, the target
 * source, the stable id field that links them, and the target fields approved by default.
 * Administrators can approve further target fields (bi_related_fields), but only from fields
 * that already exist on the target source; nobody can define a new join. Values are looked up
 * many-to-one by the linking id at read time, so they're never stored twice and joining never
 * adds rows (sums over the source stay exact). Field access is still checked per viewer
 * against the related field's own category.
 */

import type { Row } from "./compute";
import type { ReportSource } from "./spec";

export type RelationshipId = "cost_items.job";

export type Relationship = {
  id: RelationshipId;
  from: ReportSource;
  to: ReportSource;
  /** Field on `from` rows holding the related record's stable JobTread id. */
  key: string;
  /** Shown next to related field labels ("Phase · Job"). */
  label: string;
  description: string;
  /** Approved by default: built-in keys or business fields (sem:*), resolved at catalog load. */
  defaultFields: string[];
};

export const RELATIONSHIPS: Record<RelationshipId, Relationship> = {
  "cost_items.job": {
    id: "cost_items.job",
    from: "cost_items",
    to: "jobs",
    key: "item.jobId",
    label: "Job",
    description:
      "Job budget lines carry approved fields of their JobTread job, matched by job id (catalog lines have no job, so these are blank for them).",
    defaultFields: [
      "job.name",
      "job.number",
      "job.customer",
      "job.city",
      "job.state",
      "sem:phase",
      "sem:status",
      "sem:project_manager",
      "sem:sales_rep",
      "sem:job_type",
      "sem:contract_type",
      "sem:model",
    ],
  },
};

export function relationshipsFrom(source: ReportSource): Relationship[] {
  return Object.values(RELATIONSHIPS).filter((r) => r.from === source);
}

export function relationshipTo(from: ReportSource, to: ReportSource): Relationship | null {
  return relationshipsFrom(from).find((r) => r.to === to) ?? null;
}

/**
 * Copy approved related values onto source rows (new objects only for rows with a match;
 * rows without a related record keep blank related values). Never adds or drops rows.
 */
export function attachRelated(
  rows: Row[],
  rel: Pick<Relationship, "key">,
  targets: Map<string, Row>,
  keys: string[],
): Row[] {
  if (!keys.length) return rows;
  return rows.map((r) => {
    const id = r[rel.key];
    const target = typeof id === "string" ? targets.get(id) : undefined;
    if (!target) return r;
    const out: Row = { ...r };
    for (const k of keys) out[k] = target[k] ?? null;
    return out;
  });
}
