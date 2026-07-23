import type { NormalizedResearchResult, ReportConflict } from "./schemas";

export function summarizeResearch(result: Omit<NormalizedResearchResult, "summary">): string {
  const { identity, characteristics, planning, conflicts } = result;
  const lot = characteristics.lotSquareFootage
    ? `${characteristics.lotSquareFootage.toLocaleString()} sq ft lot`
    : "lot size pending verification";
  const living = characteristics.livingAreaSquareFootage
    ? `${characteristics.livingAreaSquareFootage.toLocaleString()} sq ft living area`
    : "living area pending verification";
  const year = characteristics.yearBuilt
    ? `built in ${characteristics.yearBuilt}`
    : "year built unknown";
  const zoning = planning.zoning
    ? `Zoning appears as ${planning.zoning}`
    : "Zoning was not confirmed";
  const conflictNote = summarizeConflicts(conflicts);

  return [
    `${identity.standardizedAddress} is in ${identity.jurisdiction ?? "an unknown jurisdiction"}, ${identity.county ?? "unknown"} County.`,
    `Public and mock licensed sources describe a ${lot} with approximately ${living}, ${year}.`,
    `${zoning}.`,
    conflictNote,
  ].join(" ");
}

function summarizeConflicts(conflicts: ReportConflict[]): string {
  if (conflicts.length === 0) {
    return "No material source conflicts were detected in this mock research pass.";
  }

  const critical = conflicts.filter((conflict) => conflict.severity === "critical").length;
  const warnings = conflicts.filter((conflict) => conflict.severity === "warning").length;
  return `Research flagged ${conflicts.length} inconsistenc${conflicts.length === 1 ? "y" : "ies"} (${critical} critical, ${warnings} warning) that should be verified before the PEM.`;
}
