import "server-only";

import { resolveFieldToHeader } from "./aliases";
import { planKnowledgeQuery } from "./query-planner";
import { cellMatchesTimeRange } from "./temporal";
import { listAllSpreadsheetRowUnits } from "./units-store";
import type {
  KnowledgeQueryPlan,
  KnowledgeUnitRecord,
  ParsedCellValue,
  StructuredAggregateHit,
  StructuredLookupHit,
  StructuredSearchResult,
} from "./types";
import { formatFriendlyDate, normalizeEntityText } from "./values";
import { listAllKnowledgeEntriesForRetrieval } from "@/lib/knowledge/store";
import { canEmployeeReadEntry } from "@/lib/knowledge/permissions";

type RowValues = Record<string, ParsedCellValue>;
type SpreadsheetUnit = KnowledgeUnitRecord;

function getValues(unit: { structured_data: Record<string, unknown> }): RowValues | null {
  const values = unit.structured_data.values as RowValues | undefined;
  if (values && typeof values === "object") return values;
  const metrics = unit.structured_data.metrics as RowValues | undefined;
  if (metrics && typeof metrics === "object") return metrics;
  return null;
}

function sheetNameOf(unit: SpreadsheetUnit): string {
  return String(unit.metadata.sheetName ?? unit.structured_data.sheetName ?? "");
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

/** True when the row's Close Date (or plan.timeRange.field) falls inside plan.timeRange. */
function passesTimeRange(values: RowValues, plan: KnowledgeQueryPlan): boolean {
  if (!plan.timeRange) return true;
  const headers = Object.keys(values);
  const field = plan.timeRange.field || "Close Date";
  const header =
    resolveFieldToHeader(field, headers) ?? headers.find((h) => /close\s*date/i.test(h)) ?? field;
  const cell = values[header];
  return cellMatchesTimeRange(cell?.dateIso, plan.timeRange);
}

/** Stable identity so Sales Report + Raw Data of the same deal count once. */
function rowIdentityKey(values: RowValues): string {
  const customer = values["Customer Name"]?.display || "";
  const project = values["Project"]?.display || values["Opportunity name"]?.display || "";
  const close = values["Close Date"]?.display || values["Close Date"]?.dateIso || "";
  const amount = values["Agreement Amount"]?.display || "";
  return (
    normalizeEntityText(`${customer}|${close}|${amount}`) ||
    normalizeEntityText(`${customer}|${project}|${close}`)
  );
}

function describeFilters(plan: KnowledgeQueryPlan): string {
  const parts: string[] = [];
  if (plan.timeRange?.label) parts.push(plan.timeRange.label);
  for (const f of plan.filters) {
    parts.push(`${f.field}=${f.value}`);
  }
  return parts.join(", ") || "all rows";
}

function formatAggregateDisplay(field: string, value: number): string {
  const isMoney = /agreement|cost|margin \$/i.test(field);
  if (isMoney) return `$${Math.round(value).toLocaleString("en-US")}`;
  if (/margin|percent|%/i.test(field)) return `${Number(value.toFixed(1))}%`;
  return String(Math.round(value * 100) / 100);
}

function numericForField(values: RowValues, field: string): number | null {
  const header = resolveFieldToHeader(field, Object.keys(values));
  if (!header) return null;
  const n = values[header]?.numeric;
  return n != null ? n : null;
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
    if (plan.entities.length === 0) {
      // Whole-report totals — never use when a time range is set (those are not period-scoped).
      if (!plan.timeRange) {
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
      }

      // Row-level aggregation when filters, time range, or aggregate ops need row math
      if (
        plan.timeRange ||
        plan.weightedMargin ||
        (plan.aggregation && plan.aggregation !== "count") ||
        plan.filters.length > 0 ||
        plan.aggregation === "count"
      ) {
        const rows = approvedUnits.filter((u) => u.unit_type === "spreadsheet_row");
        const preferred = preferUniqueRows(rows);
        const deduped = dedupeRowUnits(preferred);
        const filtered = deduped.filter((u) => {
          const values = getValues(u);
          return values
            ? passesFilters(values, plan.filters) && passesTimeRange(values, plan)
            : false;
        });
        const filterDescription = describeFilters(plan);

        if (plan.weightedMargin) {
          let marginSum = 0;
          let agreementSum = 0;
          let counted = 0;
          for (const u of filtered) {
            const values = getValues(u)!;
            const margin = numericForField(values, "Estimated Gross Margin $");
            const agreement = numericForField(values, "Agreement Amount");
            if (margin == null || agreement == null || agreement === 0) continue;
            marginSum += margin;
            agreementSum += agreement;
            counted += 1;
          }
          if (counted > 0 && agreementSum > 0 && filtered[0]) {
            const entry = entryById.get(filtered[0].knowledge_entry_id)!;
            const value = (marginSum / agreementSum) * 100;
            aggregates.push({
              knowledgeEntryId: entry.id,
              entryTitle: entry.title,
              sourceUrl: entry.source_url,
              operation: "sum",
              field: "Estimated Gross Margin $",
              displayValue: `${Number(value.toFixed(1))}%`,
              numericValue: value,
              matchedRowCount: counted,
              filterDescription,
            });
          }
        } else if (plan.aggregation === "count" || /\bhow many\b/i.test(question)) {
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
              filterDescription,
            });
          }
        } else if (plan.aggregation && plan.requestedFields[0]) {
          const field = plan.requestedFields[0];
          const nums: number[] = [];
          for (const u of filtered) {
            const values = getValues(u)!;
            const n = numericForField(values, field);
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
            aggregates.push({
              knowledgeEntryId: entry.id,
              entryTitle: entry.title,
              sourceUrl: entry.source_url,
              operation: plan.aggregation,
              field,
              displayValue: formatAggregateDisplay(field, value),
              numericValue: value,
              matchedRowCount: nums.length,
              filterDescription,
            });
          }
        }
      }
    }
  }

  // Entity lookups — skip for pure temporal company-wide aggregates (no entity bleed).
  const skipEntityLookups =
    plan.mode === "structured_aggregate" && plan.entities.length === 0 && Boolean(plan.timeRange);

  if (
    !skipEntityLookups &&
    (plan.entities.length > 0 || plan.mode === "structured_lookup" || plan.mode === "hybrid")
  ) {
    const entities = plan.entities.length ? plan.entities : [];
    const searchEntities =
      entities.length > 0
        ? entities
        : plan.keywords.length >= 2
          ? [`${plan.keywords[0]} ${plan.keywords[1]}`]
          : [];

    for (const entity of searchEntities) {
      const scored: Array<{ unit: SpreadsheetUnit; score: number; values: RowValues }> = [];
      for (const unit of approvedUnits.filter((u) => u.unit_type === "spreadsheet_row")) {
        const values = getValues(unit);
        if (!values) continue;
        if (!passesFilters(values, plan.filters)) continue;
        if (!passesTimeRange(values, plan)) continue;
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
          sheetName: sheetNameOf(hit.unit),
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

/** Prefer Sales Report rows over Raw Data so dedupe keeps the curated sheet. */
function preferUniqueRows(rows: SpreadsheetUnit[]): SpreadsheetUnit[] {
  return [...rows].sort((a, b) => rankSheetUnit(b) - rankSheetUnit(a));
}

function rankSheetUnit(unit: SpreadsheetUnit): number {
  let p = Number(unit.metadata.priority ?? unit.structured_data.priority ?? 0);
  const sheet = sheetNameOf(unit).toLowerCase();
  if (sheet.includes("sales report") || (sheet.includes("sales") && !sheet.includes("raw"))) {
    p += 50;
  }
  if (sheet.includes("raw")) {
    p -= 50;
  }
  return p;
}

/** Keep first occurrence per row identity (after preferUniqueRows order). */
function dedupeRowUnits(rows: SpreadsheetUnit[]): SpreadsheetUnit[] {
  const seen = new Set<string>();
  const out: SpreadsheetUnit[] = [];
  for (const unit of rows) {
    const values = getValues(unit);
    if (!values) continue;
    const key = rowIdentityKey(values);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(unit);
  }
  return out;
}

function dedupeByEntityFingerprint(
  scored: Array<{
    unit: SpreadsheetUnit;
    score: number;
    values: RowValues;
  }>,
) {
  const seen = new Set<string>();
  const out: typeof scored = [];
  for (const hit of scored) {
    const key = rowIdentityKey(hit.values);
    if (!key || seen.has(key)) continue;
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
  const resolved = requested
    .map((f) => resolveFieldToHeader(f, available) ?? f)
    .filter((f) => values[f]?.display);
  if (resolved.length) return [resolved[0]!];
  return available.slice(0, 1);
}
