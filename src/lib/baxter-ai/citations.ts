import type { BaxterContextItem, BaxterSourceKind, BaxterSourceReference } from "./types";
import { GOOGLE_DOC_MIME, GOOGLE_SHEET_MIME } from "@/lib/connectors/google/types";

/**
 * Map model-cited temporary source numbers to real retrieved Knowledge Base records.
 * Never trust model-invented titles or URLs.
 * Deduplicates Slack sources by permalink (or channel+ts) so one thread isn't five cards.
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
    if (!item) continue;
    const dedupeKey = item.sourceType === "slack" ? item.sourceUrl || item.id : item.id;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    sources.push(contextItemToSourceReference(item));
  }

  return sources;
}

/** Deduplicate already-built source references (e.g. after merge). */
export function dedupeSourceReferences(sources: BaxterSourceReference[]): BaxterSourceReference[] {
  const seen = new Set<string>();
  const out: BaxterSourceReference[] = [];
  for (const source of sources) {
    const key =
      source.sourceKind === "slack"
        ? source.sourceUrl || source.knowledgeEntryId || source.citationLabel
        : source.knowledgeEntryId || source.citationLabel;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

export function resolveSourceKind(input: {
  sourceType: string;
  mimeType?: string | null;
}): BaxterSourceKind {
  const t = input.sourceType.toLowerCase();
  if (t === "slack") return "slack";
  if (t === "pem_neat" || t === "pem neat") return "pem_neat";
  if (t === "gohighlevel" || t === "go highlevel") return "gohighlevel";
  if (t === "rulebook" || t === "process_rulebook") return "rulebook";
  if (t === "capability" || t === "baxter_capability") return "capability";
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
    case "pem_neat":
      return "Open NEAT";
    case "gohighlevel":
      return "Open GoHighLevel";
    case "rulebook":
      return "Open Rulebook";
    case "capability":
      return "Open in Baxter";
    case "slack":
      return "View in Slack";
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
  if (isSafeHttpUrl(item.sourceUrl)) {
    sourceUrl = item.sourceUrl;
  } else if (sourceKind === "pem_neat") {
    sourceUrl = item.sourceUrl?.startsWith("/pem-neats/")
      ? item.sourceUrl
      : `/pem-neats/${item.id}`;
  } else if (sourceKind === "capability" && item.sourceUrl?.startsWith("/")) {
    sourceUrl = item.sourceUrl;
  } else if (sourceKind === "knowledge_entry" || sourceKind === "manual") {
    sourceUrl = `/knowledge/${item.id}`;
  }

  let citationLabel = item.citationLabel;
  if (item.pageNumber != null && !/page\s+\d+/i.test(citationLabel)) {
    citationLabel = `${citationLabel} — Page ${item.pageNumber}`;
  } else if (item.slideNumber != null && !/slide\s+\d+/i.test(citationLabel)) {
    citationLabel = `${citationLabel} — Slide ${item.slideNumber}`;
  }

  return {
    title: item.title,
    sourceName: item.sourceName,
    category: item.category,
    sourceUrl,
    citationLabel,
    sourceKind,
    openLabel: resolveOpenLabel(sourceKind),
    lastUpdated: item.updatedAt,
    relevanceScore: item.relevanceScore,
    availability: sourceUrl ? "available" : "unavailable",
    knowledgeEntryId: item.id,
    pageNumber: item.pageNumber ?? null,
    slideNumber: item.slideNumber ?? null,
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
  if (value.startsWith("/pem-neats")) return true;
  if (value.startsWith("/settings/")) return true;
  if (
    value.startsWith("/dashboard") ||
    value.startsWith("/reports") ||
    value.startsWith("/admin/") ||
    value === "/"
  ) {
    return true;
  }
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
  "I couldn’t find an approved Acton source covering that.";

export const GENERAL_KNOWLEDGE_NOTE =
  "This answer is based on general knowledge rather than an approved Acton source.";
