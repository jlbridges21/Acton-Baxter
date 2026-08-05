import type { KnowledgeEntry } from "@/lib/knowledge/types";
import { listKnowledgeEntries } from "@/lib/knowledge/store";
import { getJurisdictionDisplayName, type SupportedJurisdictionKey } from "./keys";
import { getJurisdictionRuleKeyLabel } from "./rule-keys";
import { listJurisdictionRules } from "./rules-store";
import type {
  AduCodeHighlights,
  AduCodeHighlightsDocument,
  AduCodeHighlightsRule,
  JurisdictionRule,
  JurisdictionRuleValueJson,
  KnowledgeDocKind,
} from "./types";
import { KNOWLEDGE_DOC_KINDS } from "./types";

const CODE_DOC_KINDS = new Set<string>(KNOWLEDGE_DOC_KINDS);

export function formatJurisdictionRuleValue(value: JurisdictionRuleValueJson): string {
  if (value.kind === "quantity") {
    return `${value.value} ${value.unit}`.trim();
  }
  const parts = Object.entries(value.fields).map(([key, fieldValue]) => {
    if (fieldValue == null) return `${key}: —`;
    if (typeof fieldValue === "object") return `${key}: ${JSON.stringify(fieldValue)}`;
    return `${key}: ${String(fieldValue)}`;
  });
  return parts.join("; ") || "—";
}

function normalizeZone(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Prefer zone-specific rules when zoning matches; otherwise jurisdiction-general
 * (zone_key is null). Never mix zone A rules into zone B.
 */
export function selectRulesForZoning(
  rules: JurisdictionRule[],
  zoning: string | null | undefined,
): {
  selected: JurisdictionRule[];
  usedZoneSpecificRules: boolean;
  fellBackToGeneralRules: boolean;
} {
  const zoneNorm = normalizeZone(zoning);
  const general = rules.filter((rule) => !rule.zone_key);
  if (!zoneNorm) {
    return {
      selected: general,
      usedZoneSpecificRules: false,
      fellBackToGeneralRules: false,
    };
  }

  const zoneSpecific = rules.filter(
    (rule) => rule.zone_key && normalizeZone(rule.zone_key) === zoneNorm,
  );
  if (zoneSpecific.length > 0) {
    return {
      selected: zoneSpecific,
      usedZoneSpecificRules: true,
      fellBackToGeneralRules: false,
    };
  }

  return {
    selected: general,
    usedZoneSpecificRules: false,
    fellBackToGeneralRules: general.length > 0,
  };
}

function toHighlightRule(rule: JurisdictionRule): AduCodeHighlightsRule {
  return {
    id: rule.id,
    ruleKey: rule.rule_key,
    label: getJurisdictionRuleKeyLabel(rule.rule_key),
    zoneKey: rule.zone_key,
    displayValue: formatJurisdictionRuleValue(rule.value_json),
    sourceCitation: rule.source_citation,
    notes: rule.notes,
    sourceKnowledgeEntryId: rule.source_knowledge_entry_id,
  };
}

function toHighlightDocument(entry: KnowledgeEntry): AduCodeHighlightsDocument {
  return {
    id: entry.id,
    title: entry.title,
    docKind: (entry.doc_kind as KnowledgeDocKind | null) ?? null,
    sourceName: entry.source_name,
    sourceUrl: entry.source_url,
    knowledgeViewerHref: `/admin/knowledge/${entry.id}`,
  };
}

export function isCodeDocumentEntry(entry: KnowledgeEntry): boolean {
  return Boolean(entry.doc_kind && CODE_DOC_KINDS.has(entry.doc_kind));
}

export async function listCodeDocumentsForJurisdiction(
  jurisdictionKey: string,
): Promise<KnowledgeEntry[]> {
  const entries = await listKnowledgeEntries({ status: "all" });
  return entries
    .filter(
      (entry) =>
        entry.jurisdiction_key === jurisdictionKey &&
        isCodeDocumentEntry(entry) &&
        entry.status !== "archived",
    )
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function buildAduCodeHighlights(input: {
  jurisdictionKey: SupportedJurisdictionKey | null;
  zoning?: string | null;
}): Promise<AduCodeHighlights> {
  const jurisdictionName = getJurisdictionDisplayName(input.jurisdictionKey);
  if (!input.jurisdictionKey) {
    return {
      jurisdictionKey: null,
      jurisdictionName,
      zoning: input.zoning ?? null,
      usedZoneSpecificRules: false,
      fellBackToGeneralRules: false,
      rules: [],
      documents: [],
      isEmpty: true,
    };
  }

  const [allRules, documents] = await Promise.all([
    listJurisdictionRules({ jurisdictionKey: input.jurisdictionKey }),
    listCodeDocumentsForJurisdiction(input.jurisdictionKey),
  ]);

  const { selected, usedZoneSpecificRules, fellBackToGeneralRules } = selectRulesForZoning(
    allRules,
    input.zoning,
  );

  const rules = selected
    .slice()
    .sort((a, b) => a.rule_key.localeCompare(b.rule_key))
    .map(toHighlightRule);

  const docs = documents.map(toHighlightDocument);
  const isEmpty = rules.length === 0 && docs.length === 0;

  return {
    jurisdictionKey: input.jurisdictionKey,
    jurisdictionName,
    zoning: input.zoning ?? null,
    usedZoneSpecificRules,
    fellBackToGeneralRules,
    rules,
    documents: docs,
    isEmpty,
  };
}
