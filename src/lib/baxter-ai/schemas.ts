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
});

export const baxterLlmStructuredSchema = z.object({
  answer: z.string().min(1),
  usedSourceNumbers: z.array(z.number().int().positive()).default([]),
  confidence: z.enum(["high", "medium", "low"]),
  insufficientKnowledge: z.boolean(),
});

export type BaxterChatRequest = z.infer<typeof baxterChatRequestSchema>;
export type BaxterLlmStructured = z.infer<typeof baxterLlmStructuredSchema>;

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
    // Attempt to extract the first JSON object.
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
