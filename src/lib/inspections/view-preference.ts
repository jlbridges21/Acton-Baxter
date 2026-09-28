/** Per-viewer display preference for the Site Inspections index. */
export const SITE_INSPECTION_VIEW_STORAGE_KEY = "baxter.site-inspections.view";

export type SiteInspectionListView = "grid" | "list";

export function parseSiteInspectionListView(value: string | null): SiteInspectionListView {
  return value === "list" ? "list" : "grid";
}

const listeners = new Set<() => void>();

export function subscribeSiteInspectionView(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSiteInspectionView(): SiteInspectionListView {
  return parseSiteInspectionListView(window.localStorage.getItem(SITE_INSPECTION_VIEW_STORAGE_KEY));
}

export function getServerSiteInspectionView(): SiteInspectionListView {
  return "grid";
}

export function setSiteInspectionView(view: SiteInspectionListView) {
  window.localStorage.setItem(SITE_INSPECTION_VIEW_STORAGE_KEY, view);
  for (const listener of listeners) listener();
}
