import { z } from "zod";

export const BAXTER_MAX_QUESTION_LENGTH = 2_000;

export const baxterChatRequestSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "Please enter a question")
    .max(
      BAXTER_MAX_QUESTION_LENGTH,
      `Question must be ${BAXTER_MAX_QUESTION_LENGTH} characters or fewer`,
    ),
  conversationId: z.string().uuid().optional().nullable(),
  clientRequestId: z.string().uuid().optional().nullable(),
});

export const baxterLlmStructuredSchema = z.object({
  answer: z.string().min(1),
  usedSourceNumbers: z.array(z.number().int().positive()).default([]),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  insufficientKnowledge: z.boolean().default(false),
  answerMode: z
    .enum(["identity", "grounded", "general", "mixed", "clarification"])
    .default("general"),
});

export type BaxterChatRequest = z.infer<typeof baxterChatRequestSchema>;
export type BaxterLlmStructured = z.infer<typeof baxterLlmStructuredSchema>;

/** Structured PEM NEAT aggregate/reporting filters extracted by the routing LLM. */
export const semanticPemAggregateQuerySchema = z
  .object({
    intent: z.enum(["count", "list", "breakdown"]).default("count"),
    salespersonName: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => {
        if (typeof v !== "string") return null;
        const t = v.trim();
        return t.length > 0 ? t : null;
      })
      .optional()
      .default(null),
    datePreset: z
      .union([
        z.enum([
          "this_week",
          "this_month",
          "last_month",
          "this_year",
          "last_7_days",
          "last_30_days",
          "all_time",
          "custom",
        ]),
        z.null(),
        z.undefined(),
      ])
      .transform((v) => v ?? null)
      .optional()
      .default(null),
    customStart: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null,
      )
      .optional()
      .default(null),
    customEnd: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null,
      )
      .optional()
      .default(null),
    calendarMonth: z
      .union([z.number(), z.null(), z.undefined()])
      .transform((v) =>
        typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 12 ? Math.floor(v) : null,
      )
      .optional()
      .default(null),
    calendarYear: z
      .union([z.number(), z.null(), z.undefined()])
      .transform((v) =>
        typeof v === "number" && Number.isFinite(v) && v >= 2000 && v <= 2100
          ? Math.floor(v)
          : null,
      )
      .optional()
      .default(null),
    outcome: z
      .union([
        z.enum(["YES", "NO", "DECISION_DATE", "DECISION_DATE_NOT_SECURED"]),
        z.null(),
        z.undefined(),
      ])
      .transform((v) => v ?? null)
      .optional()
      .default(null),
    qualification: z
      .union([
        z.enum([
          "STRONGLY_QUALIFIED",
          "QUALIFIED_WITH_RISKS",
          "EARLY_EXPLORATORY",
          "WEAKLY_QUALIFIED",
          "DISQUALIFIED",
        ]),
        z.null(),
        z.undefined(),
      ])
      .transform((v) => v ?? null)
      .optional()
      .default(null),
    includeOutcomeBreakdown: z.boolean().optional().default(false),
    highlightOutcomes: z
      .array(z.enum(["YES", "NO", "DECISION_DATE", "DECISION_DATE_NOT_SECURED"]))
      .max(4)
      .optional()
      .default([]),
  })
  .nullable()
  .optional()
  .default(null);

/** Structured output for the per-question semantic routing call (not an answer). */
export const semanticQuestionClassificationSchema = z.object({
  questionType: z.enum([
    "entity_lookup",
    "pem_aggregate",
    "capability_howto",
    "procedural_knowledge",
    "general_conversational",
    "ambiguous",
  ]),
  entityName: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (typeof v !== "string") return null;
      const t = v.trim();
      return t.length > 0 ? t : null;
    })
    .optional()
    .default(null),
  entityTypeGuess: z
    .union([
      z.enum([
        "ghl_contact",
        "ghl_opportunity",
        "pem_prospect",
        "rulebook_step_or_role",
        "unknown",
      ]),
      z.null(),
      z.undefined(),
    ])
    .transform((v) => v ?? null)
    .optional()
    .default(null),
  /**
   * For entity_lookup only: open-ended vs category-specific.
   * null when not entity_lookup or classifier omitted the field.
   */
  lookupSpecificity: z
    .union([z.enum(["generic", "specific", "content_search"]), z.null(), z.undefined()])
    .transform((v) => (v === "generic" || v === "specific" || v === "content_search" ? v : null))
    .optional()
    .default(null),
  /**
   * Distinct information needs when the question asks 2–3 different things
   * (usually different sources/categories). Empty/omitted = single need.
   * Only keep a multi-need list when at least two distinct sourceHints appear —
   * same-source splits ("budget and funding") stay on the single-need path.
   */
  informationNeeds: z
    .array(
      z.object({
        partQuestion: z
          .string()
          .transform((v) => v.trim())
          .pipe(z.string().min(1).max(400)),
        entityName: z
          .union([z.string(), z.null(), z.undefined()])
          .transform((v) => {
            if (typeof v !== "string") return null;
            const t = v.trim();
            return t.length > 0 ? t : null;
          })
          .optional()
          .default(null),
        sourceHint: z.enum(["pem", "ghl", "slack", "knowledge", "rulebook", "unknown"]),
        lookupSpecificity: z
          .union([z.enum(["generic", "specific", "content_search"]), z.null(), z.undefined()])
          .transform((v) =>
            v === "generic" || v === "specific" || v === "content_search" ? v : null,
          )
          .optional()
          .default("specific"),
      }),
    )
    .max(3)
    .optional()
    .default([]),
  /** Present when questionType is pem_aggregate — structured reporting filters. */
  aggregateQuery: semanticPemAggregateQuerySchema,
  confidence: z.number().min(0).max(1),
});

export type SemanticQuestionClassificationParsed = z.infer<
  typeof semanticQuestionClassificationSchema
>;

export type SemanticInformationNeedParsed = NonNullable<
  SemanticQuestionClassificationParsed["informationNeeds"]
>[number];

/**
 * Multi-need resolution is for cross-source compounds only.
 * Same-source splits (e.g. "budget and funding" both → pem) must not fragment.
 */
export function collapseSameSourceInformationNeeds<T extends { sourceHint: string }>(
  needs: T[],
): T[] {
  if (needs.length < 2) return [];
  const distinct = new Set(needs.map((n) => n.sourceHint).filter((h) => h && h !== "unknown"));
  if (distinct.size < 2) return [];
  return needs.slice(0, 3);
}

export function parseSemanticQuestionClassificationJson(
  raw: string,
): SemanticQuestionClassificationParsed {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } else {
      throw new Error("Semantic classifier returned non-JSON content");
    }
  }
  const result = semanticQuestionClassificationSchema.parse(parsed);
  if (result.questionType === "pem_aggregate") {
    return {
      ...result,
      entityName: null,
      entityTypeGuess: null,
      lookupSpecificity: null,
      informationNeeds: [],
      aggregateQuery: result.aggregateQuery ?? null,
    };
  }
  if (result.questionType !== "entity_lookup") {
    return {
      ...result,
      entityName: null,
      entityTypeGuess: null,
      lookupSpecificity: null,
      informationNeeds: [],
      aggregateQuery: null,
    };
  }
  return {
    ...result,
    entityName: result.entityName?.trim() || null,
    entityTypeGuess: result.entityTypeGuess ?? "unknown",
    lookupSpecificity: result.lookupSpecificity ?? null,
    informationNeeds: collapseSameSourceInformationNeeds(result.informationNeeds ?? []),
    aggregateQuery: null,
  };
}

export function parseBaxterLlmJson(raw: string): BaxterLlmStructured {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } else {
      throw new Error("Model returned non-JSON content");
    }
  }
  return baxterLlmStructuredSchema.parse(parsed);
}

/**
 * Prefer structured JSON; if metadata fails but answer text is recoverable, keep the answer.
 */
export function parseBaxterLlmOutputLenient(raw: string): {
  structured: BaxterLlmStructured | null;
  textFallback: string | null;
} {
  try {
    return { structured: parseBaxterLlmJson(raw), textFallback: null };
  } catch {
    // try mild repair without destroying apostrophes inside strings
    try {
      const repaired = raw
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .replace(/,\s*([}\]])/g, "$1");
      return { structured: parseBaxterLlmJson(repaired), textFallback: null };
    } catch {
      const answerMatch = raw.match(/"answer"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (answerMatch?.[1]) {
        const unescaped = answerMatch[1]
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
        return {
          structured: null,
          textFallback: unescaped.trim() || null,
        };
      }
      // Plain non-JSON text answer
      const plain = raw
        .trim()
        .replace(/^```[\w]*\s*/i, "")
        .replace(/\s*```$/i, "");
      if (plain && !plain.startsWith("{")) {
        return { structured: null, textFallback: plain };
      }
      return { structured: null, textFallback: null };
    }
  }
}
