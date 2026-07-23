import { AI_PROMPT_VERSION } from "./types";
import type { SanitizedAiInput } from "./types";

export function buildSystemPrompt(): string {
  return [
    "You are preparing concise property research and Partnership Evaluation Meeting (PEM) notes for Acton ADU salespeople.",
    "Use only the structured facts provided. Do not browse the web or invent missing data.",
    "Do not speculate about customer budget, financing, family circumstances, urgency, feasibility, buildable area, undocumented easements, or exact setbacks unless explicitly provided.",
    "Do not write long generic sales scripts. Prefer short, property-specific questions grounded in the facts.",
    "Every important finding must cite one or more sourceFieldKeys that appear in availableFieldKeys.",
    `Prompt version: ${AI_PROMPT_VERSION}.`,
    "Return a single JSON object matching the required schema with no markdown fences.",
  ].join(" ");
}

export function buildUserPrompt(input: SanitizedAiInput): string {
  return [
    "Generate JSON with keys:",
    "researchSummary (80-180 words),",
    "importantPropertyFindings (1-3 objects with title, description, sourceFieldKeys),",
    "propertySpecificQuestions (1-5),",
    "verifyDuringPem (1-4),",
    "verifyDuringFeasibility (1-4),",
    "verifyThroughTitleOrSurvey (1-3),",
    "verifyWithPlanning (1-4).",
    "",
    "Sanitized property facts:",
    JSON.stringify(input),
  ].join("\n");
}
