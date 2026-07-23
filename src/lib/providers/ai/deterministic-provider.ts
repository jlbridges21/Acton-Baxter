import "server-only";

import { FIELD_KEYS } from "@/lib/research/constants";
import type { AiReportGenerator } from "./types";
import type { SanitizedAiInput } from "./types";
import type { AiReportContent } from "./schemas";
import { countWords } from "./schemas";

function expandToWordRange(text: string, minWords: number, maxWords: number): string {
  let words = text.trim().split(/\s+/).filter(Boolean);
  const fillers = [
    "This summary is intended only for Partnership Evaluation Meeting preparation and is not a feasibility determination.",
    "Salespeople should treat conflicting measurements as items to confirm on site rather than as final design inputs.",
    "Official planning confirmation remains required before any setback, overlay, or permit conclusions are presented to the customer.",
    "Licensed and public sources can lag recent construction, so field verification remains essential.",
  ];
  let fillerIndex = 0;
  while (words.length < minWords && fillerIndex < fillers.length * 3) {
    const filler = fillers[fillerIndex % fillers.length]!;
    words = [...words, ...filler.split(/\s+/)];
    fillerIndex += 1;
  }
  if (words.length > maxWords) {
    words = words.slice(0, maxWords);
  }
  return words.join(" ");
}

export function buildDeterministicAiContent(input: SanitizedAiInput): AiReportContent {
  const lot = input.lotSquareFootage
    ? `${input.lotSquareFootage.toLocaleString()} sq ft lot`
    : "lot size pending verification";
  const living = input.livingAreaSquareFootage
    ? `${input.livingAreaSquareFootage.toLocaleString()} sq ft living area`
    : "living area pending verification";
  const year = input.yearBuilt ? `built in ${input.yearBuilt}` : "year built unknown";
  const zoning = input.zoning
    ? `Zoning appears as ${input.zoning}`
    : "Zoning was not confirmed from available sources";
  const conflictNote =
    input.conflicts.length === 0
      ? "No material source conflicts were detected in this research pass."
      : `Research flagged ${input.conflicts.length} inconsistenc${input.conflicts.length === 1 ? "y" : "ies"} that should be verified before the PEM.`;

  const baseSummary = [
    `${input.standardizedAddress} is in ${input.governingJurisdiction ?? "an unknown jurisdiction"}, ${input.county ?? "unknown"} County.`,
    `Public and licensed sources describe a ${lot} with approximately ${living}, ${year}.`,
    `${zoning}.`,
    input.apn ? `The preferred APN is ${input.apn}.` : "APN still requires confirmation.",
    conflictNote,
    input.missingCriticalFields.length > 0
      ? `Missing critical fields include ${input.missingCriticalFields.slice(0, 5).join(", ")}.`
      : "Core identity fields were largely populated from available sources.",
  ].join(" ");

  const researchSummary = expandToWordRange(baseSummary, 80, 180);
  if (countWords(researchSummary) < 80) {
    // Safety net if expansion somehow failed.
    throw new Error("Deterministic summary did not meet minimum word count");
  }

  const findings: AiReportContent["importantPropertyFindings"] = [];
  if (input.apn) {
    findings.push({
      title: "APN identified",
      description: `APN ${input.apn} was identified from available sources and should be confirmed against title documents.`,
      sourceFieldKeys: [FIELD_KEYS.apn],
    });
  }
  if (input.lotSquareFootage != null) {
    findings.push({
      title: "Preferred lot size",
      description: `Preferred lot size is approximately ${input.lotSquareFootage.toLocaleString()} sq ft.`,
      sourceFieldKeys: [FIELD_KEYS.lotSqFt],
    });
  }
  if (input.zoning) {
    findings.push({
      title: "Preferred zoning",
      description: `Preferred zoning value is ${input.zoning}. Confirm with the governing planning department before feasibility work.`,
      sourceFieldKeys: [FIELD_KEYS.zoning],
    });
  }
  if (findings.length === 0) {
    findings.push({
      title: "Limited characteristics",
      description:
        "Limited property characteristics were available from providers. Confirm core parcel facts during the PEM.",
      sourceFieldKeys: input.availableFieldKeys.slice(0, 1).length
        ? input.availableFieldKeys.slice(0, 1)
        : [FIELD_KEYS.apn],
    });
  }

  const questions: string[] = [];
  const livingConflict = input.conflicts.find((c) => c.fieldKey === FIELD_KEYS.livingAreaSqFt);
  if (livingConflict) {
    questions.push(
      "Public records report different living-area measurements. Has the home been expanded or remodeled?",
    );
  }
  if (input.relevantOverlays.length > 0) {
    questions.push(
      "The parcel is within a listed planning overlay. Have you previously discussed this property with the city?",
    );
  }
  if ((input.buildingCount ?? 0) > 1) {
    questions.push(
      "Public records indicate more than one structure. What are the current uses of the detached structures?",
    );
  }
  const lotConflict = input.conflicts.find((c) => c.fieldKey === FIELD_KEYS.lotSqFt);
  if (lotConflict) {
    questions.push(
      "County and licensed data sources report slightly different lot sizes. Do you have a survey or title documents available?",
    );
  }
  if (input.governingJurisdiction) {
    questions.push(
      `The official parcel record identifies ${input.governingJurisdiction} as the governing jurisdiction. Have you already contacted planning staff there?`,
    );
  }
  if (questions.length === 0) {
    questions.push(
      "Are there additions or remodels that may not appear in current assessor or licensed data?",
    );
    questions.push(
      "Does the homeowner know of easements, shared access, or HOA rules that affect ADU placement?",
    );
  }

  return {
    researchSummary,
    importantPropertyFindings: findings.slice(0, 3),
    propertySpecificQuestions: questions.slice(0, 5),
    verifyDuringPem: [
      "Confirm owner goals and timeline.",
      "Walk the site and note access, utilities, and existing structures.",
      ...(input.conflicts.length > 0
        ? ["Discuss the flagged source inconsistencies and what documents the owner can provide."]
        : []),
    ].slice(0, 4),
    verifyDuringFeasibility: [
      "Reconcile lot-size and living-area differences with field measurements.",
      "Confirm zoning and overlays with the governing planning department.",
      ...(input.missingCriticalFields.includes(FIELD_KEYS.fireZone)
        ? ["Manually confirm fire-hazard status if wildfire risk may affect design."]
        : []),
    ].slice(0, 4),
    verifyThroughTitleOrSurvey: [
      "Confirm legal description and APN.",
      "Identify easements that may constrain placement or access.",
      ...(input.apn ? [`Validate APN ${input.apn} against title documents.`] : []),
    ].slice(0, 3),
    verifyWithPlanning: [
      "Verify zoning and any required permits or historic review.",
      "Ask about open code cases or relevant overlays.",
      ...(input.relevantOverlays.length > 0
        ? [`Confirm overlay implications for: ${input.relevantOverlays.slice(0, 3).join(", ")}.`]
        : []),
    ].slice(0, 4),
  };
}

export class DeterministicAiProvider implements AiReportGenerator {
  readonly key = "deterministic" as const;
  readonly name = "Deterministic Summarizer";
  readonly model = "deterministic-v1";

  async generate(input: SanitizedAiInput): Promise<AiReportContent> {
    return buildDeterministicAiContent(input);
  }
}
