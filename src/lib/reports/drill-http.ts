/**
 * Shared request handling for drill endpoints: which spec a drill runs against. A draft spec
 * is only accepted from someone who can edit the report, and templates never read a live
 * rule set — the same rules as executing the report, so a drill can't see more than the view.
 */

import "server-only";

import { ValidationError } from "@/lib/errors";
import type { ReportRow } from "./repo";
import type { ReportPermission } from "./repo-types";
import { templateSafeSpec } from "./rule-scope";
import { parseReportSpec, type ReportSpec } from "./spec";

export function drillSpec(
  report: Pick<ReportRow, "spec" | "is_template">,
  permission: Pick<ReportPermission, "canEdit">,
  draft: unknown,
): ReportSpec {
  let spec = report.spec;
  if (draft !== undefined) {
    if (!permission.canEdit) throw new ValidationError("You can't preview changes to this report.");
    const parsed = parseReportSpec(draft);
    if (!parsed.ok) throw new ValidationError("The draft report isn't valid.");
    spec = parsed.spec;
  }
  return report.is_template ? templateSafeSpec(spec) : spec;
}
