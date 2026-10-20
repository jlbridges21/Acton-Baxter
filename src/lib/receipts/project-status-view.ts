/**
 * Open / Closed / All view over project picker options (Receipts, Inventory).
 * Client-safe: no server imports.
 */

import type { ExpenseJobProjectStatus, ExpenseJobSource } from "./types";

export const PROJECT_STATUS_VIEWS = ["open", "closed", "all"] as const;
export type ProjectStatusView = (typeof PROJECT_STATUS_VIEWS)[number];

export const PROJECT_STATUS_VIEW_LABELS: Record<ProjectStatusView, string> = {
  open: "Open",
  closed: "Closed",
  all: "All",
};

export const DEFAULT_PROJECT_STATUS_VIEW: ProjectStatusView = "open";

/**
 * A picker option. Custom jobs and one-off labels have no Master Project Log status
 * (`source: "custom"` or a null/missing `projectStatus`) and appear in every view.
 */
export type ProjectStatusTagged = {
  source?: ExpenseJobSource;
  projectStatus?: ExpenseJobProjectStatus | null;
};

type ProjectStatusKind = "custom" | ExpenseJobProjectStatus;

export function parseProjectStatusView(value: string | null | undefined): ProjectStatusView {
  return value === "closed" || value === "all" ? value : DEFAULT_PROJECT_STATUS_VIEW;
}

export function projectStatusKind(item: ProjectStatusTagged): ProjectStatusKind {
  if (item.source === "custom" || !item.projectStatus) return "custom";
  return item.projectStatus;
}

export function isClosedProjectOption(item: ProjectStatusTagged): boolean {
  return projectStatusKind(item) === "closed";
}

export function matchesProjectStatusView(item: ProjectStatusTagged, view: ProjectStatusView) {
  const kind = projectStatusKind(item);
  if (view === "all" || kind === "custom") return true;
  return kind === view;
}

export function countProjectStatusViews(
  items: readonly ProjectStatusTagged[],
): Record<ProjectStatusView, number> {
  return {
    open: items.filter((item) => matchesProjectStatusView(item, "open")).length,
    closed: items.filter((item) => matchesProjectStatusView(item, "closed")).length,
    all: items.length,
  };
}

const KIND_RANK: Record<ProjectStatusKind, number> = { custom: 0, open: 0, closed: 1, unknown: 2 };

/**
 * Options visible in `view`, Open (and custom) before Closed, keeping the incoming
 * order within each group. `pinnedIds` stay visible in every view so a current
 * selection never disappears.
 */
export function filterByProjectStatusView<T extends ProjectStatusTagged>(
  items: readonly T[],
  view: ProjectStatusView,
  options?: { getId?: (item: T) => string; pinnedIds?: Iterable<string | null | undefined> },
): T[] {
  const pinned = new Set<string>();
  for (const id of options?.pinnedIds ?? []) if (id) pinned.add(id);
  const getId = options?.getId;
  const visible = items.filter(
    (item) => matchesProjectStatusView(item, view) || (getId ? pinned.has(getId(item)) : false),
  );
  return visible
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        KIND_RANK[projectStatusKind(a.item)] - KIND_RANK[projectStatusKind(b.item)] ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

/** Opposite status for the "N Closed projects match — Show all" hint. */
export function hiddenProjectStatus(view: ProjectStatusView): "open" | "closed" | null {
  if (view === "open") return "closed";
  if (view === "closed") return "open";
  return null;
}

/** Options hidden by `view` that still match the search. */
export function countHiddenProjectMatches<T extends ProjectStatusTagged>(
  items: readonly T[],
  view: ProjectStatusView,
  matches: (item: T) => boolean,
): number {
  const hidden = hiddenProjectStatus(view);
  if (!hidden) return 0;
  return items.filter((item) => projectStatusKind(item) === hidden && matches(item)).length;
}

export function projectStatusNoMatchMessage(input: {
  view: ProjectStatusView;
  query: string;
  hiddenCount: number;
}): string {
  const shown = PROJECT_STATUS_VIEW_LABELS[input.view];
  const hidden = hiddenProjectStatus(input.view);
  const hiddenLabel = hidden ? PROJECT_STATUS_VIEW_LABELS[hidden] : "";
  const noun = input.hiddenCount === 1 ? "project matches" : "projects match";
  return `No ${shown} projects match “${input.query.trim()}”. ${input.hiddenCount} ${hiddenLabel} ${noun}`;
}
