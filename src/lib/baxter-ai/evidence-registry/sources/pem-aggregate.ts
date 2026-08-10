/**
 * PEM NEAT aggregate / reporting evidence source.
 * Claims cross-record count/list/breakdown questions; never single-prospect lookups.
 */

import { isPemAggregateSemantic } from "@/lib/baxter-ai/semantic-question-classification";
import {
  formatPemAggregateAmbiguous,
  formatPemAggregateAnswer,
  formatPemAggregateUnrecognized,
  resolveAndAggregatePemNeats,
  type PemAggregateQueryParams,
} from "@/lib/baxter-data/pem-neats/aggregate";
import type { EvidenceSource, EvidenceSourceResult } from "../types";
import type { SemanticPemAggregateQuery } from "@/lib/baxter-ai/semantic-question-classification";

function toQueryParams(raw: SemanticPemAggregateQuery): PemAggregateQueryParams {
  return {
    intent: raw.intent ?? "count",
    salespersonName: raw.salespersonName ?? null,
    datePreset: raw.datePreset ?? null,
    customStart: raw.customStart ?? null,
    customEnd: raw.customEnd ?? null,
    calendarMonth: raw.calendarMonth ?? null,
    calendarYear: raw.calendarYear ?? null,
    outcome: raw.outcome ?? null,
    qualification: raw.qualification ?? null,
    includeOutcomeBreakdown: Boolean(raw.includeOutcomeBreakdown),
    highlightOutcomes: raw.highlightOutcomes ?? [],
  };
}

export const pemAggregateEvidenceSource: EvidenceSource = {
  key: "pem_aggregate",

  canHandle(input) {
    if (input.entity.skipEntityLookup) {
      return { plausible: false, confidence: 0 };
    }
    if (isPemAggregateSemantic(input.entity.semantic)) {
      return {
        plausible: true,
        confidence: Math.max(0.97, input.entity.semantic!.confidence),
      };
    }
    return { plausible: false, confidence: 0 };
  },

  async resolve(input): Promise<EvidenceSourceResult | null> {
    const semantic = input.entity.semantic;
    if (!isPemAggregateSemantic(semantic) || !semantic!.aggregateQuery) return null;

    const params = toQueryParams(semantic!.aggregateQuery);
    const resolved = await resolveAndAggregatePemNeats({ params }).catch(() => null);
    if (!resolved) return null;

    if (resolved.kind === "unrecognized_salesperson") {
      return {
        items: [],
        deterministicAnswer: formatPemAggregateUnrecognized(resolved.name),
        confidence: 0.95,
        softMiss: false,
        intentLabel: "pem_aggregate",
      };
    }
    if (resolved.kind === "ambiguous_salesperson") {
      return {
        items: [],
        clarification: formatPemAggregateAmbiguous(resolved.name, resolved.options),
        confidence: 0.95,
        intentLabel: "pem_aggregate",
      };
    }

    const answer = formatPemAggregateAnswer({ resolved });
    const top = resolved.result.matching.slice(0, 5);
    return {
      items: top.map((row, index) => ({
        number: index + 1,
        id: row.id,
        title: `${row.prospect_name} — PEM NEAT`,
        summary: `${row.salesperson_display_name}; ${row.meeting_date ?? "no date"}; ${row.meeting_outcome ?? "no outcome"}`,
        contentExcerpt: answer.slice(0, 400),
        category: "PEM NEAT",
        tags: ["pem_aggregate"],
        sourceName: "PEM NEAT",
        sourceUrl: null,
        sourceType: "pem",
        mimeType: null,
        updatedAt: new Date().toISOString(),
        citationLabel: `${row.prospect_name} — PEM NEAT`,
        relevanceScore: 100,
      })),
      deterministicAnswer: answer,
      confidence: 0.98,
      intentLabel: "pem_aggregate",
      diagnostics: {
        total: resolved.result.total,
        byOutcome: resolved.result.byOutcome,
        dateLabel: resolved.dateLabel,
        salesperson: resolved.salesperson?.displayName ?? null,
      },
    };
  },
};
