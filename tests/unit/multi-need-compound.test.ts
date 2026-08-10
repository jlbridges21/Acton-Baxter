/**
 * Compound multi-need questions — budget from PEM + stage from GHL must both answer.
 * Single-need "and" questions must not decompose. Clarifying menu stays intact.
 */
import { describe, expect, it } from "vitest";
import {
  composeMultiNeedAnswer,
  hasMultipleInformationNeeds,
  runEvidenceRegistry,
  shouldOfferEntitySourceMenu,
  type EvidenceSource,
  type SemanticQuestionClassification,
} from "@/lib/baxter-ai/evidence-registry";
import { parseSemanticQuestionClassificationJson } from "@/lib/baxter-ai/schemas";
import type { MultiNeedPartResolution } from "@/lib/baxter-ai/evidence-registry/multi-need";

const DENIS_COMPOUND =
  "What's Denis Kornilov's budget from his PEM, and what stage is he in right now?";

function multiNeedSemantic(): SemanticQuestionClassification {
  return {
    questionType: "entity_lookup",
    entityName: "Denis Kornilov",
    entityTypeGuess: "pem_prospect",
    lookupSpecificity: "specific",
    informationNeeds: [
      {
        partQuestion: "What's Denis Kornilov's budget from his PEM?",
        entityName: "Denis Kornilov",
        sourceHint: "pem",
        lookupSpecificity: "specific",
      },
      {
        partQuestion: "What stage is Denis Kornilov in right now?",
        entityName: "Denis Kornilov",
        sourceHint: "ghl",
        lookupSpecificity: "specific",
      },
    ],
    confidence: 0.92,
    source: "llm",
    latencyMs: 12,
    model: "injected",
  };
}

function singleNeedSemantic(
  overrides?: Partial<SemanticQuestionClassification>,
): SemanticQuestionClassification {
  return {
    questionType: "entity_lookup",
    entityName: "Denis Kornilov",
    entityTypeGuess: "pem_prospect",
    lookupSpecificity: "specific",
    informationNeeds: [],
    confidence: 0.9,
    source: "llm",
    latencyMs: 10,
    model: "injected",
    ...overrides,
  };
}

function mockPemSource(answer: string): EvidenceSource {
  return {
    key: "pem_neat",
    canHandle: () => ({ plausible: true, confidence: 0.95 }),
    resolve: async (input) => ({
      items: [
        {
          number: 1,
          id: "pem-denis",
          title: "Denis Kornilov — PEM NEAT",
          summary: "Budget",
          contentExcerpt: answer,
          category: "PEM NEAT",
          tags: [],
          sourceName: "PEM NEAT",
          sourceUrl: null,
          sourceType: "pem",
          mimeType: null,
          updatedAt: new Date().toISOString(),
          citationLabel: "Denis Kornilov — PEM NEAT",
          relevanceScore: 100,
        },
      ],
      deterministicAnswer: answer.includes("Source:")
        ? answer
        : `${answer}\n\nSource: Denis Kornilov — PEM NEAT`,
      confidence: 0.95,
      diagnostics: { question: input.question },
    }),
  };
}

function mockGhlSource(answer: string | null): EvidenceSource {
  return {
    key: "ghl",
    canHandle: () => ({ plausible: true, confidence: 0.94 }),
    resolve: async (input) => {
      if (!answer) {
        return {
          items: [],
          deterministicAnswer: `I couldn’t find a GHL contact matching Denis Kornilov.`,
          confidence: 0.1,
          softMiss: true,
          diagnostics: { question: input.question },
        };
      }
      return {
        items: [
          {
            number: 1,
            id: "ghl-denis",
            title: "Denis Kornilov — GHL",
            summary: "Stage",
            contentExcerpt: answer,
            category: "GoHighLevel",
            tags: [],
            sourceName: "GoHighLevel",
            sourceUrl: null,
            sourceType: "ghl",
            mimeType: null,
            updatedAt: new Date().toISOString(),
            citationLabel: "Denis Kornilov — GoHighLevel",
            relevanceScore: 100,
          },
        ],
        deterministicAnswer: answer,
        confidence: 0.95,
        diagnostics: { question: input.question },
      };
    },
  };
}

describe("schema: informationNeeds", () => {
  it("parses multi-need classifier JSON", () => {
    const parsed = parseSemanticQuestionClassificationJson(
      JSON.stringify({
        questionType: "entity_lookup",
        entityName: "Denis Kornilov",
        entityTypeGuess: "pem_prospect",
        lookupSpecificity: "specific",
        informationNeeds: [
          {
            partQuestion: "What's Denis Kornilov's budget from his PEM?",
            entityName: "Denis Kornilov",
            sourceHint: "pem",
            lookupSpecificity: "specific",
          },
          {
            partQuestion: "What stage is Denis Kornilov in?",
            entityName: "Denis Kornilov",
            sourceHint: "ghl",
            lookupSpecificity: "specific",
          },
        ],
        confidence: 0.93,
      }),
    );
    expect(parsed.informationNeeds).toHaveLength(2);
    expect(parsed.informationNeeds[0]?.sourceHint).toBe("pem");
    expect(parsed.informationNeeds[1]?.sourceHint).toBe("ghl");
  });

  it("defaults missing informationNeeds to []", () => {
    const parsed = parseSemanticQuestionClassificationJson(
      JSON.stringify({
        questionType: "entity_lookup",
        entityName: "Denis Kornilov",
        entityTypeGuess: "pem_prospect",
        lookupSpecificity: "specific",
        confidence: 0.9,
      }),
    );
    expect(parsed.informationNeeds).toEqual([]);
  });

  it("collapses same-source informationNeeds (budget and funding)", () => {
    const parsed = parseSemanticQuestionClassificationJson(
      JSON.stringify({
        questionType: "entity_lookup",
        entityName: "Denis",
        entityTypeGuess: "pem_prospect",
        lookupSpecificity: "specific",
        informationNeeds: [
          {
            partQuestion: "What's Denis's budget?",
            entityName: "Denis",
            sourceHint: "pem",
            lookupSpecificity: "specific",
          },
          {
            partQuestion: "What's Denis's funding situation?",
            entityName: "Denis",
            sourceHint: "pem",
            lookupSpecificity: "specific",
          },
        ],
        confidence: 0.9,
      }),
    );
    expect(parsed.informationNeeds).toEqual([]);
  });
});

describe("hasMultipleInformationNeeds / clarifying menu gate", () => {
  it("detects multi-need packets", () => {
    expect(hasMultipleInformationNeeds(multiNeedSemantic())).toBe(true);
    expect(hasMultipleInformationNeeds(singleNeedSemantic())).toBe(false);
  });

  it("does not offer clarifying menu for multi-need questions", () => {
    expect(shouldOfferEntitySourceMenu(DENIS_COMPOUND, multiNeedSemantic())).toBe(false);
  });

  it("still offers clarifying menu for open-ended single-need asks", () => {
    const semantic = singleNeedSemantic({
      lookupSpecificity: "generic",
      entityTypeGuess: "unknown",
    });
    expect(shouldOfferEntitySourceMenu("tell me everything about Denis Kornilov", semantic)).toBe(
      true,
    );
  });
});

describe("reported failure: PEM budget + GHL stage", () => {
  it("answers BOTH parts when multi-need decomposition is present", async () => {
    const pem = mockPemSource("Denis Kornilov’s budget is $180,000.");
    const ghl = mockGhlSource(
      "Denis Kornilov’s opportunity is in the Sales pipeline at stage Appointment Set.",
    );
    let pemCalls = 0;
    let ghlCalls = 0;
    const pemWrap: EvidenceSource = {
      ...pem,
      resolve: async (input) => {
        pemCalls += 1;
        return pem.resolve(input);
      },
    };
    const ghlWrap: EvidenceSource = {
      ...ghl,
      resolve: async (input) => {
        ghlCalls += 1;
        return ghl.resolve(input);
      },
    };

    const result = await runEvidenceRegistry({
      question: DENIS_COMPOUND,
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: true,
      semantic: multiNeedSemantic(),
      sources: [pemWrap, ghlWrap],
    });

    expect(result.earlyAnswer?.modelName).toBe("multi-need-compose");
    expect(pemCalls).toBe(1);
    expect(ghlCalls).toBe(1);
    const answer = result.earlyAnswer?.answer ?? "";
    expect(answer).toMatch(/\$180,000|budget/i);
    expect(answer).toMatch(/Appointment Set|pipeline|stage/i);
    expect(answer).toMatch(/PEM NEAT/i);
    expect(answer).toMatch(/GoHighLevel|Sales pipeline|Appointment Set/i);
  });

  it("without multi-need, PEM short-circuit still stops before GHL (regression of prior behavior)", async () => {
    const pem = mockPemSource("Denis Kornilov’s budget is $180,000.");
    let ghlCalls = 0;
    const ghl: EvidenceSource = {
      key: "ghl",
      canHandle: () => ({ plausible: true, confidence: 0.5 }),
      resolve: async () => {
        ghlCalls += 1;
        return {
          items: [],
          deterministicAnswer: "should not run",
          confidence: 0.95,
        };
      },
    };

    const result = await runEvidenceRegistry({
      question: DENIS_COMPOUND,
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: true,
      semantic: singleNeedSemantic({ entityTypeGuess: "pem_prospect" }),
      sources: [pem, ghl],
    });

    expect(result.earlyAnswer?.winningSource).toBe("pem_neat");
    expect(ghlCalls).toBe(0);
    expect(result.earlyAnswer?.answer).toMatch(/budget/i);
    expect(result.earlyAnswer?.answer).not.toMatch(/should not run/);
  });

  it("honest partial when GHL stage is missing", async () => {
    const result = await runEvidenceRegistry({
      question: DENIS_COMPOUND,
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: true,
      semantic: multiNeedSemantic(),
      sources: [mockPemSource("Denis Kornilov’s budget is $180,000."), mockGhlSource(null)],
    });

    const answer = result.earlyAnswer?.answer ?? "";
    expect(answer).toMatch(/\$180,000|budget/i);
    expect(answer).toMatch(/couldn['’]t find/i);
    expect(answer).toMatch(/GoHighLevel|pipeline stage/i);
  });
});

describe("cross-source compound pairs", () => {
  it("PEM + Slack via external resolver", async () => {
    const semantic: SemanticQuestionClassification = {
      ...multiNeedSemantic(),
      informationNeeds: [
        {
          partQuestion: "What's Robert Vertin's budget from his PEM?",
          entityName: "Robert Vertin",
          sourceHint: "pem",
          lookupSpecificity: "specific",
        },
        {
          partQuestion: "What's the latest update in Robert Vertin's Slack project channel?",
          entityName: "Robert Vertin",
          sourceHint: "slack",
          lookupSpecificity: "specific",
        },
      ],
    };

    const result = await runEvidenceRegistry({
      question:
        "What's Robert Vertin's budget from his PEM, and what's the latest update in his Slack project channel?",
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: true,
      semantic,
      sources: [mockPemSource("Robert Vertin’s budget is $250k.")],
      multiNeedResolvers: {
        slack: async () => ({
          answer: "Latest in #l01-vertin: foundation inspection passed.\n\nSource: Slack Search",
        }),
      },
    });

    const answer = result.earlyAnswer?.answer ?? "";
    expect(answer).toMatch(/\$250k|budget/i);
    expect(answer).toMatch(/foundation inspection|Slack/i);
  });

  it("GHL + Slack via external resolver", async () => {
    const semantic: SemanticQuestionClassification = {
      questionType: "entity_lookup",
      entityName: "Katie Liniger",
      entityTypeGuess: "ghl_contact",
      lookupSpecificity: "specific",
      informationNeeds: [
        {
          partQuestion: "What stage is Katie Liniger's opportunity in?",
          entityName: "Katie Liniger",
          sourceHint: "ghl",
          lookupSpecificity: "specific",
        },
        {
          partQuestion: "Any recent Slack activity on Katie Liniger's project?",
          entityName: "Katie Liniger",
          sourceHint: "slack",
          lookupSpecificity: "specific",
        },
      ],
      confidence: 0.91,
      source: "llm",
      latencyMs: 8,
      model: "injected",
    };

    const result = await runEvidenceRegistry({
      question: "What stage is Katie Liniger in, and any recent Slack activity on her project?",
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: true,
      semantic,
      sources: [
        mockGhlSource("Katie Liniger’s opportunity is in the Sales pipeline at stage Proposal."),
      ],
      multiNeedResolvers: {
        slack: async () => ({
          answer: "Recent Slack: design review scheduled Tuesday.\n\nSource: Slack Search",
        }),
      },
    });

    const answer = result.earlyAnswer?.answer ?? "";
    expect(answer).toMatch(/Proposal|pipeline/i);
    expect(answer).toMatch(/design review|Slack/i);
  });

  it("PEM + Knowledge via external resolver", async () => {
    const semantic: SemanticQuestionClassification = {
      questionType: "entity_lookup",
      entityName: "Sharon Liu",
      entityTypeGuess: "pem_prospect",
      lookupSpecificity: "specific",
      informationNeeds: [
        {
          partQuestion: "What is Sharon Liu's Type 1 Pain from her PEM?",
          entityName: "Sharon Liu",
          sourceHint: "pem",
          lookupSpecificity: "specific",
        },
        {
          partQuestion: "What does the Knowledge Base say about handling Type 1 Pain?",
          entityName: null,
          sourceHint: "knowledge",
          lookupSpecificity: "specific",
        },
      ],
      confidence: 0.9,
      source: "llm",
      latencyMs: 9,
      model: "injected",
    };

    const result = await runEvidenceRegistry({
      question:
        "What's Sharon Liu's Type 1 Pain from her PEM, and what does Knowledge say about handling Type 1 Pain?",
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: false,
      semantic,
      sources: [mockPemSource("Sharon Liu’s Type 1 Pain is privacy from neighbors.")],
      multiNeedResolvers: {
        knowledge: async () => ({
          answer:
            "• Type 1 Pain coaching\n  Ask clarifying questions before pitching.\n\nSource: Knowledge Base",
        }),
      },
    });

    const answer = result.earlyAnswer?.answer ?? "";
    expect(answer).toMatch(/privacy|Type 1 Pain/i);
    expect(answer).toMatch(/Knowledge Base|clarifying questions/i);
  });
});

describe("'and' false-decomposition guards", () => {
  it("single-need budget and funding does not take multi-need path", async () => {
    const semantic = singleNeedSemantic({
      entityName: "Denis Kornilov",
      lookupSpecificity: "specific",
      informationNeeds: [],
    });
    expect(hasMultipleInformationNeeds(semantic)).toBe(false);

    let ghlCalls = 0;
    const result = await runEvidenceRegistry({
      question: "what's Denis's budget and funding situation",
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: true,
      semantic,
      sources: [
        mockPemSource("Denis Kornilov’s budget is $180,000."),
        {
          key: "ghl",
          canHandle: () => ({ plausible: true, confidence: 0.4 }),
          resolve: async () => {
            ghlCalls += 1;
            return { items: [], deterministicAnswer: "stage", confidence: 0.95 };
          },
        },
      ],
    });

    expect(result.earlyAnswer?.modelName).not.toBe("multi-need-compose");
    expect(ghlCalls).toBe(0);
  });

  it("Cindy Lee and Razel Talle single project ask is not multi-need", () => {
    const semantic = singleNeedSemantic({
      entityName: "Cindy Lee and Razel Talle",
      entityTypeGuess: "unknown",
      lookupSpecificity: "generic",
      informationNeeds: [],
    });
    expect(hasMultipleInformationNeeds(semantic)).toBe(false);
    expect(
      shouldOfferEntitySourceMenu("tell me about Cindy Lee and Razel Talle's project", semantic),
    ).toBe(true);
  });
});

describe("composeMultiNeedAnswer honesty", () => {
  it("includes explicit miss for unresolved parts", () => {
    const parts: MultiNeedPartResolution[] = [
      {
        need: {
          partQuestion: "budget?",
          entityName: "Denis Kornilov",
          sourceHint: "pem",
          lookupSpecificity: "specific",
        },
        status: "answered",
        answer: "Denis Kornilov’s budget is $180,000.\n\nSource: Denis Kornilov — PEM NEAT",
        items: [],
        sourceKey: "pem_neat",
      },
      {
        need: {
          partQuestion: "What stage is Denis Kornilov in right now?",
          entityName: "Denis Kornilov",
          sourceHint: "ghl",
          lookupSpecificity: "specific",
        },
        status: "unresolved",
        answer: null,
        items: [],
        sourceKey: "none",
      },
    ];
    const composed = composeMultiNeedAnswer(parts);
    expect(composed).toMatch(/\$180,000/);
    expect(composed).toMatch(/couldn['’]t find a current pipeline stage/i);
    expect(composed).toMatch(/GoHighLevel/i);
  });
});
