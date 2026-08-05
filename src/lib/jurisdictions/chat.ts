import {
  detectJurisdictionKeyFromText,
  getJurisdictionDisplayName,
  type SupportedJurisdictionKey,
} from "./keys";
import { formatJurisdictionRuleValue } from "./code-highlights";
import { getJurisdictionRuleKeyLabel } from "./rule-keys";
import { listJurisdictionRules } from "./rules-store";
import type { BaxterContextItem } from "@/lib/baxter-ai/types";

const CODE_QUESTION_RE =
  /\b(adu|setback|sprinkler|building\s+code|municipal\s+code|ordinance|max(?:imum)?\s+height|max(?:imum)?\s+size|fire\s+hydrant|hydrant\s+distance|zoning\s+code)\b/i;

export function looksLikeBuildingCodeQuestion(question: string): boolean {
  return CODE_QUESTION_RE.test(question);
}

export function resolveChatJurisdictionKey(
  question: string,
  options?: { jurisdictionKey?: string | null },
): SupportedJurisdictionKey | null {
  if (options?.jurisdictionKey) {
    return options.jurisdictionKey as SupportedJurisdictionKey;
  }
  return detectJurisdictionKeyFromText(question);
}

/**
 * Deterministic structured rules as citation-ready chat evidence.
 * Only used when the question looks like a building-code inquiry.
 */
export async function buildJurisdictionRuleContextItems(input: {
  question: string;
  jurisdictionKey: SupportedJurisdictionKey;
  startNumber?: number;
}): Promise<BaxterContextItem[]> {
  const rules = await listJurisdictionRules({ jurisdictionKey: input.jurisdictionKey });
  if (rules.length === 0) return [];

  const jurisdictionName = getJurisdictionDisplayName(input.jurisdictionKey);
  const general = rules.filter((rule) => !rule.zone_key);
  // Prefer general rules in chat unless the question names a zone (future: zone parse).
  const selected = general.length > 0 ? general : rules;
  let number = input.startNumber ?? 1;

  return selected.slice(0, 6).map((rule) => {
    const item: BaxterContextItem = {
      number: number++,
      id: `jurisdiction-rule:${rule.id}`,
      title: `${getJurisdictionRuleKeyLabel(rule.rule_key)} (${jurisdictionName})`,
      summary: rule.notes,
      contentExcerpt: [
        `Value: ${formatJurisdictionRuleValue(rule.value_json)}`,
        `Source citation: ${rule.source_citation}`,
        rule.zone_key ? `Zone: ${rule.zone_key}` : "Scope: jurisdiction-general",
        "Preparation material only — not a code determination.",
      ].join("\n"),
      category: "Jurisdiction Rule",
      tags: ["jurisdiction_rule", rule.rule_key, input.jurisdictionKey],
      sourceName: rule.source_citation,
      sourceUrl: null,
      sourceType: "manual",
      mimeType: null,
      updatedAt: rule.updated_at,
      citationLabel: `${rule.source_citation} — ${getJurisdictionRuleKeyLabel(rule.rule_key)}`,
      relevanceScore: 95,
    };
    return item;
  });
}
