import type { BaxterContextItem, BaxterSourceReference } from "./types";

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

export function contextItemToSourceReference(item: BaxterContextItem): BaxterSourceReference {
  return {
    title: item.title,
    sourceName: item.sourceName,
    category: item.category,
    sourceUrl: isSafeHttpUrl(item.sourceUrl) ? item.sourceUrl : null,
    citationLabel: item.citationLabel,
  };
}

export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export const INSUFFICIENT_KNOWLEDGE_ANSWER =
  "I don’t have enough approved Acton knowledge to answer that confidently. An admin can add the missing procedure or policy to the Knowledge Base.";
