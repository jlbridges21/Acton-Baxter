"use client";

import { useSyncExternalStore } from "react";
import { InspectionsShell } from "@/components/inspections/inspections-shell";
import { InspectionViewToggle } from "@/components/inspections/inspection-view-toggle";
import { InspectionsListClient } from "@/components/inspections/inspections-list-client";
import type { ExpenseJob } from "@/lib/receipts/types";
import type { InspectionTemplateSummary } from "@/lib/inspections/types";
import type { SiteInspectionSummary } from "@/lib/inspections/record-types";
import {
  getServerSiteInspectionView,
  getSiteInspectionView,
  setSiteInspectionView,
  subscribeSiteInspectionView,
  type SiteInspectionListView,
} from "@/lib/inspections/view-preference";

type Assignee = { id: string; displayName: string };

export function InspectionsPageClient({
  initialInspections,
  jobs,
  templates,
  assignees,
  currentUserId,
  isAdmin,
}: {
  initialInspections: SiteInspectionSummary[];
  jobs: ExpenseJob[];
  templates: InspectionTemplateSummary[];
  assignees: Assignee[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const view = useSyncExternalStore(
    subscribeSiteInspectionView,
    getSiteInspectionView,
    getServerSiteInspectionView,
  );

  function chooseView(next: SiteInspectionListView) {
    setSiteInspectionView(next);
  }

  return (
    <InspectionsShell
      activeView="inspections"
      title="Site Inspections"
      subtitle="Shared field checklists — progress and cover photos at a glance."
      actions={<InspectionViewToggle view={view} onChange={chooseView} />}
    >
      <InspectionsListClient
        initialInspections={initialInspections}
        jobs={jobs}
        templates={templates}
        assignees={assignees}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        view={view}
      />
    </InspectionsShell>
  );
}
