/** Pure rule matching shared by region, model-scope, and option-group mappings. */

export type MatchType = "prefix" | "exact" | "contains";

/** First matching rule wins: lower priority number first, then the longest pattern. */
export function applyValueMappings(
  text: string | null | undefined,
  rules: Array<{ match_type: MatchType; pattern: string; value: string; priority: number }>,
): string | null {
  if (!text) return null;
  const subject = text.trim().toLowerCase();
  const ordered = [...rules].sort(
    (a, b) => a.priority - b.priority || b.pattern.length - a.pattern.length,
  );
  for (const r of ordered) {
    const p = r.pattern.trim().toLowerCase();
    if (!p) continue;
    if (
      (r.match_type === "exact" && subject === p) ||
      (r.match_type === "prefix" && subject.startsWith(p)) ||
      (r.match_type === "contains" && subject.includes(p))
    )
      return r.value;
  }
  return null;
}
