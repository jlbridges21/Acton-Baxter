/**
 * Master Project Log evidence source — authoritative project registry.
 */

import {
  detectProjectRegistryQuery,
  formatProjectRegistryAnswer,
  isProjectRegistryQuestion,
  loadMasterProjectLog,
  lookupProjectRow,
  setProjectRegistryLoadDepsForTests as setLoadDeps,
  type LoadProjectRegistryDeps,
  type ProjectLogRow,
} from "@/lib/baxter-data/project-registry";
import { extractProjectReferenceName } from "@/lib/dossier/project-setup-name-resolve";
import { extractProjectNumbers } from "@/lib/baxter-data/slack/project-status";
import { normalizeEntitySearchName } from "@/lib/baxter-ai/entity-name-normalize";
import { isSemanticRoutingConfident } from "@/lib/baxter-ai/semantic-question-classification";
import type { EvidenceSource, EvidenceSourceResult } from "../types";

/** Test inject for Master Project Log rows / settings. */
export function setProjectRegistryLoadDepsForTests(deps: LoadProjectRegistryDeps | null): void {
  setLoadDeps(deps);
}

function contextItemForRow(row: ProjectLogRow, tabName: string, excerpt: string) {
  return {
    number: 1,
    id: `project-log:${row.projectNumber}`,
    title: `${tabName} — ${row.projectNumber} ${row.shortName}`.trim(),
    summary: row.customerName || null,
    contentExcerpt: excerpt.slice(0, 1200),
    category: "Master Project Log",
    tags: ["project_registry", "master_project_log", row.projectNumber.toLowerCase()],
    sourceName: tabName,
    sourceUrl: null,
    sourceType: "project_registry",
    mimeType: null,
    updatedAt: new Date().toISOString(),
    citationLabel: `${tabName} (row ${row.rowNumber}) — Project Charter Master`,
    relevanceScore: 0.99,
  };
}

export const projectRegistryEvidenceSource: EvidenceSource = {
  key: "project_registry",

  canHandle(input) {
    if (detectProjectRegistryQuery(input.question)) {
      return { plausible: true, confidence: 0.96 };
    }
    if (isProjectRegistryQuestion(input.question)) {
      // Project reference without a clear registry field — still high, but below
      // a confident PEM content ask; GHL may still win for pure CRM fields without "project".
      return { plausible: true, confidence: 0.88 };
    }
    const semantic = input.entity.semantic;
    if (
      isSemanticRoutingConfident(semantic) &&
      semantic!.questionType === "entity_lookup" &&
      /\bproject\b/i.test(input.question)
    ) {
      return { plausible: true, confidence: 0.8 };
    }
    return { plausible: false, confidence: 0 };
  },

  async resolve(input): Promise<EvidenceSourceResult | null> {
    let effective = detectProjectRegistryQuery(input.question);
    if (!effective) {
      // Also harden project-registry resolve fallback
      const projectQuery =
        extractProjectNumbers(input.question)[0] ||
        extractProjectReferenceName(input.question) ||
        (input.entity.extractedName ? normalizeEntitySearchName(input.entity.extractedName) : null);
      if (!projectQuery) return null;
      if (/\bcity\b/i.test(input.question)) {
        effective = { kind: "field_lookup", projectQuery, field: "city" };
      } else if (/\b(address|street|where|location)\b/i.test(input.question)) {
        effective = { kind: "field_lookup", projectQuery, field: "address" };
      } else if (/\bjurisdiction\b/i.test(input.question)) {
        effective = { kind: "field_lookup", projectQuery, field: "jurisdiction" };
      } else if (/\b(sales(?:person|rep)?)\b/i.test(input.question)) {
        effective = { kind: "field_lookup", projectQuery, field: "salesperson" };
      } else if (/\bproject\s*(?:number|#)\b/i.test(input.question)) {
        effective = { kind: "field_lookup", projectQuery, field: "project_number" };
      } else if (/\bproject\b/i.test(input.question)) {
        effective = { kind: "project_identity", projectQuery };
      } else {
        return null;
      }
    }

    try {
      const loaded = await loadMasterProjectLog();
      if (loaded.rows.length === 0) {
        return {
          items: [],
          deterministicAnswer:
            "I couldn’t read the Master Project Log right now (no rows available).",
          confidence: 0.2,
          softMiss: true,
          diagnostics: { spreadsheetId: loaded.spreadsheetId, tabName: loaded.tabName },
        };
      }

      const formatted = formatProjectRegistryAnswer({
        query: effective,
        rows: loaded.rows,
        tabName: loaded.tabName || "Master Project Log",
      });

      const items = formatted.matchedRow
        ? [
            contextItemForRow(
              formatted.matchedRow,
              loaded.tabName || "Master Project Log",
              formatted.answer,
            ),
          ]
        : [];

      // Absent / blank-field answers are authoritative — don't fall through to surname dumps.
      return {
        items,
        deterministicAnswer: formatted.answer,
        confidence: formatted.softMiss && !formatted.matchedRow ? 0.9 : 0.97,
        softMiss: false,
        diagnostics: {
          tabName: loaded.tabName,
          fromCache: loaded.fromCache,
          query: effective,
          projectNumber: formatted.matchedRow?.projectNumber ?? null,
          customerName: formatted.matchedRow?.customerName ?? null,
        },
      };
    } catch (error) {
      return {
        items: [],
        deterministicAnswer: `I couldn’t read the Master Project Log: ${
          error instanceof Error ? error.message.slice(0, 160) : "unknown error"
        }`,
        confidence: 0.15,
        softMiss: true,
      };
    }
  },
};

/**
 * Resolve a project reference to the registry's customer name for GHL bridging.
 */
export async function resolveCustomerNameFromProjectRegistry(
  questionOrName: string,
  deps?: LoadProjectRegistryDeps,
): Promise<{
  customerName: string;
  projectNumber: string;
  shortName: string;
  city: string;
} | null> {
  const query =
    extractProjectNumbers(questionOrName)[0] ||
    extractProjectReferenceName(questionOrName) ||
    questionOrName.trim();
  if (!query) return null;
  try {
    const loaded = await loadMasterProjectLog(deps ?? {});
    const hit = lookupProjectRow(loaded.rows, query);
    if (hit.kind !== "unique") return null;
    const customer = hit.row.customerName.trim();
    if (!customer) return null;
    return {
      customerName: customer,
      projectNumber: hit.row.projectNumber,
      shortName: hit.row.shortName,
      city: hit.row.city,
    };
  } catch {
    return null;
  }
}
