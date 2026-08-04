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

/** Structured output for the per-question semantic routing call (not an answer). */
export const semanticQuestionClassificationSchema = z.object({
  questionType: z.enum([
    "entity_lookup",
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
  confidence: z.number().min(0).max(1),
});

export type SemanticQuestionClassificationParsed = z.infer<
  typeof semanticQuestionClassificationSchema
>;

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
  if (result.questionType !== "entity_lookup") {
    return { ...result, entityName: null, entityTypeGuess: null };
  }
  return {
    ...result,
    entityName: result.entityName?.trim() || null,
    entityTypeGuess: result.entityTypeGuess ?? "unknown",
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
