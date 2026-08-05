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
export type SemanticLookupSpecificity = SemanticQuestionClassificationParsed["lookupSpecificity"];

export type SemanticClassificationSource = "llm" | "skipped" | "fallback_unavailable";

export type SemanticQuestionClassification = {
  questionType: SemanticQuestionType;
  entityName: string | null;
  entityTypeGuess: SemanticEntityTypeGuess | null;
  /** generic = open-ended entity ask; specific = named category; null = unknown/not applicable */
  lookupSpecificity: SemanticLookupSpecificity;
  confidence: number;
  source: SemanticClassificationSource;
  latencyMs: number;
  model: string | null;
  error?: string;
};

/** Minimum confidence to trust semantic routing over regex. */
export const SEMANTIC_ROUTING_CONFIDENCE_THRESHOLD = 0.7;

const ROUTING_MAX_OUTPUT_TOKENS = 220;

const SYSTEM_PROMPT = `You route Acton ADU employee questions for Baxter. Do NOT answer the question — classify only.

Return JSON with keys: questionType, entityName, entityTypeGuess, lookupSpecificity, confidence.

questionType values:
- entity_lookup: asks about a specific named person, CRM contact/opportunity/deal/project, PEM prospect, Slack project/job, or rulebook role/step. Includes "how do I find information about [Name]'s project" and "give me information about the [Name] project" — those are data lookups, NOT capability how-tos.
- capability_howto: asks how to use Baxter or its tools themselves (e.g. "how do we use you to set up a new project", "how can the team use Baxter for PEM NEATs") with NO specific customer/project/channel name
- procedural_knowledge: asks about company process, procedure, policy, workflow, or site visit steps from Knowledge — not a named CRM/Slack record
- general_conversational: greeting, thanks, chitchat, or general non-Acton writing help ONLY
- ambiguous: cannot tell with confidence

entityName: only for entity_lookup — the clean core proper-noun identifier only (person name, deal title, #channel slug, job number). Otherwise null.
  Do NOT include generic descriptor/category words that commonly trail or lead a name in natural phrasing: project, opportunity, deal, customer, contact, account, record, file, pipeline, stage.
  Examples: "give me information about the katie liniger project" → entityName "Katie Liniger" (not "katie liniger project"); "Robert Vertin's opportunity" → "Robert Vertin"; "customer Denis Kornilov" → "Denis Kornilov"; "#l01-24027-mcadams" → "l01-24027-mcadams" or the channel as written.
entityTypeGuess: only for entity_lookup — ghl_contact | ghl_opportunity | pem_prospect | rulebook_step_or_role | unknown. Otherwise null.

lookupSpecificity: only for entity_lookup — otherwise null.
- generic: open-ended ask that does NOT name a specific information category. Examples: "give me information about the Katie Liniger project", "what can you tell me about Denis Kornilov", "tell me about the Vertin project", "who is X / what do we know about X".
- specific: clearly wants one category of data:
  • PEM / sales intelligence: Type 1/2 Pain, budget, decision process, NEAT summary, reason for building, salesperson notes
  • GHL / CRM: phone, email, address, stage, pipeline, opportunity status, tags, owner
  • Slack: latest update, recent activity, what someone said in a channel, project status from Slack
  Examples: "what's Katie's email", "Denis Type 1 Pain", "latest update in #l01-26019-liniger", "what's the stage of Robert's opportunity"
- When unsure between generic and specific for entity_lookup, prefer specific only if a concrete category word is clearly the ask; otherwise generic.

confidence: 0 to 1.

Critical rules:
- A #channel mention or "latest update in #…" is NEVER general_conversational or capability_howto — classify as entity_lookup (entityTypeGuess unknown is fine) or ambiguous. Prefer lookupSpecificity specific when asking for latest/recent channel activity.
- "how do I find/get information about [specific named person/project]" is entity_lookup, not capability_howto — usually lookupSpecificity generic unless a field/category is named.
- Words like project/opportunity/deal/site often appear in how-tos AND in real entity names. Prefer entity_lookup whenever a specific proper name or #channel is present — but strip those generic words from entityName itself.`;

/**
 * Non-entity types that should bypass GHL/PEM/Rulebook entity lookup.
 * Note: general_conversational is intentionally excluded — the classifier sometimes
 * mislabels live Slack/#channel asks as conversational; those must still attempt data sources.
 */
export function isNonEntitySemanticType(type: SemanticQuestionType | null | undefined): boolean {
  return type === "capability_howto" || type === "procedural_knowledge";
}

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

/**
 * True when semantic routing is confident this is an open-ended entity ask
 * (clarifying source menu), not a category-specific direct answer.
 */
export function isGenericEntityLookup(
  semantic: SemanticQuestionClassification | null | undefined,
): boolean {
  return Boolean(
    isSemanticRoutingConfident(semantic) &&
    semantic!.questionType === "entity_lookup" &&
    semantic!.lookupSpecificity === "generic",
  );
}

/**
 * Deterministic open-ended entity-info phrasing used when the routing LLM
 * times out / fails — so we still offer the clarifying menu instead of dumping
 * a single source.
 */
export function looksLikeOpenEndedEntityInfoAsk(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  // Baxter identity / meta — never an entity source menu.
  if (/^(who|what)\s+(are|is)\s+(you|baxter)\b/i.test(q)) return false;
  if (/\bwhat can you (do|help)\b/i.test(q) && q.length < 80) return false;
  // Named field / category → specific, not menu.
  if (
    /\b(e-?mail|phone|address|city|zip|postal|stage|pipeline|tag|type\s*1\s*pain|pain\s*points?|latest\s+update|recent\s+activity)\b/i.test(
      q,
    ) &&
    !/\b(information|info|details)\b/i.test(q)
  ) {
    return false;
  }
  if (/#[a-z0-9_-]+/i.test(q) && /\b(latest|recent|update|activity|said|message)\b/i.test(q)) {
    return false;
  }
  return (
    /\b(give|get|show|tell)\s+(me\s+)?(more\s+)?(information|info|details)\b/i.test(q) ||
    /\b(information|info|details)\s+(about|on|for)\b/i.test(q) ||
    /\b(tell me about|what can you tell me about|what do (?:we|you) know about)\b/i.test(q) ||
    // "who is X" for a named person/project — not Baxter itself (handled above).
    (/\bwho is\b/i.test(q) && !/\bwho is baxter\b/i.test(q)) ||
    /\b(full picture|everything (?:about|on))\b/i.test(q)
  );
}

/**
 * Menu gate: confident LLM "generic", or routing unavailable + deterministic
 * open-ended phrasing. Never overrides a confident "specific" / non-entity type.
 * Never treats intentional skips (greetings / Baxter identity) as menu-eligible.
 */
export function shouldOfferEntitySourceMenu(
  question: string,
  semantic: SemanticQuestionClassification | null | undefined,
): boolean {
  if (isGenericEntityLookup(semantic)) return true;
  if (isSemanticRoutingConfident(semantic)) {
    // Confident specific / non-entity → do not second-guess.
    return false;
  }
  // Timeout / missing key / parse failure → deterministic fallback.
  // Do NOT use source "skipped" — those are intentional non-routing questions.
  if (semantic?.source === "fallback_unavailable" && looksLikeOpenEndedEntityInfoAsk(question)) {
    return true;
  }
  return false;
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
    lookupSpecificity: null,
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
      lookupSpecificity: null,
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
        lookupSpecificity: validated.lookupSpecificity ?? null,
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
      lookupSpecificity: validated.lookupSpecificity ?? null,
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
        lookupSpecificity: result.lookupSpecificity,
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
