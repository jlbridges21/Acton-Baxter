"use client";

import { LayoutViewToggle } from "@/components/ui/layout-view-toggle";
import type { SiteInspectionListView } from "@/lib/inspections/view-preference";

export function InspectionViewToggle({
  view,
  onChange,
}: {
  view: SiteInspectionListView;
  onChange: (view: SiteInspectionListView) => void;
}) {
  return <LayoutViewToggle view={view} onChange={onChange} label="Inspection layout" />;
}
