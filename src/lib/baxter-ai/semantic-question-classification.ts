/**
 * Semantic question classification — primary routing signal into the evidence registry.
 * Small/fast LLM call; regex entity extraction remains the fallback when this fails.
 */

import { getEnv } from "@/lib/env";
import { buildOpenAiJsonRequest, extractOpenAiResponsesText } from "@/lib/openai/json-request";
import { parseChatCommand } from "@/lib/baxter-ai/commands";
import { classifyBaxterQuestion } from "@/lib/baxter-ai/classify";
import {
  parseSemanticQuestionClassificationJson,
  type SemanticQuestionClassificationParsed,
} from "@/lib/baxter-ai/schemas";
import { logBaxterDiagnostic } from "@/lib/baxter-ai/errors";
import type { BaxterHistoryMessage } from "@/lib/baxter-ai/types";

export type SemanticQuestionType = SemanticQuestionClassificationParsed["questionType"];
export type SemanticEntityTypeGuess = NonNullable<
  SemanticQuestionClassificationParsed["entityTypeGuess"]
>;

export type SemanticClassificationSource = "llm" | "skipped" | "fallback_unavailable";

export type SemanticQuestionClassification = {
  questionType: SemanticQuestionType;
  entityName: string | null;
  entityTypeGuess: SemanticEntityTypeGuess | null;
  confidence: number;
  source: SemanticClassificationSource;
  latencyMs: number;
  model: string | null;
  error?: string;
};

/** Minimum confidence to trust semantic routing over regex. */
export const SEMANTIC_ROUTING_CONFIDENCE_THRESHOLD = 0.7;

const ROUTING_MAX_OUTPUT_TOKENS = 180;

const SYSTEM_PROMPT = `You route Acton ADU employee questions for Baxter. Do NOT answer the question — classify only.

Return JSON with keys: questionType, entityName, entityTypeGuess, confidence.

questionType values:
- entity_lookup: asks about a specific named CRM contact/opportunity/deal/project, PEM prospect, or rulebook role/step
- capability_howto: asks how to use Baxter or its tools (project setup, PEM NEAT, Property Research, Customer Center, Slack, GHL features of Baxter itself)
- procedural_knowledge: asks about company process, procedure, policy, workflow, or site visit steps from Knowledge — not a named CRM record
- general_conversational: greeting, thanks, chitchat, or general non-Acton writing help
- ambiguous: cannot tell with confidence

entityName: only for entity_lookup — the real person/deal/project identifier as understood (not a sentence fragment). Otherwise null.
entityTypeGuess: only for entity_lookup — ghl_contact | ghl_opportunity | pem_prospect | rulebook_step_or_role | unknown. Otherwise null.
confidence: 0 to 1.

Critical: words like project, opportunity, deal, site, schedule, plan, customer often appear in how-to and process questions. Those are NOT entity names unless the user is clearly asking about a specific named record (e.g. "Liniger project", "Robert Vertin opportunity").`;

function resolveRoutingModel(): string {
  const env = getEnv();
  // Dedicated routing model (like BAXTER_EMBEDDING_MODEL) — do not inherit expensive chat models.
  const dedicated = (env.BAXTER_ROUTING_MODEL ?? "").trim();
  if (dedicated) return dedicated;
  return "gpt-4o-mini";
}

function resolveRoutingTimeoutMs(): number {
  const env = getEnv();
  return env.BAXTER_ROUTING_TIMEOUT_MS || 4_000;
}

/**
 * Skip the LLM routing call when the question is already handled instantly elsewhere.
 */
export function shouldSkipSemanticClassification(question: string): boolean {
  const cmd = parseChatCommand(question);
  if (cmd.type === "clear" || cmd.type === "help") return true;

  const q = question.trim();
  if (!q) return true;

  // Trivial greetings / ack — classify.ts conversational fast path
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|cool|great|got it)[.!?]*$/i.test(q)) {
    return true;
  }

  const questionClass = classifyBaxterQuestion(q);
  if (questionClass === "unsafe_or_disallowed") return true;
  // Pure identity intros handled by capability/identity path without entity routing
  if (
    questionClass === "baxter_identity" &&
    /^(who (are|is) (you|baxter)|what (are|is) (you|baxter)|what can you (do|help))\b/i.test(q) &&
    q.length < 80
  ) {
    return true;
  }

  return false;
}

export function isSemanticRoutingConfident(
  semantic: SemanticQuestionClassification | null | undefined,
): boolean {
  return Boolean(
    semantic &&
    semantic.source === "llm" &&
    semantic.confidence >= SEMANTIC_ROUTING_CONFIDENCE_THRESHOLD &&
    semantic.questionType !== "ambiguous",
  );
}

export function isNonEntitySemanticType(type: SemanticQuestionType | null | undefined): boolean {
  return (
    type === "capability_howto" ||
    type === "procedural_knowledge" ||
    type === "general_conversational"
  );
}

function unavailableResult(partial: {
  latencyMs: number;
  model: string | null;
  error: string;
  source?: SemanticClassificationSource;
}): SemanticQuestionClassification {
  return {
    questionType: "ambiguous",
    entityName: null,
    entityTypeGuess: null,
    confidence: 0,
    source: partial.source ?? "fallback_unavailable",
    latencyMs: partial.latencyMs,
    model: partial.model,
    error: partial.error,
  };
}

function formatHistory(history: BaxterHistoryMessage[]): string {
  if (!history.length) return "(none)";
  return history
    .slice(-4)
    .map((m) => {
      const role = m.role === "assistant" ? "assistant" : "user";
      const content = (m.content ?? "").trim().slice(0, 240);
      return `${role}: ${content}`;
    })
    .join("\n");
}

function extractChatContent(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const fromResponses = extractOpenAiResponsesText(data);
  if (fromResponses) return fromResponses;
  const choices = data.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

export type ClassifyQuestionSemanticallyOptions = {
  fetchImpl?: typeof fetch;
  /** Test inject — when set, skips the network call entirely. */
  classifierImpl?: (input: {
    question: string;
    history: BaxterHistoryMessage[];
  }) => Promise<SemanticQuestionClassificationParsed> | SemanticQuestionClassificationParsed;
  /** Force skip (e.g. answer path already decided). */
  forceSkip?: boolean;
};

/**
 * One cheap routing classification per question. Never throws — always returns a result;
 * on failure source is fallback_unavailable so callers use regex extraction.
 */
export async function classifyQuestionSemantically(
  input: { question: string; history?: BaxterHistoryMessage[] },
  options?: ClassifyQuestionSemanticallyOptions,
): Promise<SemanticQuestionClassification> {
  const question = input.question.trim();
  const history = input.history ?? [];
  const started = Date.now();

  if (options?.forceSkip || shouldSkipSemanticClassification(question)) {
    return {
      questionType: "ambiguous",
      entityName: null,
      entityTypeGuess: null,
      confidence: 0,
      source: "skipped",
      latencyMs: Date.now() - started,
      model: null,
    };
  }

  const model = resolveRoutingModel();

  if (options?.classifierImpl) {
    try {
      const parsed = await options.classifierImpl({ question, history });
      const validated = parseSemanticQuestionClassificationJson(JSON.stringify(parsed));
      return {
        questionType: validated.questionType,
        entityName: validated.entityName ?? null,
        entityTypeGuess: validated.entityTypeGuess ?? null,
        confidence: validated.confidence,
        source: "llm",
        latencyMs: Date.now() - started,
        model: "injected",
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logBaxterDiagnostic("semanticClassification", {
        code: "SEMANTIC_CLASSIFY_FALLBACK",
        route: "classifyQuestionSemantically",
        safeMessage: `Injected classifier failed: ${error}`,
      });
      return unavailableResult({ latencyMs: Date.now() - started, model: "injected", error });
    }
  }

  const env = getEnv();
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    logBaxterDiagnostic("semanticClassification", {
      code: "SEMANTIC_CLASSIFY_FALLBACK",
      route: "classifyQuestionSemantically",
      safeMessage: "OPENAI_API_KEY missing — falling back to regex entity extraction",
    });
    return unavailableResult({
      latencyMs: Date.now() - started,
      model,
      error: "OPENAI_API_KEY missing",
    });
  }

  const timeoutMs = resolveRoutingTimeoutMs();
  const fetchImpl = options?.fetchImpl ?? fetch;
  const userPrompt = [`Question: ${question}`, `Recent conversation:`, formatHistory(history)].join(
    "\n",
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const built = buildOpenAiJsonRequest({
      model,
      maxOutputTokens: ROUTING_MAX_OUTPUT_TOKENS,
      temperature: 0,
      jsonObject: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const response = await fetchImpl(built.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(built.body),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      const error = `HTTP ${response.status}: ${text.slice(0, 200)}`;
      logBaxterDiagnostic("semanticClassification", {
        code: "SEMANTIC_CLASSIFY_FALLBACK",
        route: "classifyQuestionSemantically",
        safeMessage: error,
      });
      return unavailableResult({ latencyMs: Date.now() - started, model, error });
    }

    let data: Record<string, unknown> | null = null;
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      data = null;
    }
    const content = extractChatContent(data);
    if (!content) {
      const error = "Empty classifier response";
      logBaxterDiagnostic("semanticClassification", {
        code: "SEMANTIC_CLASSIFY_FALLBACK",
        route: "classifyQuestionSemantically",
        safeMessage: error,
      });
      return unavailableResult({ latencyMs: Date.now() - started, model, error });
    }

    const validated = parseSemanticQuestionClassificationJson(content);
    const result: SemanticQuestionClassification = {
      questionType: validated.questionType,
      entityName: validated.entityName ?? null,
      entityTypeGuess: validated.entityTypeGuess ?? null,
      confidence: validated.confidence,
      source: "llm",
      latencyMs: Date.now() - started,
      model,
    };
    logBaxterDiagnostic("semanticClassification", {
      code: "SEMANTIC_CLASSIFY_OK",
      route: "classifyQuestionSemantically",
      safeMessage: JSON.stringify({
        questionType: result.questionType,
        entityTypeGuess: result.entityTypeGuess,
        confidence: result.confidence,
        latencyMs: result.latencyMs,
        model: result.model,
      }),
    });
    return result;
  } catch (err) {
    const aborted =
      (err instanceof Error && err.name === "AbortError") ||
      (typeof err === "object" &&
        err !== null &&
        "name" in err &&
        (err as { name: string }).name === "AbortError");
    const error = aborted
      ? `timeout after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    logBaxterDiagnostic("semanticClassification", {
      code: "SEMANTIC_CLASSIFY_FALLBACK",
      route: "classifyQuestionSemantically",
      safeMessage: error,
    });
    return unavailableResult({ latencyMs: Date.now() - started, model, error });
  } finally {
    clearTimeout(timer);
  }
}
