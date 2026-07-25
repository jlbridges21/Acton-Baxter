import "server-only";

import { resolveFieldToHeader } from "./aliases";
import { planKnowledgeQuery } from "./query-planner";
import { listAllSpreadsheetRowUnits } from "./units-store";
import type {
  KnowledgeQueryPlan,
  ParsedCellValue,
  StructuredAggregateHit,
  StructuredLookupHit,
  StructuredSearchResult,
} from "./types";
import { formatFriendlyDate, normalizeEntityText } from "./values";
import { listAllKnowledgeEntriesForRetrieval } from "@/lib/knowledge/store";
import { canEmployeeReadEntry } from "@/lib/knowledge/permissions";

type RowValues = Record<string, ParsedCellValue>;

function getValues(unit: { structured_data: Record<string, unknown> }): RowValues | null {
  const values = unit.structured_data.values as RowValues | undefined;
  if (values && typeof values === "object") return values;
  const metrics = unit.structured_data.metrics as RowValues | undefined;
  if (metrics && typeof metrics === "object") return metrics;
  return null;
}

function entityMatchesRow(entity: string, values: RowValues, title: string | null): number {
  const target = normalizeEntityText(entity);
  if (!target) return 0;
  let best = 0;
  const candidates = [title ?? "", ...Object.values(values).map((v) => v.display)];
  for (const c of candidates) {
    const n = normalizeEntityText(c);
    if (!n) continue;
    if (n === target) best = Math.max(best, 100);
    else if (n.includes(target) || target.includes(n)) best = Math.max(best, 80);
    else {
      // Token overlap for "Lori Harris" vs "Lori Harris - Detached ADU"
      const tTokens = new Set(target.split(" "));
      const cTokens = n.split(" ");
      const overlap = cTokens.filter((t) => tTokens.has(t)).length;
      if (overlap >= 2 && overlap === tTokens.size) best = Math.max(best, 90);
      else if (overlap >= 2) best = Math.max(best, 60);
    }
  }
  return best;
}

function displayForField(values: RowValues, field: string | null): string | null {
  if (!field) return null;
  const headers = Object.keys(values);
  const header = resolveFieldToHeader(field, headers) ?? headers.find((h) => h === field);
  if (!header) return null;
  const cell = values[header];
  if (!cell?.display) return null;
  if (cell.kind === "date") return formatFriendlyDate(cell.display, cell.dateIso);
  return cell.display;
}

function relatedDisplay(values: RowValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v.display) out[k] = v.display;
  }
  return out;
}

function passesFilters(values: RowValues, filters: KnowledgeQueryPlan["filters"]): boolean {
  for (const filter of filters) {
    const headers = Object.keys(values);
    const header = resolveFieldToHeader(filter.field, headers) ?? filter.field;
    const cell = values[header];
    if (!cell) return false;
    const n = normalizeEntityText(cell.display);
    const want = normalizeEntityText(filter.value);
    if (n !== want && !n.includes(want) && !want.includes(n)) return false;
  }
  return true;
}

/**
 * Structured knowledge search — exact row/field lookup and safe aggregates.
 */
export async function searchStructuredKnowledge(
  question: string,
  planInput?: KnowledgeQueryPlan,
): Promise<StructuredSearchResult> {
  const plan = planInput ?? planKnowledgeQuery(question);
  const entries = (await listAllKnowledgeEntriesForRetrieval()).filter(canEmployeeReadEntry);
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const units = await listAllSpreadsheetRowUnits();
  const approvedUnits = units.filter((u) => entryById.has(u.knowledge_entry_id));

  const lookups: StructuredLookupHit[] = [];
  const aggregates: StructuredAggregateHit[] = [];

  // Summary metrics / aggregate without entity
  if (plan.mode === "structured_aggregate" || plan.aggregation || plan.entities.length === 0) {
    // Prefer summary_metrics units for totals/avg when no entity
    if (plan.entities.length === 0) {
      for (const unit of approvedUnits.filter((u) => u.unit_type === "summary_metrics")) {
        const entry = entryById.get(unit.knowledge_entry_id)!;
        const values = getValues(unit);
        if (!values) continue;
        for (const field of preferredSummaryFields(plan.requestedFields, values)) {
          const display = displayForField(values, field);
          if (!display) continue;
          aggregates.push({
            knowledgeEntryId: entry.id,
            entryTitle: entry.title,
            sourceUrl: entry.source_url,
            operation: plan.aggregation === "count" ? "count" : plan.aggregation || "sum",
            field,
            displayValue: display,
            numericValue:
              values[resolveFieldToHeader(field, Object.keys(values)) ?? field]?.numeric ?? null,
            matchedRowCount: 1,
            filterDescription: "summary metrics",
          });
        }
      }

      // Row-level aggregation when filters or max/min/avg/count over rows
      if (
        (plan.aggregation && plan.aggregation !== "count") ||
        plan.filters.length > 0 ||
        plan.aggregation === "count"
      ) {
        const rows = approvedUnits.filter((u) => u.unit_type === "spreadsheet_row");
        // Prefer curated sheets
        const preferred = preferUniqueRows(rows);
        const filtered = preferred.filter((u) => {
          const values = getValues(u);
          return values ? passesFilters(values, plan.filters) : false;
        });

        if (plan.aggregation === "count" || /\bhow many\b/i.test(question)) {
          const entry = filtered[0] ? entryById.get(filtered[0].knowledge_entry_id) : entries[0];
          if (entry) {
            aggregates.push({
              knowledgeEntryId: entry.id,
              entryTitle: entry.title,
              sourceUrl: entry.source_url,
              operation: "count",
              field: null,
              displayValue: String(filtered.length),
              numericValue: filtered.length,
              matchedRowCount: filtered.length,
              filterDescription:
                plan.filters.map((f) => `${f.field}=${f.value}`).join(", ") || "all rows",
            });
          }
        } else if (plan.aggregation && plan.requestedFields[0]) {
          const field = plan.requestedFields[0];
          const nums: number[] = [];
          for (const u of filtered) {
            const values = getValues(u)!;
            const header = resolveFieldToHeader(field, Object.keys(values));
            if (!header) continue;
            const n = values[header]?.numeric;
            if (n != null) nums.push(n);
          }
          if (nums.length && filtered[0]) {
            const entry = entryById.get(filtered[0].knowledge_entry_id)!;
            let value = 0;
            if (plan.aggregation === "sum") value = nums.reduce((a, b) => a + b, 0);
            else if (plan.aggregation === "average")
              value = nums.reduce((a, b) => a + b, 0) / nums.length;
            else if (plan.aggregation === "min") value = Math.min(...nums);
            else if (plan.aggregation === "max") value = Math.max(...nums);
            const isMoney = /agreement|cost|margin \$/i.test(field);
            const displayValue = isMoney
              ? `$${Math.round(value).toLocaleString("en-US")}`
              : /margin|percent|%/i.test(field)
                ? `${Number(value.toFixed(1))}%`
                : String(Math.round(value * 100) / 100);
            aggregates.push({
              knowledgeEntryId: entry.id,
              entryTitle: entry.title,
              sourceUrl: entry.source_url,
              operation: plan.aggregation,
              field,
              displayValue,
              numericValue: value,
              matchedRowCount: nums.length,
              filterDescription:
                plan.filters.map((f) => `${f.field}=${f.value}`).join(", ") || "all rows",
            });
          }
        }
      }
    }
  }

  // Entity lookups
  if (plan.entities.length > 0 || plan.mode === "structured_lookup" || plan.mode === "hybrid") {
    const entities = plan.entities.length ? plan.entities : [];
    // If no entity extracted but question has name-like terms, still try keywords against rows
    const searchEntities =
      entities.length > 0
        ? entities
        : plan.keywords.length >= 2
          ? [`${plan.keywords[0]} ${plan.keywords[1]}`]
          : [];

    for (const entity of searchEntities) {
      const scored: Array<{ unit: (typeof approvedUnits)[0]; score: number; values: RowValues }> =
        [];
      for (const unit of approvedUnits.filter((u) => u.unit_type === "spreadsheet_row")) {
        const values = getValues(unit);
        if (!values) continue;
        if (!passesFilters(values, plan.filters)) continue;
        const score = entityMatchesRow(entity, values, unit.title);
        if (score >= 60) scored.push({ unit, score, values });
      }
      scored.sort((a, b) => {
        const pa = Number(a.unit.metadata.priority ?? a.unit.structured_data.priority ?? 0);
        const pb = Number(b.unit.metadata.priority ?? b.unit.structured_data.priority ?? 0);
        if (b.score !== a.score) return b.score - a.score;
        return pb - pa;
      });

      // Deduplicate same customer across Raw Data vs Sales Report — keep highest priority
      const deduped = dedupeByEntityFingerprint(scored);

      for (const hit of deduped.slice(0, 5)) {
        const entry = entryById.get(hit.unit.knowledge_entry_id)!;
        const field = plan.requestedFields[0] ?? null;
        const direct = displayForField(hit.values, field);
        lookups.push({
          knowledgeEntryId: entry.id,
          entryTitle: entry.title,
          sourceUrl: withSheetGid(entry.source_url, hit.unit.metadata.sheetGid as number | null),
          sheetName: String(
            hit.unit.metadata.sheetName ?? hit.unit.structured_data.sheetName ?? "",
          ),
          sheetGid: (hit.unit.metadata.sheetGid as number | null) ?? null,
          rowNumber: Number(hit.unit.structured_data.rowNumber ?? 0),
          entityLabel: hit.unit.title || entity,
          requestedField: field,
          directValue: direct,
          relatedValues: relatedDisplay(hit.values),
          unitId: hit.unit.id,
          priority: Number(hit.unit.metadata.priority ?? 0),
          score: hit.score,
        });
      }
    }
  }

  // Global dedupe across entity passes (prefer higher priority / score)
  const lookupsDeduped: StructuredLookupHit[] = [];
  const seenLookup = new Set<string>();
  for (const hit of [...lookups].sort((a, b) => b.priority - a.priority || b.score - a.score)) {
    const key = normalizeEntityText(
      `${hit.relatedValues["Customer Name"] || hit.entityLabel}|${hit.relatedValues["Close Date"] || ""}|${hit.relatedValues["Agreement Amount"] || hit.directValue || ""}`,
    );
    if (seenLookup.has(key)) continue;
    seenLookup.add(key);
    lookupsDeduped.push(hit);
  }

  const ambiguous =
    lookupsDeduped.length > 1 &&
    new Set(lookupsDeduped.map((l) => normalizeEntityText(l.entityLabel))).size > 1 &&
    plan.entities.length === 1;

  let clarificationPrompt: string | null = null;
  if (ambiguous) {
    clarificationPrompt = `I found multiple matching projects. Which one do you mean?\n${lookupsDeduped
      .slice(0, 4)
      .map(
        (l) =>
          `- ${l.entityLabel}${l.relatedValues["Project"] ? ` (${l.relatedValues["Project"]})` : ""}${l.relatedValues["Close Date"] ? `, closed ${l.relatedValues["Close Date"]}` : ""}`,
      )
      .join("\n")}`;
  }

  return { plan, lookups: lookupsDeduped, aggregates, ambiguous, clarificationPrompt };
}

function preferUniqueRows(rows: Awaited<ReturnType<typeof listAllSpreadsheetRowUnits>>) {
  return [...rows].sort((a, b) => {
    const pa = Number(a.metadata.priority ?? a.structured_data.priority ?? 0);
    const pb = Number(b.metadata.priority ?? b.structured_data.priority ?? 0);
    return pb - pa;
  });
}

function dedupeByEntityFingerprint(
  scored: Array<{
    unit: {
      id: string;
      title: string | null;
      knowledge_entry_id: string;
      structured_data: Record<string, unknown>;
      metadata: Record<string, unknown>;
    };
    score: number;
    values: RowValues;
  }>,
) {
  const seen = new Set<string>();
  const out: typeof scored = [];
  for (const hit of scored) {
    const customer = hit.values["Customer Name"]?.display || "";
    const project = hit.values["Project"]?.display || hit.values["Opportunity name"]?.display || "";
    const close = hit.values["Close Date"]?.display || "";
    const amount = hit.values["Agreement Amount"]?.display || "";
    const key =
      normalizeEntityText(`${customer}|${close}|${amount}`) ||
      normalizeEntityText(`${customer}|${project}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

function withSheetGid(url: string | null, gid: number | null): string | null {
  if (!url) return null;
  if (gid == null) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("gid", String(gid));
    return u.toString();
  } catch {
    return url.includes("gid=") ? url : `${url}${url.includes("?") ? "&" : "?"}gid=${gid}`;
  }
}

function preferredSummaryFields(requested: string[], values: RowValues): string[] {
  const available = Object.keys(values);
  if (requested.length === 0) return available;
  // Prefer the most specific requested field that resolves
  const resolved = requested
    .map((f) => resolveFieldToHeader(f, available) ?? f)
    .filter((f) => values[f]?.display);
  if (resolved.length) return [resolved[0]!];
  return available.slice(0, 1);
}
