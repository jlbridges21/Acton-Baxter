/**
 * Business-name alias audit (sem:<key> → JobTread custom field id).
 *
 * Aliases are an optional compatibility layer over the native field catalog. Each alias is
 * checked against live metadata by immutable field id — never by label alone:
 *
 *   ok           points at a live field consistent with its declaration
 *   unmapped     no target yet
 *   stale        its target was removed from JobTread
 *   conflict     its declaration (requested name + entity + type) has exactly one verified
 *                exact match, and the alias points elsewhere → a certain repair exists
 *   ambiguous    it points at a shared narrative field while several typed fields could be
 *                the intended one (e.g. "Sprinklers Required" vs ADU / Main Home sprinklers)
 *                → never guessed; an administrator must choose
 *   shared_text  it presents a narrative text field under a different, structured-sounding
 *                name (e.g. "Main Panel Size" → "Electrical Service & Scope") → still resolves
 *                for compatibility, with a warning; reports should use the native field
 *   deprecated   an administrator retired it (still resolves, with a warning)
 *
 * The declaration comes from the business-fields spreadsheet (source name, entity, type) or
 * the built-in vocabulary match. A repair is "certain" only when the declaration has exactly
 * one verified exact match (same normalized name, fitting entity, compatible type).
 */

import "server-only";

import { matchRequested, normalizeName, type BusinessFieldRow } from "./business-fields";
import { SEMANTIC_DEFAULTS, type CustomFieldRow } from "./metadata";

export type AliasStatus =
  "ok" | "unmapped" | "stale" | "conflict" | "ambiguous" | "shared_text" | "deprecated";

export type FieldBrief = { id: string; name: string; type: string; target: string };

export type AliasFinding = {
  key: string;
  ref: string;
  label: string;
  status: AliasStatus;
  reason: string | null;
  target: (FieldBrief & { removed: boolean }) | null;
  declared: { name: string; entity: string; type: string | null } | null;
  /** Certain repair: the declaration's single verified exact match. */
  repair: FieldBrief | null;
  /** Typed fields that might be intended (ambiguous only); never chosen automatically. */
  candidates: FieldBrief[];
  /** Other aliases pointing at the same field. */
  sharedWith: string[];
};

const TEXT_TYPES = new Set(["text", "textarea", "longtext", "richtext", "string"]);
const letters = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z]/g, "");
/** Words too common in Acton field names to identify a field on their own. */
const COMMON = new Set([
  "adu",
  "main",
  "home",
  "required",
  "requirement",
  "requirements",
  "size",
  "current",
  "total",
  "the",
  "and",
  "of",
  "notes",
  "special",
  "type",
  "status",
]);
const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/s$/, ""))
      .filter((w) => w.length > 2 && !COMMON.has(w) && !COMMON.has(`${w}s`)),
  );

const ENTITY_CATEGORY: Record<string, string> = {
  job: "Jobs",
  location: "Locations",
  customer: "Customer Accounts",
};

const brief = (f: CustomFieldRow): FieldBrief => ({
  id: f.id,
  name: f.display_name || f.name,
  type: f.type,
  target: f.target_type,
});

function declarationOf(
  a: BusinessFieldRow,
): { category: string; name: string; type: string | null; entity: string } | null {
  if (a.source_name && (a.source_category || a.requested_target))
    return {
      category: a.source_category ?? ENTITY_CATEGORY[a.requested_target ?? ""] ?? "",
      name: a.source_name,
      type: a.requested_type ?? null,
      entity: a.requested_target ?? a.source_category ?? "",
    };
  const def = SEMANTIC_DEFAULTS.find((d) => d.key === a.key)?.match;
  return def
    ? {
        category: ENTITY_CATEGORY[def.target] ?? "",
        name: def.name,
        type: null,
        entity: def.target,
      }
    : null;
}

export function analyzeAliases(
  aliases: BusinessFieldRow[],
  fields: CustomFieldRow[],
): Map<string, AliasFinding> {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const active = fields.filter((f) => !f.removed_at);
  const live = aliases.filter((a) => !a.archived_at);
  const byTarget = new Map<string, string[]>();
  for (const a of live)
    if (a.custom_field_id)
      byTarget.set(a.custom_field_id, [...(byTarget.get(a.custom_field_id) ?? []), a.key]);

  const out = new Map<string, AliasFinding>();
  for (const a of live) {
    const declared = declarationOf(a);
    const target = a.custom_field_id ? byId.get(a.custom_field_id) : undefined;
    const finding: AliasFinding = {
      key: a.key,
      ref: `sem:${a.key}`,
      label: a.label,
      status: "ok",
      reason: null,
      target: target ? { ...brief(target), removed: Boolean(target.removed_at) } : null,
      declared: declared
        ? { name: declared.name, entity: declared.entity, type: declared.type }
        : null,
      repair: null,
      candidates: [],
      sharedWith: a.custom_field_id
        ? (byTarget.get(a.custom_field_id) ?? []).filter((k) => k !== a.key)
        : [],
    };
    out.set(a.key, finding);
    const match = declared
      ? matchRequested(
          { category: declared.category, name: declared.name, type: declared.type },
          active,
        )
      : null;
    const exact = match?.status === "exact" ? match.field : null;

    if (!a.custom_field_id) {
      finding.status = "unmapped";
      finding.reason = "Not mapped to a JobTread field.";
      if (exact) finding.repair = brief(exact);
      continue;
    }
    if (!target || target.removed_at) {
      finding.status = "stale";
      finding.reason = `Its JobTread field ${target ? `“${target.name}” ` : ""}(${a.custom_field_id}) no longer exists.`;
      if (exact) finding.repair = brief(exact);
      continue;
    }
    if (exact && exact.id !== target.id) {
      finding.status = "conflict";
      finding.repair = brief(exact);
      finding.reason = `Declared as “${declared!.name}” (${declared!.entity}${declared!.type ? `, ${declared!.type}` : ""}), which is JobTread field ${exact.id}, but it points at “${target.name}” (${target.id}).`;
      continue;
    }
    if (a.review_status === "deprecated") {
      finding.status = "deprecated";
      finding.reason =
        a.review_note || "Retired by an administrator; use the native field instead.";
      continue;
    }
    const isText = TEXT_TYPES.has(letters(target.type));
    const labelMatches =
      normalizeName(a.label) === normalizeName(target.name) ||
      (target.display_name && normalizeName(a.label) === normalizeName(target.display_name));
    if (!isText || labelMatches || a.review_status === "verified") continue;
    // A label that only shortens or extends the field's own name ("Permit" → "Permit Number")
    // is the same field under a business name; one that adds concepts the field's name lacks
    // ("Main Panel Size" → "Electrical Service & Scope"), or that shares the field with other
    // aliases, presents a narrative blob as if it were its own value.
    const nameTokens = tokens(target.display_name || target.name);
    const addsConcepts = (label: string) => [...tokens(label)].some((t) => !nameTokens.has(t));
    // Sharing matters only with aliases that mean something else (an honestly named alias of
    // the same field, like "Permit Number", is just a synonym).
    const otherMeanings = finding.sharedWith.filter((k) => {
      const other = live.find((x) => x.key === k);
      return other ? addsConcepts(other.label) : false;
    });
    if (!addsConcepts(a.label) && otherMeanings.length === 0) continue;
    const want = tokens(`${declared?.name ?? ""} ${a.label}`);
    finding.candidates = active
      .filter(
        (f) =>
          f.id !== target.id &&
          f.target_type === target.target_type &&
          !TEXT_TYPES.has(letters(f.type)) &&
          [...tokens(f.name)].some((t) => want.has(t)),
      )
      .map(brief);
    if (finding.candidates.length >= 2) {
      finding.status = "ambiguous";
      finding.reason = `Points at the shared text field “${target.name}”; JobTread has several fields it could mean (${finding.candidates
        .map((c) => `“${c.name}”`)
        .join(", ")}). Choose one — it won't be guessed.`;
    } else {
      finding.candidates = [];
      finding.status = "shared_text";
      finding.reason = `“${a.label}” reads the whole “${target.name}” text field${finding.sharedWith.length ? ` (shared with ${finding.sharedWith.map((k) => `sem:${k}`).join(", ")})` : ""}; it isn't a separate structured value. Use the native field cf:${target.id}.`;
    }
  }
  return out;
}
