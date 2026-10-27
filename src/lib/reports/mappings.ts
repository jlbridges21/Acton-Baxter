/**
 * Admin value mappings: business meaning Baxter can't read from JobTread directly.
 *
 * Today: regions. A Product Library model named "LA - i 498" only *suggests* Los Angeles;
 * nothing in JobTread says so. Instead of hard-coding prefixes, an admin maps
 * `model.name` prefix "LA -" → region "Los Angeles", and reports use model.region. Models
 * matching no rule have no region (shown as unmapped) rather than a guessed one.
 */

import "server-only";

import { agentDb, eq } from "@/lib/agents/store";
import { ValidationError } from "@/lib/errors";
import { applyValueMappings, type MatchType } from "./mappings-core";

export { applyValueMappings, type MatchType };

export type ValueMappingRow = {
  id: string;
  kind: "region" | "model_scope" | "option_group";
  source_field: string;
  match_type: MatchType;
  pattern: string;
  value: string;
  priority: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Fields a region rule may read. */
export const REGION_SOURCE_FIELDS = ["model.name"] as const;

/** What each rule kind reads and which values it may set (validated on the server). */
const KIND_RULES: Record<
  ValueMappingRow["kind"],
  { sourceFields: string[]; values: string[] | null; what: string }
> = {
  region: { sourceFields: ["model.name"], values: null, what: "Region rules read the model name." },
  model_scope: {
    sourceFields: ["model.name"],
    values: ["include", "exclude"],
    what: "Model rules read the top-level group name and either include or exclude it.",
  },
  option_group: {
    sourceFields: ["group.name"],
    values: ["include", "exclude"],
    what: "Option-group rules read a cost group's name and either include or exclude it.",
  },
};

export async function listValueMappings(
  kind: ValueMappingRow["kind"] = "region",
): Promise<ValueMappingRow[]> {
  return agentDb().select<ValueMappingRow>("bi_value_mappings", {
    filters: [eq("kind", kind)],
    order: { col: "priority" },
  });
}

export async function saveValueMapping(
  input: {
    id?: string;
    kind: ValueMappingRow["kind"];
    sourceField: string;
    matchType: MatchType;
    pattern: string;
    value: string;
    priority?: number;
  },
  userId: string | null,
): Promise<ValueMappingRow> {
  const kind = KIND_RULES[input.kind];
  if (!kind || !kind.sourceFields.includes(input.sourceField))
    throw new ValidationError(kind?.what ?? "Unknown rule type.");
  const pattern = input.pattern.trim();
  const value = input.value.trim();
  if (!pattern || !value) throw new ValidationError("Enter both a pattern and a value.");
  if (kind.values && !kind.values.includes(value))
    throw new ValidationError(`Value must be one of: ${kind.values.join(", ")}.`);
  const row = {
    kind: input.kind,
    source_field: input.sourceField,
    match_type: input.matchType,
    pattern,
    value,
    priority: input.priority ?? 100,
    created_by: userId,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const [updated] = await agentDb().update<ValueMappingRow>(
      "bi_value_mappings",
      [eq("id", input.id)],
      row,
    );
    if (!updated) throw new ValidationError("That mapping no longer exists.");
    return updated;
  }
  const [saved] = await agentDb().upsert<ValueMappingRow>("bi_value_mappings", row, [
    "kind",
    "source_field",
    "match_type",
    "pattern",
  ]);
  return saved!;
}

export async function deleteValueMapping(id: string): Promise<void> {
  await agentDb().remove("bi_value_mappings", [eq("id", id)]);
}

/**
 * Candidate prefixes seen in model names ("LA - i 498" → "LA -"), for the admin to confirm.
 * Suggestions only: nothing is mapped until an admin saves a rule.
 */
export function suggestPrefixes(
  names: string[],
): Array<{ pattern: string; count: number; examples: string[] }> {
  const seen = new Map<string, string[]>();
  for (const name of names) {
    const m = /^([A-Za-z]{2,5})\s*-\s+\S/.exec(name.trim());
    if (!m) continue;
    const pattern = `${m[1]} -`;
    seen.set(pattern, [...(seen.get(pattern) ?? []), name]);
  }
  return [...seen.entries()]
    .map(([pattern, list]) => ({ pattern, count: list.length, examples: list.slice(0, 3) }))
    .sort((a, b) => b.count - a.count);
}

/** Region rules plus every Product Library model and the region it resolves to. */
export async function getRegionMappingOverview() {
  const { isProductModel, loadModelScopeRules } = await import("./engine");
  const scopeRules = await loadModelScopeRules();
  const [rules, models] = await Promise.all([
    listValueMappings("region"),
    agentDb().select<{ id: string; name: string; description: string | null }>(
      "jt_catalog_models",
      { filters: [{ col: "removed_at", op: "is_null" }], limit: 5000 },
    ),
  ]);
  const productModels = models
    .filter((m) => isProductModel(m, scopeRules))
    .sort((a, b) => a.name.localeCompare(b.name));
  const resolved = productModels.map((m) => ({
    id: m.id,
    name: m.name,
    region: applyValueMappings(m.name, rules),
  }));
  return {
    rules: rules.map((r) => ({
      id: r.id,
      sourceField: r.source_field,
      matchType: r.match_type,
      pattern: r.pattern,
      value: r.value,
      priority: r.priority,
      updatedAt: r.updated_at,
    })),
    models: resolved,
    suggestions: suggestPrefixes(resolved.filter((m) => !m.region).map((m) => m.name)),
  };
}
