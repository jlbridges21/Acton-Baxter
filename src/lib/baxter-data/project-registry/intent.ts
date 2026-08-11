/**
 * Detect Master Project Log questions (field lookup, filter, count).
 */

import { extractProjectNumbers } from "@/lib/baxter-data/slack/project-status";
import { extractProjectReferenceName } from "@/lib/dossier/project-setup-name-resolve";
import type { ProjectRegistryField, ProjectRegistryQuery } from "./types";

const FIELD_PATTERNS: Array<{ re: RegExp; field: ProjectRegistryField }> = [
  { re: /\bcity\b/i, field: "city" },
  { re: /\b(street\s+)?address\b/i, field: "address" },
  { re: /\b(zip(?:\s*code)?|postal(?:\s*code)?)\b/i, field: "postal" },
  { re: /\bjurisdiction\b/i, field: "jurisdiction" },
  { re: /\b(sales(?:person|rep)?|who\s+(?:sold|owns|runs|started))\b/i, field: "salesperson" },
  { re: /\bproject\s*(?:number|#|no\.?)\b/i, field: "project_number" },
  { re: /\bcustomer\s*name\b|\bwho\s+is\s+the\s+customer\b/i, field: "customer_name" },
  { re: /\b(start\s+date|fp\s*paid|when\s+(?:did|was)\s+.+\s+start)/i, field: "start_date" },
  { re: /\bshort\s*name\b/i, field: "short_name" },
];

function extractCityFilter(question: string): string | null {
  const m =
    question.match(/\b(?:in|from|around)\s+([A-Za-z][A-Za-z.\s-]{1,40}?)\s*\??$/i) ||
    question.match(/\bprojects?\s+(?:in|from)\s+([A-Za-z][A-Za-z.\s-]{1,40}?)(?:\?|$)/i) ||
    question.match(/\bwhich\s+projects?\s+(?:are\s+)?(?:in|from)\s+([A-Za-z][A-Za-z.\s-]{1,40}?)/i);
  if (!m?.[1]) return null;
  const city = m[1].replace(/\b(the|a|an)\b/gi, "").trim();
  if (/^(california|ca|texas|tx|project|projects)$/i.test(city)) return null;
  return city || null;
}

function extractYear(question: string): number | null {
  const m = question.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function extractSalesperson(question: string): string | null {
  const m = question.match(
    /\b(?:did|by|for|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:start|sell|run|own)/i,
  );
  if (m?.[1]) return m[1].trim();
  const m2 = question.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:start(?:ed)?|sold)\b/i);
  if (m2?.[1]) return m2[1].trim();
  // "projects Jesse Soares started" / "salesperson Jesse"
  const m3 = question.match(
    /\b(?:salesperson|sales\s*rep|rep)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  );
  return m3?.[1]?.trim() || null;
}

/**
 * True when the question should consult the Master Project Log registry.
 */
export function isProjectRegistryQuestion(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (detectProjectRegistryQuery(q)) return true;
  // Broader: project number or "the X project" even without a named field
  if (extractProjectNumbers(q).length > 0) return true;
  if (extractProjectReferenceName(q)) return true;
  return false;
}

export function detectRequestedProjectRegistryField(question: string): ProjectRegistryField | null {
  for (const { re, field } of FIELD_PATTERNS) {
    if (re.test(question)) return field;
  }
  return null;
}

/**
 * Parse a structured registry query from natural language.
 */
export function detectProjectRegistryQuery(question: string): ProjectRegistryQuery | null {
  const q = question.trim();
  if (!q) return null;

  // Counts
  if (/\bhow\s+many\s+projects?\b/i.test(q) || /\bcount\s+(?:of\s+)?projects?\b/i.test(q)) {
    return {
      kind: "count",
      city: extractCityFilter(q),
      salesperson: extractSalesperson(q),
      year: extractYear(q),
    };
  }

  // City / location filter lists
  if (
    /\bwhich\s+projects?\b/i.test(q) ||
    /\bwhat\s+projects?\b/i.test(q) ||
    /\blist\s+(?:the\s+)?projects?\b/i.test(q)
  ) {
    const city = extractCityFilter(q);
    if (city) return { kind: "filter_city", city };
  }

  const projectQuery =
    extractProjectNumbers(q)[0] ||
    extractProjectReferenceName(q) ||
    q.match(/\bfor\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+)?)\b/i)?.[1] ||
    null;

  if (!projectQuery) return null;

  const field = detectRequestedProjectRegistryField(q);
  if (field) {
    return { kind: "field_lookup", projectQuery, field };
  }

  // "what is the Yeh project number" already caught; bare identity asks
  if (/\b(project\s+number|which\s+project|identify|look\s*up)\b/i.test(q)) {
    return { kind: "project_identity", projectQuery };
  }

  // Field-ish project asks without explicit field still claim registry for identity bridge
  if (/\bproject\b/i.test(q) && FIELD_PATTERNS.some((p) => p.re.test(q))) {
    return {
      kind: "field_lookup",
      projectQuery,
      field: detectRequestedProjectRegistryField(q) ?? "city",
    };
  }

  return null;
}
