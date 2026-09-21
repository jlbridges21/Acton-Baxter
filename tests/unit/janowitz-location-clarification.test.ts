/**
 * Janowitz location + information-menu clarification continuity.
 *
 * Bug 1: "where is the Janowitz project?" must answer address from Master Project Log
 * (specific location need — never the information-category menu).
 * Bug 2: answering the menu with "what the project address is" must carry Janowitz,
 * never search the log for "what the".
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  asksForEntityLocation,
  looksLikeSpecificFieldAsk,
  shouldOfferEntitySourceMenu,
  type SemanticQuestionClassification,
} from "@/lib/baxter-ai/semantic-question-classification";
import { runEvidenceRegistry } from "@/lib/baxter-ai/evidence-registry";
import {
  readPendingClarification,
  resolvePendingClarificationReply,
  shouldAbandonPendingClarification,
  buildInformationCategoryPending,
  detectClarificationCategoryReply,
} from "@/lib/baxter-ai/evidence-registry/pending-clarification";
import { setProjectRegistryLoadDepsForTests } from "@/lib/baxter-ai/evidence-registry/sources/project-registry";
import {
  clearProjectLogCacheForTests,
  detectProjectRegistryQuery,
  type ProjectLogRow,
} from "@/lib/baxter-data/project-registry";
import {
  normalizeEntitySearchName,
  isEntitySearchNameRejected,
} from "@/lib/baxter-ai/entity-name-normalize";
import { resolveQuestionEntity } from "@/lib/baxter-ai/evidence-registry/entity-resolution";
import type { GhlContact } from "@/lib/connectors/ghl/types";
import type { ProjectSetupRun } from "@/lib/project-setup/types";

const Q_WHERE = "where is the Janowitz project?";
const Q_WHERES = "where's the Janowitz project";
const Q_LOCATION = "what's the location of the Janowitz project";
const Q_OPEN = "tell me everything about the Janowitz project";
const Q_FOLLOW_ADDRESS = "what the project address is";

const JANOWITZ_ROW: ProjectLogRow = {
  projectNumber: "L01-26021",
  shortName: "Janowitz",
  salesperson: "Kevin Lee",
  startDate: "8/01/2026",
  customerName: "Linda Janowitz",
  street: "42 Maple Lane",
  city: "Orinda",
  postalCode: "94563",
  jurisdiction: "Orinda",
  rowNumber: 21,
};

function lindaContact(): GhlContact {
  return {
    id: "linda-id",
    name: "Linda Janowitz",
    firstName: "Linda",
    lastName: "Janowitz",
    email: "linda@example.com",
    phone: null,
  } as GhlContact;
}

function janowitzRun(): ProjectSetupRun {
  return {
    id: "run-j",
    status: "complete",
    dryRun: false,
    initiatedBy: null,
    triggerChannel: "web",
    slackInitiatorId: null,
    ghlContactId: "linda-id",
    contactSnapshot: {
      id: "linda-id",
      name: "Linda Janowitz",
      firstName: "Linda",
      lastName: "Janowitz",
      email: "linda@example.com",
      phone: null,
      address: null,
      city: null,
      state: null,
      postalCode: null,
      assignedUserId: null,
      assignedUserName: null,
    },
    salesRep: null,
    projectNumber: "L01-26021",
    projectLastName: "Janowitz",
    folderName: null,
    charterName: null,
    slackChannelName: "l01-26021-janowitz",
    fpPaidDate: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
  };
}

function semantic(
  overrides: Partial<SemanticQuestionClassification> = {},
): SemanticQuestionClassification {
  return {
    questionType: "entity_lookup",
    entityName: "Janowitz",
    entityTypeGuess: "unknown",
    lookupSpecificity: "specific",
    confidence: 0.92,
    source: "llm",
    latencyMs: 1,
    model: "test",
    ...overrides,
  };
}

describe("Janowitz location need — Bug 1", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://example.com";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.E2E_TEST_AUTH_BYPASS = "true";
    resetEnvCacheForTests();
    clearProjectLogCacheForTests();
    setProjectRegistryLoadDepsForTests({
      rowsOverride: [JANOWITZ_ROW],
    });
  });

  afterEach(() => {
    setProjectRegistryLoadDepsForTests(null);
    clearProjectLogCacheForTests();
  });

  it("recognizes location need across paraphrases (semantic, not one phrase)", () => {
    for (const q of [Q_WHERE, Q_WHERES, Q_LOCATION]) {
      expect(asksForEntityLocation(q)).toBe(true);
      expect(looksLikeSpecificFieldAsk(q)).toBe(true);
      expect(
        shouldOfferEntitySourceMenu(
          q,
          semantic({ lookupSpecificity: "generic", entityName: "Janowitz" }),
        ),
      ).toBe(false);
    }
    // Open-ended still menus.
    expect(
      shouldOfferEntitySourceMenu(
        Q_OPEN,
        semantic({ lookupSpecificity: "generic", entityName: "Janowitz" }),
      ),
    ).toBe(true);
  });

  it("maps where-is to Master Project Log address field", () => {
    const query = detectProjectRegistryQuery(Q_WHERE);
    expect(query).toEqual({
      kind: "field_lookup",
      projectQuery: "Janowitz",
      field: "address",
    });
  });

  it("answers address directly — no information menu", async () => {
    const result = await runEvidenceRegistry({
      question: Q_WHERE,
      ghlConfigured: true,
      semantic: semantic({ lookupSpecificity: "generic" }),
      menuProbeDeps: {
        ghlConfigured: () => true,
        searchGhlContacts: async () => [lindaContact()],
        listPemIndex: async () => [
          {
            pemId: "pem-linda",
            prospectName: "Linda Janowitz",
            normalizedName: "linda janowitz",
            baseName: "Linda Janowitz",
          },
        ],
        listSetupRuns: async () => [],
      },
    });

    expect(result.earlyAnswer?.modelName).not.toBe("entity-source-menu");
    expect(result.earlyAnswer?.answer).toMatch(/42 Maple Lane/i);
    expect(result.earlyAnswer?.answer).toMatch(/Orinda/i);
    expect(result.earlyAnswer?.answer).not.toMatch(/What would you like to know/i);
  });
});

describe("information-menu reply continuity — Bug 2", () => {
  const menuProbeDeps = {
    ghlConfigured: () => true,
    searchGhlContacts: async () => [lindaContact()],
    listPemIndex: async () => [
      {
        pemId: "pem-linda",
        prospectName: "Linda Janowitz",
        normalizedName: "linda janowitz",
        baseName: "Linda Janowitz",
      },
    ],
    listSetupRuns: async () => [janowitzRun()],
    getSetupSteps: async () =>
      [
        {
          id: "s1",
          runId: "run-j",
          stepKey: "create_slack_channel",
          orderIndex: 1,
          status: "complete",
          outputJson: { channelId: "C_JAN" },
        },
      ] as never,
  };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://example.com";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.E2E_TEST_AUTH_BYPASS = "true";
    resetEnvCacheForTests();
    clearProjectLogCacheForTests();
    setProjectRegistryLoadDepsForTests({
      rowsOverride: [JANOWITZ_ROW],
    });
  });

  afterEach(() => {
    setProjectRegistryLoadDepsForTests(null);
    clearProjectLogCacheForTests();
  });

  it("stores pending clarification when the information menu is shown", async () => {
    const result = await runEvidenceRegistry({
      question: Q_OPEN,
      ghlConfigured: true,
      semantic: semantic({ lookupSpecificity: "generic" }),
      menuProbeDeps,
      sources: [],
    });

    expect(result.earlyAnswer?.modelName).toBe("entity-source-menu");
    const pending = readPendingClarification(result.conversationMetadata);
    expect(pending?.kind).toBe("information_category");
    expect(pending?.entityLabel).toMatch(/Janowitz/i);
    expect(pending?.categories.length).toBeGreaterThanOrEqual(2);
  });

  it("exact two-turn exchange: menu reply returns Janowitz address", async () => {
    const menuTurn = await runEvidenceRegistry({
      question: Q_OPEN,
      ghlConfigured: true,
      semantic: semantic({ lookupSpecificity: "generic" }),
      menuProbeDeps,
      sources: [],
    });

    expect(menuTurn.earlyAnswer?.modelName).toBe("entity-source-menu");
    const meta = menuTurn.conversationMetadata;
    expect(readPendingClarification(meta)?.kind).toBe("information_category");

    const follow = await runEvidenceRegistry({
      question: Q_FOLLOW_ADDRESS,
      history: [
        { role: "user", content: Q_OPEN },
        { role: "assistant", content: menuTurn.earlyAnswer!.answer },
      ],
      conversationMetadata: meta,
      ghlConfigured: true,
      // Simulate the live failure: classifier extracted "what the"
      semantic: {
        questionType: "entity_lookup",
        entityName: "what the",
        entityTypeGuess: "unknown",
        lookupSpecificity: "specific",
        confidence: 0.9,
        source: "llm",
        latencyMs: 1,
        model: "test",
      },
    });

    expect(follow.earlyAnswer?.answer).toMatch(/42 Maple Lane/i);
    expect(follow.earlyAnswer?.answer).toMatch(/Janowitz/i);
    expect(follow.earlyAnswer?.answer).not.toMatch(/what the/i);
    expect(readPendingClarification(follow.conversationMetadata)).toBeNull();
  });

  it("category replies resolve to the right source family", () => {
    expect(detectClarificationCategoryReply("his PEM")).toBe("pem");
    expect(detectClarificationCategoryReply("contact info")).toBe("ghl");
    expect(detectClarificationCategoryReply("latest in the channel")).toBe("slack");
    expect(detectClarificationCategoryReply(Q_FOLLOW_ADDRESS)).toBe("project_registry");
  });

  it("genuinely unrelated question abandons pending clarification", () => {
    const pending = buildInformationCategoryPending({
      entityName: "Janowitz",
      entityLabel: "Linda Janowitz",
      originalQuestion: Q_OPEN,
      categories: ["pem", "ghl", "slack"],
    });
    expect(
      shouldAbandonPendingClarification({
        question: "how many PEMs did Kevin Lee run in August?",
        history: [
          { role: "user", content: Q_OPEN },
          { role: "assistant", content: "What would you like to know?" },
        ],
        pending,
      }),
    ).toBe(true);

    const resolution = resolvePendingClarificationReply({
      question: "how many PEMs did Kevin Lee run in August?",
      history: [
        { role: "user", content: Q_OPEN },
        { role: "assistant", content: "What would you like to know?" },
      ],
      pending,
    });
    expect(resolution.action).toBe("abandon");
  });
});

describe("normalizeEntitySearchName — interrogative floor", () => {
  it("strips leading interrogative phrasing and rejects stopword-only residue", () => {
    expect(normalizeEntitySearchName("what the")).toBeNull();
    expect(normalizeEntitySearchName("what's the")).toBeNull();
    expect(normalizeEntitySearchName("where is the")).toBeNull();
    expect(isEntitySearchNameRejected("what the")).toBe(true);
    expect(normalizeEntitySearchName("katie liniger project")).toBe("katie liniger");
    expect(normalizeEntitySearchName("what the Janowitz")).toBe("Janowitz");
  });

  it("never searches stopword residue via entity resolution", () => {
    const resolved = resolveQuestionEntity({
      question: Q_FOLLOW_ADDRESS,
      history: [
        { role: "user", content: "where is the Janowitz project?" },
        { role: "assistant", content: "What would you like to know?" },
      ],
      inheritedEntityLabel: "Linda Janowitz",
      semantic: {
        questionType: "entity_lookup",
        entityName: "what the",
        entityTypeGuess: "unknown",
        lookupSpecificity: "specific",
        confidence: 0.95,
        source: "llm",
        latencyMs: 1,
        model: "test",
      },
    });
    expect(resolved.extractedName).toMatch(/Janowitz/i);
    expect(resolved.extractedName?.toLowerCase()).not.toContain("what");
  });
});
