/**
 * Honest PEM fallbacks — never silently substitute a different answer type.
 * Example questions are generated from what this specific NEAT actually contains.
 */

import type { PemNeatRecord } from "@/lib/pem-neat/types";
import type { PemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import { getPemField, type PemFieldKey } from "./fields";

const EXAMPLE_FIELD_ORDER: PemFieldKey[] = [
  "type_1_pain",
  "type_2_pain",
  "budget",
  "schedule",
  "decision_process",
  "customer_story",
  "outcome",
  "next_steps",
];

function displayFirstName(prospectName: string): string {
  const primary = prospectName.split(/&|,/)[0]?.trim() || prospectName;
  const first = primary.split(/\s+/)[0]?.trim();
  return first || prospectName;
}

/**
 * Build 2–3 concrete example questions this NEAT can answer well.
 */
export function buildPemAnswerableExampleQuestions(
  record: Pick<
    PemNeatRecord,
    | "prospect_name"
    | "transcript"
    | "structured_result"
    | "salesperson_display_name"
    | "buildertrend_fields"
  >,
): string[] {
  const name = displayFirstName(record.prospect_name);
  const structured =
    record.structured_result && typeof record.structured_result === "object"
      ? (record.structured_result as PemNeatStructuredResult)
      : null;
  const examples: string[] = [];

  if (structured) {
    for (const key of EXAMPLE_FIELD_ORDER) {
      if (examples.length >= 3) break;
      const field = getPemField(structured, key, {
        salespersonName: record.salesperson_display_name,
        buildertrendFallback: (record.buildertrend_fields ?? {}) as Record<string, unknown>,
      });
      if (!field.determinable) continue;
      if (key === "type_1_pain") {
        examples.push(`What is ${name}'s Type 1 Pain?`);
      } else if (key === "type_2_pain") {
        examples.push(`What is ${name}'s Type 2 Pain?`);
      } else if (key === "customer_story") {
        examples.push(`What is ${name}'s Customer Story?`);
      } else {
        examples.push(`What is ${name}'s ${field.label.replace(/\s*—.*$/, "").trim()}?`);
      }
    }
  }

  if (examples.length < 3 && (record.transcript ?? "").trim().length > 80) {
    examples.push(`What did the advisor say about budget in ${name}'s PEM?`);
  }
  if (examples.length < 3 && record.salesperson_display_name?.trim()) {
    examples.push(`Who ran ${name}'s PEM?`);
  }

  return examples.slice(0, 3);
}

export function formatPemHonestMissAnswer(input: {
  prospectName: string;
  meetingDate: string | null;
  citationLabel: string;
  kind: "content_search" | "field_lookup";
  fieldLabel?: string | null;
  examples: string[];
  /** Optional topic the user asked about (e.g. "solar") for a clearer miss line. */
  soughtTopic?: string | null;
}): string {
  const when = input.meetingDate ? ` (${input.meetingDate})` : "";
  const lines: string[] = [];

  if (input.kind === "content_search") {
    if (input.soughtTopic) {
      lines.push(
        `I couldn't find any mention of ${input.soughtTopic} in ${input.prospectName}'s transcript${when}.`,
      );
    } else {
      lines.push(
        `I couldn't find that specific part of the transcript in ${input.prospectName}'s PEM NEAT${when}.`,
      );
    }
  } else {
    const label = input.fieldLabel?.trim() || "that field";
    lines.push(
      `I couldn't find a clear ${label} answer in ${input.prospectName}'s PEM NEAT${when}.`,
    );
  }

  if (input.examples.length > 0) {
    lines.push("");
    lines.push(`For ${input.prospectName}, I can answer questions like:`);
    for (const ex of input.examples) {
      lines.push(`• ${ex}`);
    }
  }

  lines.push("");
  lines.push(`Source searched: ${input.citationLabel}`);
  return lines.join("\n");
}
