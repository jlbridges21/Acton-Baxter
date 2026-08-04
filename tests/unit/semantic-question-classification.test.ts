/**
 * Semantic question classification — primary routing into the evidence registry.
 * Regex extraction remains the fallback when classification fails / is skipped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  classifyQuestionSemantically,
  shouldSkipSemanticClassification,
  resolveQuestionEntity,
  runEvidenceRegistry,
} from "@/lib/baxter-ai/evidence-registry";
import { ghlEvidenceSource as ghlSource } from "@/lib/baxter-ai/evidence-registry/sources/ghl";
import { answerCapabilityHelp } from "@/lib/baxter/capability-help";
import type { EvidenceSourceHandleInput } from "@/lib/baxter-ai/evidence-registry/types";
import type { SemanticQuestionClassificationParsed } from "@/lib/baxter-ai/schemas";
import { parseSemanticQuestionClassificationJson } from "@/lib/baxter-ai/schemas";

const INCIDENT =
  "tell the team about how they can use you to create a new project now instead of relying solely on jackson.";

function ghlHandleInput(
  question: string,
  semantic?: Parameters<typeof resolveQuestionEntity>[0]["semantic"],
): EvidenceSourceHandleInput {
  const entity = resolveQuestionEntity({ question, semantic: semantic ?? null });
  return {
    question,
    history: [],
    entity,
    preferredSource: null,
    conversationMetadata: {},
    role: "user",
    channel: "web",
    ghlConfigured: true,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  process.env.BAXTER_CHAT_ENABLED = "true";
  process.env.OPENAI_API_KEY = "test-key-for-routing";
  process.env.BAXTER_ROUTING_MODEL = "gpt-4o-mini";
  process.env.BAXTER_ROUTING_TIMEOUT_MS = "4000";
  resetEnvCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  resetEnvCacheForTests();
});

describe("schema validation", () => {
  it("parses valid classifier JSON", () => {
    const parsed = parseSemanticQuestionClassificationJson(
      JSON.stringify({
        questionType: "capability_howto",
        entityName: null,
        entityTypeGuess: null,
        confidence: 0.94,
      }),
    );
    expect(parsed.questionType).toBe("capability_howto");
    expect(parsed.entityName).toBeNull();
  });

  it("rejects invalid questionType", () => {
    expect(() =>
      parseSemanticQuestionClassificationJson(
        JSON.stringify({ questionType: "not_a_type", confidence: 0.9 }),
      ),
    ).toThrow();
  });
});

describe("fast-path exemptions skip the LLM call", () => {
  it.each(["/clear", "/help", "hi", "thanks", "Who are you?"])(
    "skips semantic classification for %s",
    (q) => {
      expect(shouldSkipSemanticClassification(q)).toBe(true);
    },
  );

  it("does not invoke fetch for /clear or /help", async () => {
    const fetchImpl = vi.fn();
    for (const q of ["/clear", "/help", "hello"]) {
      const result = await classifyQuestionSemantically(
        { question: q },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      );
      expect(result.source).toBe("skipped");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("incident + capability_howto via genuine classification (not word-count heuristic)", () => {
  it("classifies the incident as capability_howto and bypasses GHL", async () => {
    const semantic = await classifyQuestionSemantically(
      { question: INCIDENT },
      {
        classifierImpl: () => ({
          questionType: "capability_howto",
          entityName: null,
          entityTypeGuess: null,
          confidence: 0.96,
        }),
      },
    );
    expect(semantic.questionType).toBe("capability_howto");
    expect(semantic.source).toBe("llm");

    const entity = resolveQuestionEntity({ question: INCIDENT, semantic });
    expect(entity.skipEntityLookup).toBe(true);
    expect(entity.candidates).toHaveLength(0);
    expect(ghlSource.canHandle(ghlHandleInput(INCIDENT, semantic)).plausible).toBe(false);

    const help = answerCapabilityHelp({
      question: INCIDENT,
      role: "user",
      forceCapabilityHowto: true,
    });
    expect(help?.answer).toMatch(/\/new-project|New Project Setup/i);
    expect(help?.answer).not.toMatch(/couldn['’]t find/i);

    const registry = await runEvidenceRegistry({
      question: INCIDENT,
      ghlConfigured: true,
      semantic,
    });
    expect(registry.diagnostics.tried).toHaveLength(0);
    expect(registry.diagnostics.semantic?.skippedEntityLookup).toBe(true);
    expect(registry.earlyAnswer).toBeNull();
  });
});

describe("(a) real GHL entity questions containing common words", () => {
  const cases: Array<{
    question: string;
    entityName: string;
    entityTypeGuess: "ghl_opportunity" | "ghl_contact";
  }> = [
    {
      question: "What's the status of the Liniger project?",
      entityName: "Liniger",
      entityTypeGuess: "ghl_opportunity",
    },
    {
      question: "Who owns the Maple Street ADU opportunity?",
      entityName: "Maple Street ADU",
      entityTypeGuess: "ghl_opportunity",
    },
    // Novel phrasing not discussed in the prompt conversation
    {
      question: "Pull up the Harrington barn conversion project in GHL for me",
      entityName: "Harrington barn conversion",
      entityTypeGuess: "ghl_opportunity",
    },
  ];

  it.each(cases)(
    "routes $question to GHL entity lookup",
    async ({ question, entityName, entityTypeGuess }) => {
      const semantic = await classifyQuestionSemantically(
        { question },
        {
          classifierImpl: () => ({
            questionType: "entity_lookup",
            entityName,
            entityTypeGuess,
            confidence: 0.93,
          }),
        },
      );
      const entity = resolveQuestionEntity({ question, semantic });
      expect(entity.skipEntityLookup).toBe(false);
      expect(entity.extractedName?.toLowerCase()).toContain(
        entityName.toLowerCase().split(" ")[0]!,
      );
      expect(ghlSource.canHandle(ghlHandleInput(question, semantic)).plausible).toBe(true);

      const registry = await runEvidenceRegistry({
        question,
        ghlConfigured: true,
        semantic,
        sources: [
          {
            key: "ghl",
            canHandle: ghlSource.canHandle.bind(ghlSource),
            resolve: async () => ({
              items: [
                {
                  number: 1,
                  id: "ghl-1",
                  title: entityName,
                  summary: "stage: Proposal",
                  contentExcerpt: "stage: Proposal",
                  category: "GoHighLevel",
                  tags: [],
                  sourceName: "GoHighLevel",
                  sourceUrl: null,
                  sourceType: "crm",
                  mimeType: null,
                  updatedAt: new Date().toISOString(),
                  citationLabel: entityName,
                  relevanceScore: 100,
                },
              ],
              deterministicAnswer: `${entityName} is in Proposal.`,
              confidence: 0.95,
            }),
          },
        ],
      });
      expect(registry.earlyAnswer?.winningSource).toBe("ghl");
      expect(registry.diagnostics.tried.some((t) => t.key === "ghl")).toBe(true);
    },
  );
});

describe("(b) procedural / Knowledge questions with common words like project", () => {
  const cases = [
    "what's our process for a project site visit",
    "What is the checklist before we schedule a project kickoff meeting?",
    // Novel phrasing
    "Walk me through Acton's procedure when a project plan gets revised mid-build",
  ];

  it.each(cases)("routes procedural question away from GHL: %s", async (question) => {
    const semantic = await classifyQuestionSemantically(
      { question },
      {
        classifierImpl: () => ({
          questionType: "procedural_knowledge",
          entityName: null,
          entityTypeGuess: null,
          confidence: 0.91,
        }),
      },
    );
    expect(semantic.questionType).toBe("procedural_knowledge");
    const entity = resolveQuestionEntity({ question, semantic });
    expect(entity.skipEntityLookup).toBe(true);
    expect(ghlSource.canHandle(ghlHandleInput(question, semantic)).plausible).toBe(false);

    const registry = await runEvidenceRegistry({
      question,
      ghlConfigured: true,
      semantic,
    });
    expect(registry.diagnostics.tried).toHaveLength(0);
    expect(registry.earlyAnswer).toBeNull();
  });
});

describe("(c) capability / how-to questions about different features", () => {
  const cases = [
    {
      question: "how can the team use you to generate a PEM NEAT?",
      expectMatch: /PEM NEAT/i,
    },
    {
      question: "Show me how to run Property Research from Baxter",
      expectMatch: /Property Research/i,
    },
    // Novel phrasing
    {
      question:
        "Could you brief new hires on spinning up Customer Center lookups instead of hunting contacts manually?",
      expectMatch: /Customer Center|customer/i,
    },
  ];

  it.each(cases)(
    "routes capability how-to away from entity sources: $question",
    async ({ question, expectMatch }) => {
      const semantic = await classifyQuestionSemantically(
        { question },
        {
          classifierImpl: () => ({
            questionType: "capability_howto",
            entityName: null,
            entityTypeGuess: null,
            confidence: 0.94,
          }),
        },
      );
      expect(entitySkip(question, semantic)).toBe(true);
      expect(ghlSource.canHandle(ghlHandleInput(question, semantic)).plausible).toBe(false);

      const help = answerCapabilityHelp({
        question,
        role: "user",
        forceCapabilityHowto: true,
      });
      expect(help).not.toBeNull();
      expect(help!.answer).toMatch(expectMatch);
      expect(help!.answer).not.toMatch(/couldn['’]t find/i);
    },
  );
});

function entitySkip(
  question: string,
  semantic: Awaited<ReturnType<typeof classifyQuestionSemantically>>,
): boolean {
  return resolveQuestionEntity({ question, semantic }).skipEntityLookup;
}

describe("graceful fallback when classification fails", () => {
  it("falls back to regex extraction and still produces an answer path", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("forced classification failure");
    });

    const semantic = await classifyQuestionSemantically(
      { question: "What's the status of the Liniger project?" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(semantic.source).toBe("fallback_unavailable");
    expect(semantic.error).toMatch(/forced classification failure/i);

    // Regex path still extracts Liniger / claims GHL
    const entity = resolveQuestionEntity({
      question: "What's the status of the Liniger project?",
      semantic,
    });
    expect(entity.skipEntityLookup).toBe(false);
    expect(entity.extractedName).toMatch(/Liniger/i);
    expect(
      ghlSource.canHandle(ghlHandleInput("What's the status of the Liniger project?", semantic))
        .plausible,
    ).toBe(true);

    const registry = await runEvidenceRegistry({
      question: "What's the status of the Liniger project?",
      ghlConfigured: true,
      semantic,
      sources: [
        {
          key: "ghl",
          canHandle: () => ({ plausible: true, confidence: 0.85 }),
          resolve: async () => ({
            items: [
              {
                number: 1,
                id: "ghl-liniger",
                title: "Liniger",
                summary: "stage: Active",
                contentExcerpt: "stage: Active",
                category: "GoHighLevel",
                tags: [],
                sourceName: "GoHighLevel",
                sourceUrl: null,
                sourceType: "crm",
                mimeType: null,
                updatedAt: new Date().toISOString(),
                citationLabel: "Liniger",
                relevanceScore: 100,
              },
            ],
            deterministicAnswer: "Liniger is Active.",
            confidence: 0.95,
          }),
        },
      ],
    });
    expect(registry.earlyAnswer?.answer).toMatch(/Liniger/i);
    expect(registry.diagnostics.semantic?.source).toBe("fallback_unavailable");
  });

  it("times out and falls back (worst-case latency bounded by BAXTER_ROUTING_TIMEOUT_MS)", async () => {
    process.env.BAXTER_ROUTING_TIMEOUT_MS = "80";
    resetEnvCacheForTests();

    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const fail = () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        };
        if (init?.signal?.aborted) {
          fail();
          return;
        }
        init?.signal?.addEventListener("abort", fail, { once: true });
      });
    });

    const started = Date.now();
    const semantic = await classifyQuestionSemantically(
      { question: "What's the status of the Liniger project?" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const elapsed = Date.now() - started;

    expect(semantic.source).toBe("fallback_unavailable");
    expect(semantic.error).toMatch(/timeout|abort/i);
    expect(elapsed).toBeLessThan(500);
    expect(semantic.latencyMs).toBeLessThan(500);
  });
});

describe("measured latency (injected classifier with controlled delay)", () => {
  it("reports average and documents timeout worst-case", async () => {
    const delays = [12, 18, 25, 30, 15];
    const latencies: number[] = [];

    for (const delay of delays) {
      const semantic = await classifyQuestionSemantically(
        { question: "What's the status of the Liniger project?" },
        {
          classifierImpl: async () => {
            await new Promise((r) => setTimeout(r, delay));
            return {
              questionType: "entity_lookup",
              entityName: "Liniger",
              entityTypeGuess: "ghl_opportunity",
              confidence: 0.9,
            } satisfies SemanticQuestionClassificationParsed;
          },
        },
      );
      latencies.push(semantic.latencyMs);
    }

    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const worstInjected = Math.max(...latencies);
    expect(avg).toBeGreaterThanOrEqual(10);
    expect(avg).toBeLessThan(200);
    expect(worstInjected).toBeLessThan(200);

    expect(Number(process.env.BAXTER_ROUTING_TIMEOUT_MS)).toBe(4000);

    (globalThis as { __semanticLatencyReport?: unknown }).__semanticLatencyReport = {
      samplesMs: latencies,
      averageMs: Math.round(avg),
      worstInjectedMs: worstInjected,
      configuredTimeoutMs: 4000,
      model: "gpt-4o-mini via BAXTER_ROUTING_MODEL",
    };
  });
});
