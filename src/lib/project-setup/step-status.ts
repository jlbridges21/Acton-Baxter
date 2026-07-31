/** Client-safe step status labels (no server-only imports). */

export function formatProjectSetupStepStatus(status: string): string {
  if (status === "planned") return "Planned — not executed";
  if (status === "complete") return "Complete";
  if (status === "failed") return "Failed";
  if (status === "running") return "Running";
  if (status === "skipped") return "Skipped";
  if (status === "pending") return "Pending";
  return status;
}
