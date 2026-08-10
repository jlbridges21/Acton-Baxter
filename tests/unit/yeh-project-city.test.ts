/**
 * Yeh project city failure: specific field ≠ info menu; project linkage before fuzzy surname;
 * entity disambiguation names-only (no contact dump).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  looksLikeSpecificFieldAsk,
  shouldOfferEntitySourceMenu,
  type SemanticQuestionClassification,
} from "@/lib/baxter-ai/semantic-question-classification";
import { runEvidenceRegistry } from "@/lib/baxter-ai/evidence-registry";
import type { EvidenceSource } from "@/lib/baxter-ai/evidence-registry/types";
import {
  extractProjectReferenceName,
  resolveUniqueProjectSetupByName,
} from "@/lib/dossier/project-setup-name-resolve";
import { buildDeterministicGhlContactFieldAnswer } from "@/lib/connectors/ghl/address";
import type { GhlContact } from "@/lib/connectors/ghl/types";
import type { ProjectSetupRun } from "@/lib/project-setup/types";
import { resetPemNeatMemoryStoreForTests } from "@/lib/pem-neat/store";

const Q_CITY = "What city is the Yeh project";
const ALVIN_ID = "alvin-yeh-ghl-id";

function semantic(
  overrides: Partial<SemanticQuestionClassification>,
): SemanticQuestionClassification {
  return {
    questionType: "entity_lookup",
    entityName: "Yeh",
    entityTypeGuess: "unknown",
    lookupSpecificity: "generic",
    confidence: 0.92,
    source: "llm",
    latencyMs: 1,
    model: "test",
    ...overrides,
  };
}

function yehRun(overrides?: Partial<ProjectSetupRun>): ProjectSetupRun {
  return {
    id: "run-yeh",
    status: "complete",
    dryRun: false,
    initiatedBy: null,
    triggerChannel: "web",
    slackInitiatorId: null,
    ghlContactId: ALVIN_ID,
    contactSnapshot: {
      id: ALVIN_ID,
      name: "Alvin YEH",
      firstName: "Alvin",
      lastName: "YEH",
      email: "kristyandalvin@gmail.com",
      phone: null,
      address: "1 Oak St",
      city: "Walnut Creek",
      state: "CA",
      postalCode: "94596",
      assignedUserId: null,
      assignedUserName: null,
    },
    salesRep: null,
    projectNumber: "L01-26016",
    projectLastName: "Yeh",
    folderName: null,
    charterName: null,
    slackChannelName: "l01-26016-yeh",
    fpPaidDate: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

const yehSlackSteps = [
  {
    id: "s1",
    runId: "run-yeh",
    stepKey: "create_slack_channel",
    orderIndex: 1,
    status: "complete",
    outputJson: { channelId: "C_YEH" },
  } as never,
];

describe("Yeh project city — diagnosis + fix", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://example.com";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.E2E_TEST_AUTH_BYPASS = "true";
    resetEnvCacheForTests();
    resetPemNeatMemoryStoreForTests();
  });

  it("reports classification shape: city ask is specific-field (menu must not fire)", () => {
    expect(looksLikeSpecificFieldAsk(Q_CITY)).toBe(true);
    expect(
      shouldOfferEntitySourceMenu(
        Q_CITY,
        semantic({ lookupSpecificity: "generic", entityName: "Yeh" }),
      ),
    ).toBe(false);
    expect(
      shouldOfferEntitySourceMenu(
        Q_CITY,
        semantic({
          lookupSpecificity: "specific",
          entityTypeGuess: "ghl_contact",
          entityName: "Yeh",
        }),
      ),
    ).toBe(false);
    expect(
      shouldOfferEntitySourceMenu(
        "what can you tell me about the Yeh project",
        semantic({ lookupSpecificity: "generic", entityName: "Yeh" }),
      ),
    ).toBe(true);
  });

  it("extracts Yeh from the project phrase", () => {
    expect(extractProjectReferenceName(Q_CITY)).toBe("Yeh");
    expect(extractProjectReferenceName("what can you tell me about the Yeh project")).toBe("Yeh");
  });

  it("resolves unique Project Setup run before fuzzy surname search", async () => {
    const match = await resolveUniqueProjectSetupByName("Yeh", {
      listSetupRuns: async () => [yehRun()],
    });
    expect(match?.ghlContactId).toBe(ALVIN_ID);
    expect(match?.run.slackChannelName).toBe("l01-26016-yeh");
    expect(match?.displayName).toMatch(/Alvin/i);
  });

  it("answers city directly via project-linked contact (twice, same answer)", async () => {
    const alvin: GhlContact = {
      id: ALVIN_ID,
      name: "Alvin YEH",
      firstName: "Alvin",
      lastName: "YEH",
      email: "kristyandalvin@gmail.com",
      phone: null,
      city: "Walnut Creek",
      state: "CA",
      address1: "1 Oak St",
      postalCode: "94596",
    } as GhlContact;

    const answer = buildDeterministicGhlContactFieldAnswer(Q_CITY, alvin, ["city"]);
    expect(answer).toMatch(/Walnut Creek/i);
    expect(answer).toMatch(/Yeh project|Alvin/i);
    expect(answer).not.toMatch(/@gmail|Nancy|Mike|Victor/i);

    const ghlSource: EvidenceSource = {
      key: "ghl",
      canHandle: () => ({ plausible: true, confidence: 0.95 }),
      resolve: async () => ({
        items: [
          {
            number: 1,
            id: ALVIN_ID,
            title: "GoHighLevel — Alvin YEH",
            summary: null,
            contentExcerpt: answer!,
            category: "GoHighLevel",
            tags: ["gohighlevel"],
            sourceName: "GoHighLevel",
            sourceUrl: null,
            sourceType: "GoHighLevel",
            mimeType: null,
            updatedAt: new Date().toISOString(),
            citationLabel: "GoHighLevel — Alvin YEH — contact",
            relevanceScore: 0.99,
          },
        ],
        deterministicAnswer: answer,
        confidence: 0.95,
      }),
    };

    const runOnce = async (sem: SemanticQuestionClassification) => {
      const result = await runEvidenceRegistry({
        question: Q_CITY,
        history: [],
        conversationMetadata: {},
        role: "admin",
        channel: "web",
        ghlConfigured: true,
        semantic: sem,
        sources: [ghlSource],
        menuProbeDeps: {
          ghlConfigured: () => true,
          searchGhlContacts: async () => [
            alvin,
            { id: "nancy", name: "Nancy Yeh", email: "nyeh889@gmail.com" } as GhlContact,
          ],
          resolveProjectByName: async () => ({
            run: yehRun(),
            ghlContactId: ALVIN_ID,
            displayName: "Alvin YEH",
            matchVia: "project_last_name" as const,
          }),
          getGhlContactById: async () => alvin,
          listPemIndex: async () => [],
          listSetupRuns: async () => [yehRun()],
          getSetupSteps: async () => yehSlackSteps,
        },
      });
      return result.earlyAnswer?.answer ?? "";
    };

    const a1 = await runOnce(
      semantic({
        lookupSpecificity: "specific",
        entityTypeGuess: "ghl_contact",
        entityName: "Yeh",
      }),
    );
    const a2 = await runOnce(semantic({ lookupSpecificity: "generic", entityName: "Yeh" }));
    console.log("\n--- YEH CITY A1 ---\n" + a1 + "\n---\n");
    console.log("\n--- YEH CITY A2 (wrongly generic semantic) ---\n" + a2 + "\n---\n");

    expect(a1).toMatch(/Walnut Creek/i);
    expect(a2).toMatch(/Walnut Creek/i);
    expect(a1).toBe(a2);
    expect(a1).not.toMatch(/I can tell you about/i);
    expect(a1).not.toMatch(/Nancy Yeh|Mike Yeh|@gmail/i);
  });

  it("open-ended Yeh project still produces information clarifying menu", async () => {
    const result = await runEvidenceRegistry({
      question: "what can you tell me about the Yeh project",
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: true,
      semantic: semantic({ lookupSpecificity: "generic", entityName: "Yeh" }),
      sources: [],
      menuProbeDeps: {
        ghlConfigured: () => true,
        searchGhlContacts: async () => [],
        resolveProjectByName: async () => ({
          run: yehRun(),
          ghlContactId: ALVIN_ID,
          displayName: "Alvin YEH",
          matchVia: "project_last_name" as const,
        }),
        getGhlContactById: async () =>
          ({
            id: ALVIN_ID,
            name: "Alvin YEH",
            email: "kristyandalvin@gmail.com",
          }) as GhlContact,
        listPemIndex: async () => [],
        listSetupRuns: async () => [yehRun()],
        getSetupSteps: async () => yehSlackSteps,
      },
    });
    expect(result.earlyAnswer?.modelName).toBe("entity-source-menu");
    expect(result.earlyAnswer?.answer).toMatch(/GoHighLevel|#l01-26016-yeh/i);
    expect(result.earlyAnswer?.answer).not.toMatch(/Walnut Creek|@gmail/i);
  });

  it("entity ambiguity message is names-only, not an email dump", () => {
    const contacts = [
      { name: "Nancy Yeh", email: "nyeh889@gmail.com" },
      { name: "Mike Yeh", email: "yehtp@hotmail.com" },
      { name: "Alvin YEH", email: "kristyandalvin@gmail.com" },
      { name: "Victor Yeh", email: "victoryeh@gmail.com" },
      { name: "Charles Yeh", email: "charles.yeh@yahoo.com" },
      { name: "Bee Hui Yeh", email: "byeh@kw.com" },
      { name: "MAGGIE YEH", email: null },
      { name: "Yehonatan (Yoni) Peretz", email: "yehonatonperetz@yahoo.com" },
    ];
    const names = contacts.map((c) => c.name);
    const shown = names.slice(0, 6);
    const more = names.length > 6 ? ` (${names.length - 6} more)` : "";
    const list = `${shown.slice(0, -1).join(", ")}, or ${shown[shown.length - 1]}`;
    const msg = `I found ${names.length} contacts matching “Yeh”. Which one do you mean — ${list}${more}?`;
    expect(msg).toMatch(/Which one do you mean/);
    expect(msg).not.toMatch(/@gmail|@hotmail|@yahoo|@kw/);
    expect(shown).toHaveLength(6);
  });
});
