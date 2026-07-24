import type { BaxterContextItem, BaxterSourceKind, BaxterSourceReference } from "./types";
import { GOOGLE_DOC_MIME, GOOGLE_SHEET_MIME } from "@/lib/connectors/google/types";

/**
 * Map model-cited temporary source numbers to real retrieved Knowledge Base records.
 * Never trust model-invented titles or URLs.
 */
export function mapUsedSourceNumbers(
  usedSourceNumbers: number[],
  contextItems: BaxterContextItem[],
): BaxterSourceReference[] {
  const byNumber = new Map(contextItems.map((item) => [item.number, item]));
  const seen = new Set<string>();
  const sources: BaxterSourceReference[] = [];

  for (const number of usedSourceNumbers) {
    const item = byNumber.get(number);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    sources.push(contextItemToSourceReference(item));
  }

  return sources;
}

export function resolveSourceKind(input: {
  sourceType: string;
  mimeType?: string | null;
}): BaxterSourceKind {
  if (input.sourceType === "Google Drive") {
    if (input.mimeType === GOOGLE_DOC_MIME) return "google_doc";
    if (input.mimeType === GOOGLE_SHEET_MIME) return "google_sheet";
    return "google_file";
  }
  return "knowledge_entry";
}

export function resolveOpenLabel(kind: BaxterSourceKind): string {
  switch (kind) {
    case "google_doc":
      return "Open Google Doc";
    case "google_sheet":
      return "Open Google Sheet";
    case "google_file":
      return "Open Google File";
    default:
      return "Open Knowledge Entry";
  }
}

export function contextItemToSourceReference(item: BaxterContextItem): BaxterSourceReference {
  const sourceKind = resolveSourceKind({
    sourceType: item.sourceType,
    mimeType: item.mimeType,
  });

  let sourceUrl: string | null = null;
  if (isSafeAbsoluteHttpUrl(item.sourceUrl)) {
    sourceUrl = item.sourceUrl;
  } else if (sourceKind === "knowledge_entry" || sourceKind === "manual") {
    sourceUrl = `/knowledge/${item.id}`;
  }

  return {
    title: item.title,
    sourceName: item.sourceName,
    category: item.category,
    sourceUrl,
    citationLabel: item.citationLabel,
    sourceKind,
    openLabel: resolveOpenLabel(sourceKind),
    lastUpdated: item.updatedAt,
    relevanceScore: item.relevanceScore,
    availability: sourceUrl ? "available" : "unavailable",
    knowledgeEntryId: item.id,
  };
}

export function isSafeAbsoluteHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  if (value.startsWith("/knowledge/")) return true;
  return isSafeAbsoluteHttpUrl(value);
}

export function formatRelativeUpdated(iso: string | null): string {
  if (!iso) return "Unknown";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "Unknown";
  const diffMs = Date.now() - then;
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  if (days < 14) return `Updated ${days} days ago`;
  return `Updated ${new Date(iso).toLocaleDateString()}`;
}

export const INSUFFICIENT_KNOWLEDGE_ANSWER =
  "I don’t have enough approved Acton knowledge to answer that confidently. An admin can add the missing procedure or policy to the Knowledge Base.";
