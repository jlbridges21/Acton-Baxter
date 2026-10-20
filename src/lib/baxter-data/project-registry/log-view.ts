/**
 * Filter / sort / search for the admin Master Project Log page. Kept in the URL
 * so a filtered view can be shared.
 */

import type { ProjectLogRow, ProjectLogStatus } from "./types";

export type ProjectLogStatusFilter = "all" | ProjectLogStatus;
export type ProjectLogSort = "name-asc" | "name-desc" | "number-asc" | "number-desc";

export type ProjectLogViewState = {
  status: ProjectLogStatusFilter;
  sort: ProjectLogSort;
  q: string;
};

export const PROJECT_LOG_STATUS_FILTERS: ProjectLogStatusFilter[] = [
  "all",
  "open",
  "closed",
  "unknown",
];

export const PROJECT_LOG_SORT_LABELS: Record<ProjectLogSort, string> = {
  "name-asc": "Project Name A→Z",
  "name-desc": "Project Name Z→A",
  "number-asc": "Project Number ascending",
  "number-desc": "Project Number descending",
};

export const DEFAULT_PROJECT_LOG_VIEW: ProjectLogViewState = {
  status: "open",
  sort: "name-asc",
  q: "",
};

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function parseProjectLogViewParams(params: RawParams): ProjectLogViewState {
  const status = first(params.status) as ProjectLogStatusFilter;
  const sort = first(params.sort) as ProjectLogSort;
  return {
    status: PROJECT_LOG_STATUS_FILTERS.includes(status) ? status : DEFAULT_PROJECT_LOG_VIEW.status,
    sort: sort in PROJECT_LOG_SORT_LABELS ? sort : DEFAULT_PROJECT_LOG_VIEW.sort,
    q: first(params.q).slice(0, 200),
  };
}

/** Query string for a view; defaults are omitted. Returns "" or "?…". */
export function buildProjectLogViewQuery(state: ProjectLogViewState): string {
  const params = new URLSearchParams();
  if (state.status !== DEFAULT_PROJECT_LOG_VIEW.status) params.set("status", state.status);
  if (state.sort !== DEFAULT_PROJECT_LOG_VIEW.sort) params.set("sort", state.sort);
  if (state.q.trim()) params.set("q", state.q.trim());
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function countProjectLogStatuses(
  rows: ProjectLogRow[],
): Record<ProjectLogStatusFilter, number> {
  const counts: Record<ProjectLogStatusFilter, number> = {
    all: rows.length,
    open: 0,
    closed: 0,
    unknown: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function matchesSearch(row: ProjectLogRow, needle: string): boolean {
  return [
    row.projectNumber,
    row.shortName,
    row.customerName,
    row.salesperson,
    row.city,
    row.jurisdiction,
  ].some((value) => value.toLowerCase().includes(needle));
}

export function applyProjectLogView(
  rows: ProjectLogRow[],
  state: ProjectLogViewState,
): ProjectLogRow[] {
  const needle = state.q.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      (state.status === "all" || row.status === state.status) &&
      (!needle || matchesSearch(row, needle)),
  );
  const byNumber = (a: ProjectLogRow, b: ProjectLogRow) =>
    compareText(a.projectNumber, b.projectNumber);
  const byName = (a: ProjectLogRow, b: ProjectLogRow) =>
    compareText(a.shortName, b.shortName) || byNumber(a, b);
  // Rows with no project name stay at the bottom in either direction.
  const blankLast = (a: ProjectLogRow, b: ProjectLogRow) =>
    Number(!a.shortName.trim()) - Number(!b.shortName.trim());
  const sorted = [...filtered];
  switch (state.sort) {
    case "name-asc":
      return sorted.sort((a, b) => blankLast(a, b) || byName(a, b));
    case "name-desc":
      return sorted.sort((a, b) => blankLast(a, b) || byName(b, a));
    case "number-asc":
      return sorted.sort(byNumber);
    case "number-desc":
      return sorted.sort((a, b) => byNumber(b, a));
  }
}

export function masterProjectLogSheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
}
