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
  type SemanticInformationNeedParsed,
} from "@/lib/baxter-ai/schemas";
import { logBaxterDiagnostic } from "@/lib/baxter-ai/errors";
import type { BaxterHistoryMessage } from "@/lib/baxter-ai/types";

export type SemanticQuestionType = SemanticQuestionClassificationParsed["questionType"];
export type SemanticEntityTypeGuess = NonNullable<
  SemanticQuestionClassificationParsed["entityTypeGuess"]
>;
export type SemanticLookupSpecificity = SemanticQuestionClassificationParsed["lookupSpecificity"];
export type SemanticInformationNeed = SemanticInformationNeedParsed;
export type SemanticPemAggregateQuery = NonNullable<
  SemanticQuestionClassificationParsed["aggregateQuery"]
>;

export type SemanticClassificationSource = "llm" | "skipped" | "fallback_unavailable";

export type SemanticQuestionClassification = {
  questionType: SemanticQuestionType;
  entityName: string | null;
  entityTypeGuess: SemanticEntityTypeGuess | null;
  /** generic = open-ended entity ask; specific = named category; null = unknown/not applicable */
  lookupSpecificity: SemanticLookupSpecificity;
  /** Distinct needs when the question asks 2–3 different things; empty/omitted = single need. */
  informationNeeds?: SemanticInformationNeed[];
  /** Present for pem_aggregate — structured reporting filters (LLM extracts; code queries). */
  aggregateQuery?: SemanticPemAggregateQuery | null;
  confidence: number;
  source: SemanticClassificationSource;
  latencyMs: number;
  model: string | null;
  error?: string;
};

/** Minimum confidence to trust semantic routing over regex. */
export const SEMANTIC_ROUTING_CONFIDENCE_THRESHOLD = 0.7;

const ROUTING_MAX_OUTPUT_TOKENS = 420;

const SYSTEM_PROMPT = `You route Acton ADU employee questions for Baxter. Do NOT answer the question — classify only.

Return JSON with keys: questionType, entityName, entityTypeGuess, lookupSpecificity, informationNeeds, aggregateQuery, confidence.

questionType values:
- pem_aggregate: counts, totals, lists, or breakdowns ACROSS PEM NEAT records (many meetings), not one named prospect's NEAT. Examples: "How many PEMs did Kevin Lee run in August, and how many resulted in a YES?", "which PEMs are still DECISION DATE NOT SECURED?", "how many YES outcomes last month?", "PEM counts by salesperson this year". Set aggregateQuery; leave entityName/entityTypeGuess/lookupSpecificity null and informationNeeds [].
- entity_lookup: asks about a specific named person, CRM contact/opportunity/deal/project, PEM prospect, Slack project/job, or rulebook role/step. Includes "how do I find information about [Name]'s project" and "give me information about the [Name] project" — those are data lookups, NOT capability how-tos. Single-prospect PEM asks ("what is Razel's budget", "find the transcript where…") are entity_lookup, NOT pem_aggregate.
- capability_howto: asks how to use BAXTER ITSELF or one of Baxter's own named tools, with NO specific customer/project/channel name. Requires an explicit reference to Baxter/"you" as the tool, or one of Baxter's tool names (New Project Setup, PEM NEAT, Property Research, Customer Center, Knowledge Center, Process Rulebook, Slack Search, GoHighLevel connector). Examples: "how do we use you to set up a new project", "how can the team use Baxter for PEM NEATs", "show me how to run Property Research".
- procedural_knowledge: asks about company process, procedure, policy, workflow, or site visit steps from Knowledge — not a named CRM/Slack record. ALSO covers external/real-world research procedures phrased as "how do I / where do I": where to find public records, county tract/parcel maps, zoning or WUI (Wildland-Urban Interface) lookups, permit portals, utility contacts. Examples: "how do I find a tract map for a property at 25 N Avalon Dr", "where do I look up WUI?", "how do I check if a property is in a WUI zone?"
- general_conversational: greeting, thanks, chitchat, or general non-Acton writing help ONLY
- ambiguous: cannot tell with confidence

aggregateQuery: ONLY when questionType is pem_aggregate; otherwise null.
  Keys: intent (count|list|breakdown), salespersonName, datePreset, customStart, customEnd, calendarMonth (1-12), calendarYear, outcome, qualification, includeOutcomeBreakdown, highlightOutcomes.
  datePreset: this_week|this_month|last_month|this_year|last_7_days|last_30_days|all_time|custom|null
  For named months ("in August") set calendarMonth (August=8) and calendarYear if stated; leave datePreset null.
  outcome: YES|NO|DECISION_DATE|DECISION_DATE_NOT_SECURED|null
  qualification: STRONGLY_QUALIFIED|QUALIFIED_WITH_RISKS|EARLY_EXPLORATORY|WEAKLY_QUALIFIED|DISQUALIFIED|null
  Compound count+outcome asks ("how many PEMs … and how many were YES") stay ONE pem_aggregate with includeOutcomeBreakdown true and highlightOutcomes ["YES"] — do NOT split into informationNeeds.
  Example: "How many PEMs did Kevin Lee run in August, and how many resulted in a YES?" →
    questionType pem_aggregate, aggregateQuery {intent:"count", salespersonName:"Kevin Lee", calendarMonth:8, calendarYear:null, includeOutcomeBreakdown:true, highlightOutcomes:["YES"], outcome:null, …}
  Example: "which PEMs are still DECISION DATE NOT SECURED" →
    {intent:"list", outcome:"DECISION_DATE_NOT_SECURED", includeOutcomeBreakdown:false, highlightOutcomes:[]}

entityName: only for entity_lookup — the clean core proper-noun identifier only (person name, deal title, #channel slug, job number). Otherwise null.
  Do NOT include generic descriptor/category words that commonly trail or lead a name in natural phrasing: project, opportunity, deal, customer, contact, account, record, file, pipeline, stage.
  Examples: "give me information about the katie liniger project" → entityName "Katie Liniger" (not "katie liniger project"); "Robert Vertin's opportunity" → "Robert Vertin"; "customer Denis Kornilov" → "Denis Kornilov"; "#l01-24027-mcadams" → "l01-24027-mcadams" or the channel as written.
entityTypeGuess: only for entity_lookup — ghl_contact | ghl_opportunity | pem_prospect | rulebook_step_or_role | unknown. Otherwise null.
  Prefer pem_prospect when the question is about a Partnership Evaluation Meeting / PEM / NEAT / salesperson coaching moment with a named homeowner/prospect (even if "PEM" is not spelled out — e.g. disqualifying a prospect by not recommending an ADU).
  When informationNeeds has multiple parts with different sources, set entityTypeGuess / lookupSpecificity from the FIRST need only.

lookupSpecificity: only for entity_lookup — otherwise null.
- generic: open-ended ask that does NOT name a specific information category. Examples: "give me information about the Katie Liniger project", "what can you tell me about Denis Kornilov", "tell me about the Vertin project", "who is X / what do we know about X", "tell me everything about X".
- specific: clearly wants one category of data:
  • PEM / sales intelligence: Type 1/2 Pain, budget, decision process, NEAT summary, reason for building, salesperson notes
  • GHL / CRM: phone, email, address, stage, pipeline, opportunity status, tags, owner
  • Slack: latest update, recent activity, what someone said in a channel, project status from Slack
  Examples: "what's Katie's email", "Denis Type 1 Pain", "latest update in #l01-26019-liniger", "what's the stage of Robert's opportunity"
- content_search: wants a passage/exchange/coaching moment FROM a named prospect's PEM NEAT (transcript or assessment), not a single typed field. Examples: "how I disqualified Sharon Liu by saying I don't recommend an ADU", "what did the advisor say about budget in Robert's PEM", "find where they discussed the timeline in Cindy's meeting", "show how the advisor handled the pricing objection with Jeannie". Prefer content_search over specific when the ask is about what was said/done in the meeting rather than a labeled NEAT field.
- When unsure between generic and specific for entity_lookup, prefer specific only if a concrete category word is clearly the ask; otherwise generic. Prefer content_search when the ask is about an exchange, quote, technique, or "what am I missing" tied to a named PEM prospect.

informationNeeds: ONLY for entity_lookup when the question asks 2–3 DISTINCT information needs (different categories and/or sources). Otherwise [].
  Each item: { partQuestion, entityName, sourceHint, lookupSpecificity }.
  sourceHint: pem | ghl | slack | knowledge | rulebook | unknown
  partQuestion: a short standalone rewrite of ONLY that part.
  Cap at 3 items. Order them as they appear in the question.
  DO decompose when needs are truly different, e.g.:
  • "What's Denis Kornilov's budget from his PEM, and what stage is he in right now?" →
    [{partQuestion:"What's Denis Kornilov's budget from his PEM?", entityName:"Denis Kornilov", sourceHint:"pem", lookupSpecificity:"specific"},
     {partQuestion:"What stage is Denis Kornilov in right now?", entityName:"Denis Kornilov", sourceHint:"ghl", lookupSpecificity:"specific"}]
  • "What's Robert's budget in the PEM and what's the latest update in his Slack project channel?" → pem + slack
  DO NOT decompose (return []) when:
  • Needs share the SAME sourceHint — e.g. "budget and funding" (both pem), "email and phone" (both ghl), "stage and pipeline" (both ghl). Same-source compounds stay as ONE specific need.
  • A single need uses "and" inside one category: "budget and funding", "pain and decision process"
  • Two names share one ask: "tell me about Cindy Lee and Razel Talle's project", "Katie and Denis"
  • Open-ended dumps: "tell me everything about X", "what can you tell me about X" → [] and lookupSpecificity generic
  • One content-search / coaching ask that mentions multiple meeting topics
  • PEM aggregate count+YES compounds (use pem_aggregate + aggregateQuery instead)
  Only return informationNeeds with length ≥ 2 when sourceHints DIFFER (e.g. pem+ghl, pem+slack, ghl+slack, pem+knowledge).

confidence: 0 to 1.

Critical rules:
- A #channel mention or "latest update in #…" is NEVER general_conversational or capability_howto — classify as entity_lookup (entityTypeGuess unknown is fine) or ambiguous. Prefer lookupSpecificity specific when asking for latest/recent channel activity.
- "how do I find/get information about [specific named person/project]" is entity_lookup, not capability_howto — usually lookupSpecificity generic unless a field/category is named.
- A bare "how do I / where do I [accomplish a real-world task]" with no mention of Baxter, no "you" as the tool, and no Baxter tool name is NEVER capability_howto — it is procedural_knowledge.
- Words like project/opportunity/deal/site often appear in how-tos AND in real entity names. Prefer entity_lookup whenever a specific proper name or #channel is present — but strip those generic words from entityName itself.`;

/**
 * Non-entity types that should bypass GHL/PEM/Rulebook entity lookup.
 * Note: general_conversational is intentionally excluded — the classifier sometimes
 * mislabels live Slack/#channel asks as conversational; those must still attempt data sources.
 */
export function isNonEntitySemanticType(type: SemanticQuestionType | null | undefined): boolean {
  return type === "capability_howto" || type === "procedural_knowledge";
}

/** Confident PEM cross-record aggregate / reporting question. */
export function isPemAggregateSemantic(
  semantic: SemanticQuestionClassification | null | undefined,
): boolean {
  return Boolean(
    isSemanticRoutingConfident(semantic) &&
    semantic!.questionType === "pem_aggregate" &&
    semantic!.aggregateQuery,
  );
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
 * True when confident semantic routing found 2–3 distinct information needs.
 * Single-need questions keep informationNeeds empty and must not take this path.
 */
export function hasMultipleInformationNeeds(
  semantic: SemanticQuestionClassification | null | undefined,
): boolean {
  if (!isSemanticRoutingConfident(semantic)) return false;
  if (semantic!.questionType !== "entity_lookup") return false;
  return (semantic!.informationNeeds?.length ?? 0) >= 2;
}

/**
 * True when semantic routing is confident this is an open-ended entity ask
 * (clarifying source menu), not a category-specific direct answer.
 */
export function isGenericEntityLookup(
  semantic: SemanticQuestionClassification | null | undefined,
): boolean {
  if (hasMultipleInformationNeeds(semantic)) return false;
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
  if (isGenericEntityLookup(semantic)) {
    // Semantic already typed the entity as a PEM prospect — go retrieve that NEAT
    // (including content search) instead of asking which system to use.
    if (semantic?.entityTypeGuess === "pem_prospect") return false;
    // Content-search asks about a named prospect's meeting — not an open "info" menu.
    if (semantic?.lookupSpecificity === "content_search") return false;
    return true;
  }
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
    informationNeeds: [],
    aggregateQuery: null,
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
  }) => Promise<Record<string, unknown>> | Record<string, unknown>;
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
      informationNeeds: [],
      aggregateQuery: null,
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
        informationNeeds: validated.informationNeeds ?? [],
        aggregateQuery: validated.aggregateQuery ?? null,
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
      informationNeeds: validated.informationNeeds ?? [],
      aggregateQuery: validated.aggregateQuery ?? null,
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
        informationNeedsCount: result.informationNeeds?.length ?? 0,
        hasAggregateQuery: Boolean(result.aggregateQuery),
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
