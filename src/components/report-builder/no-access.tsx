import { EmptyState } from "@/components/ai/ui";

export function ReportsNoAccess() {
  return (
    <EmptyState title="You don't have access to Reports yet">
      Reports use JobTread project data. An administrator can grant access on Dexter&apos;s Access
      tab in the AI Workspace.
    </EmptyState>
  );
}
