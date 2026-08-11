/**
 * Deterministic Master Project Log answers — answer then cite, never dump rows.
 */

import type { ProjectLogRow, ProjectRegistryField, ProjectRegistryQuery } from "./types";
import {
  countProjects,
  filterProjectsByCity,
  lookupProjectRow,
  type ProjectLookupResult,
} from "./lookup";

function citation(tabName: string, row?: ProjectLogRow): string {
  if (row) {
    return `Source: ${tabName} (row ${row.rowNumber}) — Project Charter Master`;
  }
  return `Source: ${tabName} — Project Charter Master`;
}

function fieldValue(row: ProjectLogRow, field: ProjectRegistryField): string | null {
  switch (field) {
    case "city":
      return row.city.trim() || null;
    case "street":
    case "address": {
      const parts = [row.street, row.city, row.postalCode].filter((p) => p.trim());
      if (field === "street") return row.street.trim() || null;
      return parts.length ? parts.join(", ") : null;
    }
    case "postal":
      return row.postalCode.trim() || null;
    case "jurisdiction":
      return row.jurisdiction.trim() || null;
    case "salesperson":
      return row.salesperson.trim() || null;
    case "project_number":
      return row.projectNumber.trim() || null;
    case "customer_name":
      return row.customerName.trim() || null;
    case "short_name":
      return row.shortName.trim() || null;
    case "start_date":
      return row.startDate.trim() || null;
    default:
      return null;
  }
}

function projectLabel(row: ProjectLogRow): string {
  const short = row.shortName.trim() || row.customerName.trim() || row.projectNumber;
  return `${short} project (${row.projectNumber})`;
}

function formatAmbiguous(rows: ProjectLogRow[]): string {
  const names = rows.map((r) => {
    const who = r.customerName.trim() || r.shortName.trim();
    return `${r.projectNumber}${who ? ` — ${who}` : ""}`;
  });
  const shown = names.slice(0, 6);
  const list =
    shown.length <= 2
      ? shown.join(" or ")
      : `${shown.slice(0, -1).join(", ")}, or ${shown[shown.length - 1]}`;
  return `I found ${names.length} matching projects in the Master Project Log. Which one do you mean — ${list}?`;
}

function formatFieldAnswer(row: ProjectLogRow, field: ProjectRegistryField): string {
  const value = fieldValue(row, field);
  const label = projectLabel(row);
  const customer = row.customerName.trim();
  const who = customer && !label.includes(customer) ? ` (${customer})` : "";

  if (!value) {
    const fieldLabel =
      field === "postal" ? "ZIP" : field === "address" ? "address" : field.replace(/_/g, " ");
    return `I found the ${label}${who} in the Master Project Log, but the ${fieldLabel} field is blank on that row.`;
  }

  switch (field) {
    case "city":
      return formatCityAnswer(row);
    case "address":
    case "street":
      return `The ${label}${who} address is ${value}.`;
    case "postal":
      return `The ${label}${who} ZIP is ${value}.`;
    case "jurisdiction":
      return `The ${label}${who} jurisdiction is ${value}.`;
    case "salesperson":
      return `The salesperson on the ${label}${who} is ${value}.`;
    case "project_number":
      return `The project number for ${customer || row.shortName || "that customer"} is ${value}.`;
    case "customer_name":
      return `The customer on the ${label} is ${value}.`;
    case "short_name":
      return `The short name for ${row.projectNumber} is ${value}.`;
    case "start_date":
      return `The ${label}${who} start date is ${value}.`;
    default:
      return `${label}: ${value}.`;
  }
}

/** Clean city answer: "The Yeh project (L01-26016) is in Walnut Creek, CA 94598." style without mangling. */
function formatCityAnswer(row: ProjectLogRow): string {
  const city = row.city.trim();
  const zip = row.postalCode.trim();
  const label = `${row.shortName.trim() || "This"} project (${row.projectNumber})`;
  if (!city) {
    return `I found the ${label} in the Master Project Log, but the city field is blank on that row.`;
  }
  if (zip) return `The ${label} is in ${city}, ${zip}.`;
  return `The ${label} is in ${city}.`;
}

export function formatProjectRegistryAnswer(input: {
  query: ProjectRegistryQuery;
  rows: ProjectLogRow[];
  tabName: string;
}): { answer: string; softMiss?: boolean; matchedRow?: ProjectLogRow | null } {
  const { query, rows, tabName } = input;

  if (query.kind === "count") {
    const { count, rows: matched } = countProjects(rows, query);
    const bits: string[] = [];
    if (query.city) bits.push(`in ${query.city}`);
    if (query.salesperson) bits.push(`for ${query.salesperson}`);
    if (query.year) bits.push(`in ${query.year}`);
    const scope = bits.length ? ` ${bits.join(" ")}` : "";
    return {
      answer: `There ${count === 1 ? "is" : "are"} ${count} project${count === 1 ? "" : "s"}${scope} in the Master Project Log.\n\n${citation(tabName, matched[0])}`,
      matchedRow: matched[0] ?? null,
    };
  }

  if (query.kind === "filter_city") {
    const matched = filterProjectsByCity(rows, query.city);
    if (matched.length === 0) {
      return {
        answer: `I couldn’t find any projects in ${query.city} in the Master Project Log.\n\n${citation(tabName)}`,
        softMiss: true,
      };
    }
    const lines = matched
      .slice(0, 12)
      .map((r) => `• ${r.projectNumber} — ${r.shortName || r.customerName || "Unnamed"}`)
      .join("\n");
    const more = matched.length > 12 ? `\n…and ${matched.length - 12} more.` : "";
    return {
      answer: `Projects in ${query.city} (${matched.length}):\n${lines}${more}\n\n${citation(tabName, matched[0])}`,
      matchedRow: matched[0] ?? null,
    };
  }

  const lookup: ProjectLookupResult = lookupProjectRow(rows, query.projectQuery);
  if (lookup.kind === "none") {
    return {
      answer: `I couldn’t find “${query.projectQuery}” in the Master Project Log.\n\n${citation(tabName)}`,
      softMiss: true,
    };
  }
  if (lookup.kind === "ambiguous") {
    return { answer: formatAmbiguous(lookup.rows), softMiss: false };
  }

  const row = lookup.row;
  if (query.kind === "project_identity") {
    const parts = [
      projectLabel(row),
      row.customerName ? `customer ${row.customerName}` : null,
      row.city ? `in ${row.city}` : null,
    ].filter(Boolean);
    return {
      answer: `${parts.join(" — ")}.\n\n${citation(tabName, row)}`,
      matchedRow: row,
    };
  }

  // field_lookup
  if (query.field === "city") {
    return {
      answer: `${formatCityAnswer(row)}\n\n${citation(tabName, row)}`,
      matchedRow: row,
    };
  }
  return {
    answer: `${formatFieldAnswer(row, query.field)}\n\n${citation(tabName, row)}`,
    matchedRow: row,
  };
}
