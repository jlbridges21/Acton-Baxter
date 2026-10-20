import { BAXTER_REPORTING_TIMEZONE } from "@/lib/baxter-ai/feedback-date-ranges";
import {
  projectStatusesUnread,
  type ProjectJobSyncSummary,
} from "@/lib/receipts/project-sync-summary";

export function formatAdminSyncTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: BAXTER_REPORTING_TIMEZONE,
    timeZoneName: "short",
  }).format(date);
}

/** "Last refreshed from sheet" line plus the banner shown before any status has been read. */
export function ProjectSyncStatus({ summary }: { summary: ProjectJobSyncSummary }) {
  const { open, closed, unknown } = summary.counts;
  return (
    <div className="space-y-2">
      <p className="text-sm text-[var(--acton-muted)]" data-testid="project-sync-last-refreshed">
        Last refreshed from sheet:{" "}
        {summary.lastRefreshedAt ? formatAdminSyncTime(summary.lastRefreshedAt) : "never"}
        {summary.projectRows > 0
          ? ` · ${open} Open · ${closed} Closed · ${unknown} Unknown in the tools`
          : null}
      </p>
      {projectStatusesUnread(summary) ? (
        <p
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          data-testid="project-status-unread-banner"
        >
          No Open/Closed statuses have been read yet. Click Refresh from Master Project Log.
        </p>
      ) : null}
    </div>
  );
}
