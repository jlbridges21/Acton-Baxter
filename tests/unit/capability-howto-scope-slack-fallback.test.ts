/**
 * capability_howto must require an explicit Baxter/tool signal, and procedural
 * "how/where do I …" questions with no Knowledge match must reach workspace-wide
 * Slack search instead of the capability speech.
 *
 * Incident: "How do I find a tract map for a property at 25 N Avalon Dr, Los Altos, 94022"
 * answered with "I can walk the team through how to use Baxter for a specific tool …".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyCapabilityQuestion,
  hasBaxterCapabilitySignal,
  isBaxterCapabilityMetaHowto,
} from "@/lib/baxter/capability-intent";
import { answerCapabilityHelp } from "@/lib/baxter/capability-help";
import {
  detectSlackSearchRole,
  isGeneralProceduralLookupQuestion,
} from "@/lib/baxter-data/slack/when";
import { SLACK_SOURCE_TYPE } from "@/lib/baxter-data/slack/types";
import { slackEvidenceToContextItems } from "@/lib/baxter-data/slack/to-context";
import { formatSlackNoResultsNote } from "@/lib/baxter-data/slack/to-context";
import { formatSlackRetrievalStatusForModel } from "@/lib/baxter-data/slack/retrieval-status";
import type { SlackMessageEvidence, SlackQueryPlan } from "@/lib/baxter-data/slack/types";
import type { SlackRuntimeResult } from "@/lib/baxter-data/slack/orchestrate";

const TRACT_MAP = "How do I find a tract map for a property at 25 N Avalon Dr, Los Altos, 94022";
const WUI_WHERE = "where do I look up WUI?";
const WUI_HOW = "how do I check if a property is in a WUI zone?";
const GENUINE_CAPABILITY = "how do I use you to set up a new project?";
const ENTITY_HOWTO = "how do I find information about Katie Liniger";

const TEST_USER_ID = "00000000-0000-4000-8000-000000000123";

const CAPABILITY_SPEECH = /walk the team through how to use Baxter for a specific tool/i;

describe("capability_howto scoping — requires a Baxter/tool signal", () => {
  it("does not claim the tract-map question", () => {
    expect(hasBaxterCapabilitySignal(TRACT_MAP)).toBe(false);
    expect(isBaxterCapabilityMetaHowto(TRACT_MAP)).toBe(false);
    expect(classifyCapabilityQuestion(TRACT_MAP).kind).toBe("none");
    expect(answerCapabilityHelp({ question: TRACT_MAP, role: "user" })).toBeNull();
    // Even a confident capability_howto classification cannot force the speech.
    expect(
      answerCapabilityHelp({ question: TRACT_MAP, role: "user", forceCapabilityHowto: true }),
    ).toBeNull();
  });

  it.each([WUI_WHERE, WUI_HOW])("does not claim the WUI question: %s", (question) => {
    expect(hasBaxterCapabilitySignal(question)).toBe(false);
    expect(isBaxterCapabilityMetaHowto(question)).toBe(false);
    expect(classifyCapabilityQuestion(question).kind).toBe("none");
    expect(answerCapabilityHelp({ question, role: "user" })).toBeNull();
    expect(answerCapabilityHelp({ question, role: "user", forceCapabilityHowto: true })).toBeNull();
  });

  it("still answers a genuine Baxter how-to with the tool steps (regression)", () => {
    expect(hasBaxterCapabilitySignal(GENUINE_CAPABILITY)).toBe(true);
    expect(isBaxterCapabilityMetaHowto(GENUINE_CAPABILITY)).toBe(true);
    expect(classifyCapabilityQuestion(GENUINE_CAPABILITY).reason).toBe("baxter_meta_howto");
    const help = answerCapabilityHelp({ question: GENUINE_CAPABILITY, role: "user" });
    expect(help?.answer).toMatch(/New Project Setup/);
    expect(help?.answer).toMatch(/\/new-project/);
    expect(help?.answer).not.toMatch(CAPABILITY_SPEECH);
  });

  it("keeps named-tool how-tos without 'you'/'Baxter' (regression)", () => {
    for (const question of [
      "how do I generate a PEM NEAT?",
      "how do I run Property Research?",
      "where do I look someone up in Customer Center?",
    ]) {
      expect(hasBaxterCapabilitySignal(question)).toBe(true);
    }
  });

  it("still keeps the entity-specific how-do-I out of capability help (regression)", () => {
    expect(isBaxterCapabilityMetaHowto(ENTITY_HOWTO)).toBe(false);
    expect(answerCapabilityHelp({ question: ENTITY_HOWTO, role: "user" })).toBeNull();
    expect(
      answerCapabilityHelp({ question: ENTITY_HOWTO, role: "user", forceCapabilityHowto: true }),
    ).toBeNull();
  });
});

describe("workspace-wide Slack fallback detection", () => {
  it("flags procedural asks that detectSlackSearchRole alone skips", () => {
    for (const question of [TRACT_MAP, WUI_WHERE, WUI_HOW]) {
      expect(detectSlackSearchRole({ question })).toBe("skip");
      expect(isGeneralProceduralLookupQuestion(question)).toBe(true);
    }
  });

  it("leaves project-channel and project-status asks to their existing paths", () => {
    for (const question of [
      "what is the latest update in #l01-26019-liniger",
      "how do I find information about the L01-26018 project",
      "give me information about the katie liniger project",
    ]) {
      expect(isGeneralProceduralLookupQuestion(question)).toBe(false);
    }
  });
});

/** Connor Rainey / Aws Jabir WUI exchange in #design. */
function wuiSlackEvidence(): SlackMessageEvidence[] {
  return [
    {
      sourceType: SLACK_SOURCE_TYPE,
      messageTs: "1751000000.000100",
      threadTs: null,
      channelId: "C_DESIGN",
      channelName: "design",
      channelKind: "public_channel",
      authorId: "U_CONNOR",
      authorName: "Connor Rainey",
      timestamp: "2026-06-27T16:00:00.000Z",
      text: "Does anyone know where to look up whether a property is in a WUI zone? The link I had is dead.",
      permalink: "https://acton.slack.com/archives/C_DESIGN/p1751000000000100",
      isThreadReply: false,
      relevance: 0.82,
      contextMessages: [],
      clusterKey: "C_DESIGN:1751000000.000100",
    },
    {
      sourceType: SLACK_SOURCE_TYPE,
      messageTs: "1751000600.000200",
      threadTs: "1751000000.000100",
      channelId: "C_DESIGN",
      channelName: "design",
      channelKind: "public_channel",
      authorId: "U_AWS",
      authorName: "Aws Jabir",
      timestamp: "2026-06-27T16:10:00.000Z",
      text: "They moved it. Use the ArcGIS viewer: https://egis.fire.ca.gov/FHSZ/ — search the address and it shows the WUI/FHSZ designation.",
      permalink: "https://acton.slack.com/archives/C_DESIGN/p1751000600000200",
      isThreadReply: true,
      relevance: 0.95,
      contextMessages: [],
      clusterKey: "C_DESIGN:1751000000.000100",
    },
  ];
}

function wuiPlan(): SlackQueryPlan {
  return {
    intent: "topic_search",
    keywords: ["wui", "zone", "lookup"],
    phrases: [],
    people: [],
    channels: [],
    timeRange: null,
    sort: "relevance",
    limit: 15,
    rationale: "workspace-wide procedural fallback",
  } as unknown as SlackQueryPlan;
}

function slackRuntimeWithResults(): SlackRuntimeResult {
  const selected = wuiSlackEvidence();
  const plan = wuiPlan();
  const retrievalStatus = {
    status: "results_found" as const,
    intent: "topic_search",
    channel: null,
    person: null,
    resultCount: selected.length,
    credentialPath: "user",
    retrievalMethod: "search.messages",
    employeeNote: null,
  };
  return {
    items: slackEvidenceToContextItems(selected, plan, 1),
    selected,
    plan,
    nextConversationState: null,
    authNote: null,
    noResultsNote: null,
    incompleteNote: null,
    retrievalStatus,
    retrievalStatusPrompt: formatSlackRetrievalStatusForModel(retrievalStatus),
    diagnostics: {
      role: "primary",
      ran: true,
      intent: "topic_search",
      resultCount: selected.length,
      selectedCount: selected.length,
      searchCount: 1,
      threadsExpanded: 0,
      incomplete: false,
      incompleteCode: null,
      authorization: "user",
      rateLimited: false,
      durationMs: 12,
      followUpReset: false,
      retrievalStatus: "results_found",
      retrievalMethod: "search.messages",
      notes: [],
    },
  };
}

function slackRuntimeEmpty(question: string): SlackRuntimeResult {
  const retrievalStatus = {
    status: "searched_no_results" as const,
    intent: "topic_search",
    channel: null,
    person: null,
    resultCount: 0,
    credentialPath: "user",
    retrievalMethod: "search.messages",
    employeeNote: formatSlackNoResultsNote(question),
  };
  return {
    items: [],
    selected: [],
    plan: wuiPlan(),
    nextConversationState: null,
    authNote: null,
    noResultsNote: formatSlackNoResultsNote(question),
    incompleteNote: null,
    retrievalStatus,
    retrievalStatusPrompt: formatSlackRetrievalStatusForModel(retrievalStatus),
    diagnostics: {
      role: "primary",
      ran: true,
      intent: "topic_search",
      resultCount: 0,
      selectedCount: 0,
      searchCount: 1,
      threadsExpanded: 0,
      incomplete: false,
      incompleteCode: null,
      authorization: "user",
      rateLimited: false,
      durationMs: 9,
      followUpReset: false,
      retrievalStatus: "searched_no_results",
      retrievalMethod: "search.messages",
      notes: [],
    },
  };
}

const slackCalls: Array<{ question: string; roleOverride?: string }> = [];
let slackResult: (question: string) => SlackRuntimeResult = slackRuntimeEmpty;

vi.mock("@/lib/baxter-data/slack/orchestrate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/baxter-data/slack/orchestrate")>();
  return {
    ...actual,
    retrieveSlackForAnswer: async (input: { question: string; roleOverride?: string }) => {
      slackCalls.push({ question: input.question, roleOverride: input.roleOverride });
      if (input.roleOverride === "skip") return slackRuntimeEmpty(input.question);
      return slackResult(input.question);
    },
  };
});

vi.mock("@/lib/baxter-ai/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/baxter-ai/providers")>();
  return {
    ...actual,
    getBaxterLlmProvider: () => ({
      key: "openai" as const,
      name: "test",
      model: "test",
      generateAnswer: async (input: {
        contextItems: Array<{ number: number; sourceType: string | null; contentExcerpt: string }>;
      }) => {
        const slackItems = input.contextItems.filter((item) => item.sourceType === "slack");
        if (slackItems.length > 0) {
          const arcgis = slackItems
            .map((item) => item.contentExcerpt.match(/https:\/\/egis\.fire\.ca\.gov\/\S+/)?.[0])
            .find(Boolean);
          return {
            answer: `Aws Jabir pointed Connor Rainey to the ArcGIS viewer at ${arcgis} — search the address there to see the WUI/FHSZ designation.`,
            usedSourceNumbers: slackItems.map((item) => item.number),
            confidence: "medium" as const,
            insufficientKnowledge: false,
            answerMode: "grounded" as const,
            modelProvider: "openai" as const,
            modelName: "test",
          };
        }
        return {
          answer: "",
          usedSourceNumbers: [],
          confidence: "low" as const,
          insufficientKnowledge: true,
          answerMode: "general" as const,
          modelProvider: "openai" as const,
          modelName: "test",
        };
      },
    }),
  };
});

describe("end-to-end answers after the fix", () => {
  beforeEach(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://example.com";
    process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.ENABLE_GHL_INTEGRATION = "false";
    process.env.ENABLE_SLACK_SEARCH = "true";
    process.env.BAXTER_CHAT_ENABLED = "true";
    process.env.OPENAI_API_KEY = "";
    const { resetEnvCacheForTests } = await import("@/lib/env");
    const { resetBaxterConversationMemoryForTests } = await import("@/lib/baxter-ai/conversations");
    const { resetKnowledgeMemoryForTests } = await import("@/lib/knowledge/store");
    resetEnvCacheForTests();
    resetBaxterConversationMemoryForTests();
    resetKnowledgeMemoryForTests();
    slackCalls.length = 0;
    slackResult = slackRuntimeEmpty;
  });

  it("WUI question surfaces the Slack exchange, labeled as Slack-sourced", async () => {
    slackResult = () => slackRuntimeWithResults();
    const { answerBaxterQuestion } = await import("@/lib/baxter-ai/answer");

    const result = await answerBaxterQuestion({
      question: WUI_WHERE,
      userId: TEST_USER_ID,
      userName: "Test",
      channel: "web",
      externalThreadId: "wui-1",
    });

    expect(result.answer).not.toMatch(CAPABILITY_SPEECH);
    expect(result.answer).toMatch(/egis\.fire\.ca\.gov/);
    expect(result.answer).toMatch(/Aws Jabir/);
    expect(result.answer).toMatch(/came from a Slack conversation/i);
    expect(result.answer).toMatch(/not official Knowledge Base content/i);
    expect(result.sources.every((source) => source.sourceKind === "slack")).toBe(true);
    // The fallback is what got Slack to run at all.
    expect(slackCalls.at(-1)?.roleOverride).toBe("primary");
  }, 20_000);

  it("WUI paraphrase also reaches workspace-wide Slack search", async () => {
    slackResult = () => slackRuntimeWithResults();
    const { answerBaxterQuestion } = await import("@/lib/baxter-ai/answer");

    const result = await answerBaxterQuestion({
      question: WUI_HOW,
      userId: TEST_USER_ID,
      userName: "Test",
      channel: "web",
      externalThreadId: "wui-2",
    });

    expect(result.answer).not.toMatch(CAPABILITY_SPEECH);
    expect(result.answer).toMatch(/egis\.fire\.ca\.gov/);
    expect(result.answer).toMatch(/came from a Slack conversation/i);
    expect(slackCalls.at(-1)?.roleOverride).toBe("primary");
  }, 20_000);

  it("tract-map question answers honestly instead of the capability speech", async () => {
    const { answerBaxterQuestion } = await import("@/lib/baxter-ai/answer");

    const result = await answerBaxterQuestion({
      question: TRACT_MAP,
      userId: TEST_USER_ID,
      userName: "Test",
      channel: "web",
      externalThreadId: "tract-1",
    });

    expect(result.answer).not.toMatch(CAPABILITY_SPEECH);
    expect(result.answer).not.toMatch(/New Project Setup/);
    expect(result.answer).toMatch(/couldn't find anything covering that/i);
    expect(result.answer).toMatch(/asking in the relevant Slack channel/i);
    expect(result.insufficientKnowledge).toBe(true);
    expect(slackCalls.at(-1)?.roleOverride).toBe("primary");
  }, 20_000);

  it("genuine Baxter how-to still short-circuits to the capability answer", async () => {
    const { answerBaxterQuestion } = await import("@/lib/baxter-ai/answer");

    const result = await answerBaxterQuestion({
      question: GENUINE_CAPABILITY,
      userId: TEST_USER_ID,
      userName: "Test",
      channel: "web",
      externalThreadId: "cap-1",
    });

    expect(result.answer).toMatch(/New Project Setup/);
    expect(result.answer).toMatch(/\/new-project/);
    // Capability short-circuit means Slack search is never attempted.
    expect(slackCalls).toHaveLength(0);
  }, 20_000);
});
