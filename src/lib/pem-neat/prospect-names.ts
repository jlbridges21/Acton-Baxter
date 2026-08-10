/**
 * Multi-prospect name helpers for PEM NEATs.
 * Pure (no I/O) so create/edit UI, matching, and migrations can share them.
 */

/** Separators used when splitting legacy combined `prospect_name` strings. */
const SPLIT_PATTERN = /\s*(?:&|\+|,(?!\s*jr\.?\b)|\band\b)\s*/i;

/**
 * Best-effort split of a combined display name into individual prospects.
 * "Cindy Lee & Razel Talle" → ["Cindy Lee", "Razel Talle"]
 * "Richard & Jeannie L" → ["Richard", "Jeannie L"]
 * "Sharon Liu" → ["Sharon Liu"]
 * Does not split on "and" inside a single token (e.g. "Amanda" is untouched);
 * only the standalone word "and" between names.
 */
export function splitProspectNameString(raw: string | null | undefined): string[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];

  // Protect common name particles that include "and" as a substring only via word boundary.
  const parts = trimmed
    .split(SPLIT_PATTERN)
    .map((p) => p.trim())
    .filter(Boolean);

  // Dedupe while preserving order (case-insensitive).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out.length > 0 ? out : [trimmed];
}

/** Normalize a user-entered list: trim, drop empties, dedupe (case-insensitive). */
export function normalizeProspectNamesList(names: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Human-facing label stored in `prospect_name` — join with " & ". */
export function formatProspectDisplayName(names: string[]): string {
  const normalized = normalizeProspectNamesList(names);
  if (normalized.length === 0) return "";
  return normalized.join(" & ");
}

/**
 * Authoritative match set for a NEAT:
 * 1) structured `prospect_names` when present
 * 2) plus query-time split of the display `prospect_name` as a safety net
 */
export function prospectNamesForMatching(input: {
  prospectName: string;
  prospectNames?: string[] | null;
}): string[] {
  const fromStructured = normalizeProspectNamesList(input.prospectNames ?? []);
  const fromDisplay = splitProspectNameString(input.prospectName);
  const display = (input.prospectName ?? "").trim();

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (name: string) => {
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };

  for (const n of fromStructured) push(n);
  for (const n of fromDisplay) push(n);
  if (display) push(display);

  return out;
}

/**
 * Resolve create/update payload into display name + structured list.
 * Prefers `prospectNames` when provided; falls back to splitting `prospectName`.
 */
export function resolveProspectNamesInput(input: {
  prospectName?: string | null;
  prospectNames?: string[] | null;
}): { prospectName: string; prospectNames: string[] } {
  const fromList = normalizeProspectNamesList(input.prospectNames ?? []);
  if (fromList.length > 0) {
    return {
      prospectNames: fromList,
      prospectName: formatProspectDisplayName(fromList),
    };
  }
  const single = (input.prospectName ?? "").trim();
  const split = splitProspectNameString(single);
  const names = split.length > 0 ? split : single ? [single] : [];
  return {
    prospectNames: names,
    prospectName: formatProspectDisplayName(names) || single,
  };
}

/** Prompt block for generation — lists each homeowner when multiple. */
export function formatProspectPromptBlock(names: string[]): string {
  const normalized = normalizeProspectNamesList(names);
  if (normalized.length === 0) return "Prospect: (unknown)";
  if (normalized.length === 1) return `Prospect: ${normalized[0]}`;
  return [
    `Prospects: ${formatProspectDisplayName(normalized)}`,
    `Individual homeowner names: ${normalized.join("; ")}`,
  ].join("\n");
}
