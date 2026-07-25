import type { BaxterContextItem } from "@/lib/baxter-ai/types";
import type { StructuredSearchResult } from "./types";

/**
 * Build compact structured evidence for the LLM (and diagnostics).
 */
export function buildStructuredEvidencePackage(result: StructuredSearchResult): string {
  const parts: string[] = [];

  if (result.clarificationPrompt) {
    parts.push("CLARIFICATION NEEDED:");
    parts.push(result.clarificationPrompt);
    return parts.join("\n");
  }

  for (const hit of result.lookups.slice(0, 3)) {
    parts.push(`SOURCE: ${hit.entryTitle}`);
    parts.push(`Type: Google Sheet / structured table`);
    parts.push(`Sheet: ${hit.sheetName}`);
    if (hit.sourceUrl) parts.push(`URL: ${hit.sourceUrl}`);
    parts.push(`MATCHED RECORD: ${hit.entityLabel}`);
    for (const [k, v] of Object.entries(hit.relatedValues)) {
      parts.push(`${k}: ${v}`);
    }
    if (hit.requestedField) {
      parts.push(`USER REQUESTED: ${hit.requestedField}`);
    }
    if (hit.directValue) {
      parts.push(`DIRECT VALUE: ${hit.directValue}`);
    }
    parts.push("");
  }

  for (const agg of result.aggregates.slice(0, 3)) {
    parts.push(`SOURCE: ${agg.entryTitle}`);
    parts.push(`AGGREGATION: ${agg.operation}${agg.field ? ` of ${agg.field}` : ""}`);
    parts.push(`FILTER: ${agg.filterDescription}`);
    parts.push(`RESULT: ${agg.displayValue}`);
    parts.push(`Matched rows: ${agg.matchedRowCount}`);
    if (agg.sourceUrl) parts.push(`URL: ${agg.sourceUrl}`);
    parts.push("");
  }

  return parts.join("\n").trim();
}

export function structuredHitsToContextItems(
  result: StructuredSearchResult,
  startNumber = 1,
): BaxterContextItem[] {
  const items: BaxterContextItem[] = [];
  let n = startNumber;

  for (const hit of result.lookups.slice(0, 3)) {
    const excerpt = [
      hit.requestedField && hit.directValue ? `${hit.requestedField}: ${hit.directValue}` : null,
      ...Object.entries(hit.relatedValues).map(([k, v]) => `${k}: ${v}`),
      `Sheet: ${hit.sheetName}`,
    ]
      .filter(Boolean)
      .join("\n");
    items.push({
      number: n++,
      id: hit.knowledgeEntryId,
      title: hit.entryTitle,
      summary: `Structured match: ${hit.entityLabel}`,
      contentExcerpt: excerpt,
      category: "Google Workspace",
      tags: ["structured", "spreadsheet"],
      sourceName: hit.sheetName,
      sourceUrl: hit.sourceUrl,
      sourceType: "Google Drive",
      mimeType: "application/vnd.google-apps.spreadsheet",
      updatedAt: new Date().toISOString(),
      citationLabel: `${hit.entryTitle} (${hit.sheetName})`,
      relevanceScore: hit.score,
    });
  }

  for (const agg of result.aggregates.slice(0, 2)) {
    items.push({
      number: n++,
      id: agg.knowledgeEntryId,
      title: agg.entryTitle,
      summary: `Structured ${agg.operation}`,
      contentExcerpt: `${agg.operation}${agg.field ? ` ${agg.field}` : ""} = ${agg.displayValue} (${agg.filterDescription}; ${agg.matchedRowCount} rows)`,
      category: "Google Workspace",
      tags: ["structured", "aggregate"],
      sourceName: null,
      sourceUrl: agg.sourceUrl,
      sourceType: "Google Drive",
      mimeType: "application/vnd.google-apps.spreadsheet",
      updatedAt: new Date().toISOString(),
      citationLabel: agg.entryTitle,
      relevanceScore: 95,
    });
  }

  return items;
}

/**
 * When structured evidence has a direct value, draft a high-confidence answer.
 * The LLM may polish, but this prevents "couldn't find" when the value is known.
 */
export function draftDirectStructuredAnswer(
  question: string,
  result: StructuredSearchResult,
): string | null {
  if (result.ambiguous && result.clarificationPrompt) return result.clarificationPrompt;

  const hit = result.lookups[0];
  if (hit?.directValue && hit.requestedField) {
    const related = hit.relatedValues;
    const lines = [
      `The ${hit.entityLabel} ${humanizeField(hit.requestedField).toLowerCase()} was ${hit.directValue}.`,
    ];
    const extras: string[] = [];
    if (related["Close Date"] && !/close/i.test(question)) {
      extras.push(`closed ${related["Close Date"]}`);
    }
    if (related["Project Sq Ft"]) extras.push(`${related["Project Sq Ft"]}`);
    if (related["Project Type (BR/Custom)"] || related["Project Type"]) {
      extras.push(`${related["Project Type (BR/Custom)"] || related["Project Type"]} project`);
    }
    if (related["Internal Cost (Est.)"] && /cost|margin|agreement/i.test(question)) {
      extras.push(`estimated internal cost ${related["Internal Cost (Est.)"]}`);
    }
    if (related["Estimated Gross Margin $"] && /margin|agreement/i.test(question)) {
      const pct = related["Gross Margin %"];
      extras.push(
        `estimated gross margin ${related["Estimated Gross Margin $"]}${pct ? ` (${pct})` : ""}`,
      );
    }
    if (extras.length) {
      lines.push(`The report lists it as ${extras.join(", ")}.`);
    }
    if (/actual cost|actually cost/i.test(question) && related["Internal Cost (Est.)"]) {
      return `The report lists an estimated internal cost of ${related["Internal Cost (Est.)"]}. It does not identify that number as the final actual cost.`;
    }
    lines.push(`Source: ${hit.entryTitle}`);
    return lines.join("\n\n");
  }

  const agg = result.aggregates[0];
  if (agg) {
    const label = result.plan.timeRange?.label;
    let answer: string;

    if (label && result.plan.weightedMargin) {
      answer = `Based on the Sales Performance Report, gross margin for ${label} is ${agg.displayValue} (weighted by agreement value).`;
    } else if (label && agg.operation === "count") {
      answer = `We've sold ${agg.matchedRowCount} projects in ${label}.`;
    } else if (label && agg.operation === "sum" && /agreement amount/i.test(agg.field ?? "")) {
      answer = `Based on the Sales Performance Report, Acton has sold ${agg.displayValue} in agreement value across ${agg.matchedRowCount} projects in ${label}.`;
    } else if (label && agg.operation === "average") {
      answer = `Based on the Sales Performance Report, the average ${humanizeField(agg.field ?? "value").toLowerCase()} in ${label} is ${agg.displayValue} across ${agg.matchedRowCount} projects.`;
    } else if (label) {
      answer = `Based on the Sales Performance Report, ${agg.operation}${agg.field ? ` of ${humanizeField(agg.field)}` : ""} for ${label} is ${agg.displayValue}.`;
    } else {
      answer = agg.displayValue;
    }

    return `${answer}\n\nSource: ${agg.entryTitle}`;
  }

  return null;
}

function humanizeField(field: string): string {
  return field
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
