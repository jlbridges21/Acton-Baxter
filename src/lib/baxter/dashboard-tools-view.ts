/** Per-viewer display preference for the Baxter dashboard tool list. */
export const DASHBOARD_TOOLS_VIEW_STORAGE_KEY = "baxter.dashboard.tools.view";

export type DashboardToolsView = "grid" | "list";

export function parseDashboardToolsView(value: string | null): DashboardToolsView {
  return value === "list" ? "list" : "grid";
}

const listeners = new Set<() => void>();

export function subscribeDashboardToolsView(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDashboardToolsView(): DashboardToolsView {
  return parseDashboardToolsView(window.localStorage.getItem(DASHBOARD_TOOLS_VIEW_STORAGE_KEY));
}

export function getServerDashboardToolsView(): DashboardToolsView {
  return "grid";
}

export function setDashboardToolsView(view: DashboardToolsView) {
  window.localStorage.setItem(DASHBOARD_TOOLS_VIEW_STORAGE_KEY, view);
  for (const listener of listeners) listener();
}
