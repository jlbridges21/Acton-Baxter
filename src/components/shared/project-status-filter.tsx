"use client";

import { useCallback, useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import {
  DEFAULT_PROJECT_STATUS_VIEW,
  parseProjectStatusView,
  projectStatusNoMatchMessage,
  PROJECT_STATUS_VIEW_LABELS,
  PROJECT_STATUS_VIEWS,
  type ProjectStatusView,
} from "@/lib/receipts/project-status-view";
import { cn } from "@/lib/utils";

/** One remembered view per tool, e.g. `baxter.projectStatusFilter.receipts`. */
export type ProjectStatusFilterTool = "receipts" | "inventory";

export function projectStatusFilterStorageKey(tool: ProjectStatusFilterTool) {
  return `baxter.projectStatusFilter.${tool}`;
}

const listeners = new Set<() => void>();
/** Survives a localStorage that throws (private mode, quota) for the rest of the session. */
const sessionViews = new Map<ProjectStatusFilterTool, ProjectStatusView>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readProjectStatusView(tool: ProjectStatusFilterTool): ProjectStatusView {
  const session = sessionViews.get(tool);
  if (session) return session;
  try {
    return parseProjectStatusView(window.localStorage.getItem(projectStatusFilterStorageKey(tool)));
  } catch {
    return DEFAULT_PROJECT_STATUS_VIEW;
  }
}

export function writeProjectStatusView(tool: ProjectStatusFilterTool, view: ProjectStatusView) {
  sessionViews.set(tool, view);
  try {
    window.localStorage.setItem(projectStatusFilterStorageKey(tool), view);
  } catch {
    // Storage unavailable: the session value above still applies.
  }
  for (const listener of listeners) listener();
}

export function resetProjectStatusViewsForTests() {
  sessionViews.clear();
}

export function useProjectStatusView(
  tool: ProjectStatusFilterTool,
): [ProjectStatusView, (view: ProjectStatusView) => void] {
  const view = useSyncExternalStore(
    subscribe,
    () => readProjectStatusView(tool),
    () => DEFAULT_PROJECT_STATUS_VIEW,
  );
  const setView = useCallback(
    (next: ProjectStatusView) => writeProjectStatusView(tool, next),
    [tool],
  );
  return [view, setView];
}

export function ProjectStatusFilter({
  value,
  onChange,
  counts,
  label = "Show projects",
  className,
}: {
  value: ProjectStatusView;
  onChange: (view: ProjectStatusView) => void;
  counts: Record<ProjectStatusView, number>;
  label?: string;
  className?: string;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = PROJECT_STATUS_VIEWS.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = index === last ? 0 : index + 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    onChange(PROJECT_STATUS_VIEWS[next] ?? DEFAULT_PROJECT_STATUS_VIEW);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid="project-status-filter"
      className={cn(
        "inline-flex max-w-full gap-1 rounded-md border border-[var(--acton-border)] bg-white p-1",
        className,
      )}
    >
      {PROJECT_STATUS_VIEWS.map((view, index) => {
        const active = value === view;
        return (
          <button
            key={view}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(view)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`min-h-8 rounded px-2.5 text-xs font-medium whitespace-nowrap ${
              active
                ? "bg-[var(--acton-navy)] text-white"
                : "text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
            }`}
          >
            {PROJECT_STATUS_VIEW_LABELS[view]}{" "}
            <span className={active ? "text-white/80" : "text-[var(--acton-muted)]"}>
              {counts[view]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Muted marker next to a Closed project's name in pickers and selections. */
export function ClosedProjectBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "ml-1.5 inline-flex shrink-0 items-center rounded bg-[var(--acton-gray-100)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--acton-muted)] uppercase",
        className,
      )}
    >
      Closed
    </span>
  );
}

/** Shown when the current view has no search matches but the other status does. */
export function ProjectStatusNoMatchHint({
  view,
  query,
  hiddenCount,
  onShowAll,
}: {
  view: ProjectStatusView;
  query: string;
  hiddenCount: number;
  onShowAll: () => void;
}) {
  if (view === "all" || hiddenCount === 0 || !query.trim()) return null;
  return (
    <p className="px-3 py-2 text-sm text-[var(--acton-muted)]" data-testid="project-status-hint">
      {projectStatusNoMatchMessage({ view, query, hiddenCount })} —{" "}
      <button
        type="button"
        className="font-semibold text-[var(--acton-navy)] underline underline-offset-2"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onShowAll}
      >
        Show all
      </button>
    </p>
  );
}
