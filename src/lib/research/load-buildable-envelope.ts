import "server-only";

import {
  listJurisdictionRules,
  resolveJurisdictionKeyFromReport,
  type SupportedJurisdictionKey,
} from "@/lib/jurisdictions";
import {
  computeApproximateBuildableEnvelope,
  type BuildableEnvelopeResult,
} from "@/lib/research/buildable-envelope";
import type { FullReport } from "@/lib/research/db-types";

export async function loadBuildableEnvelopeForReport(
  report: Pick<
    FullReport,
    "jurisdiction_name" | "county" | "state" | "facts" | "parcelGeometry"
  > & {
    jurisdiction_key?: string | null;
  },
  options?: {
    jurisdictionKey?: SupportedJurisdictionKey | null;
    zoning?: string | null;
  },
): Promise<BuildableEnvelopeResult> {
  const jurisdictionKey =
    options?.jurisdictionKey !== undefined
      ? options.jurisdictionKey
      : resolveJurisdictionKeyFromReport(report);
  const zoning =
    options?.zoning !== undefined
      ? options.zoning
      : (report.facts.find((fact) => fact.field_key === "zoning")?.normalized_value_text ?? null);

  const rules = jurisdictionKey ? await listJurisdictionRules({ jurisdictionKey }) : [];

  return computeApproximateBuildableEnvelope({
    geometry: report.parcelGeometry?.geometry_geojson as
      { type?: unknown; coordinates?: unknown } | null | undefined,
    rules,
    zoning,
  });
}
