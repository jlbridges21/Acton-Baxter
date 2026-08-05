/**
 * Open-ended entity asks → clarifying source menu (Katie / Denis regressions).
 */
import { describe, expect, it } from "vitest";
import {
  decideEntitySourceClarifyingMenu,
  type EntitySourceAvailability,
} from "@/lib/baxter-ai/evidence-registry/entity-source-menu";
import { runEvidenceRegistry } from "@/lib/baxter-ai/evidence-registry";
import type { SemanticQuestionClassification } from "@/lib/baxter-ai/semantic-question-classification";
import type { ProjectSetupRun } from "@/lib/project-setup/types";
import type { GhlContact } from "@/lib/connectors/ghl/types";

function semanticGeneric(name: string): SemanticQuestionClassification {
  return {
    questionType: "entity_lookup",
    entityName: name,
    entityTypeGuess: "unknown",
    lookupSpecificity: "generic",
    confidence: 0.94,
    source: "llm",
    latencyMs: 1,
    model: "injected",
  };
}

function semanticSpecific(name: string): SemanticQuestionClassification {
  return {
    questionType: "entity_lookup",
    entityName: name,
    entityTypeGuess: "ghl_contact",
    lookupSpecificity: "specific",
    confidence: 0.95,
    source: "llm",
    latencyMs: 1,
    model: "injected",
  };
}

function contact(id: string, name: string): GhlContact {
  return {
    id,
    name,
    firstName: name.split(" ")[0] ?? name,
    lastName: name.split(" ").slice(1).join(" ") || null,
    email: `${id}@example.com`,
    phone: null,
  } as GhlContact;
}

function psRun(
  overrides: Partial<ProjectSetupRun> & { id: string; ghlContactId: string },
): ProjectSetupRun {
  const { id, ghlContactId, ...rest } = overrides;
  return {
    id,
    status: "complete",
    dryRun: false,
    initiatedBy: null,
    triggerChannel: "web",
    slackInitiatorId: null,
    ghlContactId,
    contactSnapshot: {
      id: ghlContactId,
      name: "Test",
      firstName: "Test",
      lastName: "User",
      email: null,
      phone: null,
      address: null,
      city: null,
      state: null,
      postalCode: null,
      assignedUserId: null,
      assignedUserName: null,
    },
    salesRep: null,
    projectNumber: "L01-26019",
    projectLastName: "Liniger",
    folderName: null,
    charterName: null,
    slackChannelName: "l01-26019-liniger",
    fpPaidDate: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...rest,
  };
}

describe("decideEntitySourceClarifyingMenu", () => {
  it("Katie-shaped: GHL + Slack only (no PEM)", () => {
    const availability: EntitySourceAvailability = {
      displayName: "Katie Liniger",
      ghl: { available: true, contactId: "38R58HpyBSvtdnACqOzo", email: "k@x.com" },
      pem: { available: false, pemId: null, prospectName: null },
      slack: {
        available: true,
        channelName: "l01-26019-liniger",
        channelId: "C_LINIGER",
      },
    };
    const decision = decideEntitySourceClarifyingMenu(availability);
    expect(decision.kind).toBe("menu");
    if (decision.kind !== "menu") return;
    expect(decision.answer).toBe(
      "I can tell you about Katie's contact info from GoHighLevel, or the latest updates from #l01-26019-liniger. What would you like to know?",
    );
    expect(decision.answer).not.toMatch(/PEM/i);
  });

  it("Denis-shaped: PEM + GHL + Slack", () => {
    const availability: EntitySourceAvailability = {
      displayName: "Denis Kornilov",
      ghl: { available: true, contactId: "denis-id", email: null },
      pem: { available: true, pemId: "pem-1", prospectName: "Denis Kornilov" },
      slack: {
        available: true,
        channelName: "l01-26018-kornilov",
        channelId: "C_DENIS",
      },
    };
    const decision = decideEntitySourceClarifyingMenu(availability);
    expect(decision.kind).toBe("menu");
    if (decision.kind !== "menu") return;
    expect(decision.answer).toBe(
      "I can tell you about Denis' reason for building an ADU and sales notes (from Denis' PEM NEAT), Denis' contact info from GoHighLevel, or the latest updates from #l01-26018-kornilov. What would you like to know?",
    );
  });

  it("GHL-only → skip menu (answer directly)", () => {
    const decision = decideEntitySourceClarifyingMenu({
      displayName: "Solo Contact",
      ghl: { available: true, contactId: "c1", email: null },
      pem: { available: false, pemId: null, prospectName: null },
      slack: { available: false, channelName: null, channelId: null },
    });
    expect(decision.kind).toBe("skip_single_source");
  });
});

describe("runEvidenceRegistry generic vs specific", () => {
  it("Katie generic question returns clarifying menu (GHL + Slack, no PEM)", async () => {
    const result = await runEvidenceRegistry({
      question: "give me information about the katie liniger project",
      ghlConfigured: true,
      semantic: semanticGeneric("Katie Liniger"),
      menuProbeDeps: {
        ghlConfigured: () => true,
        searchGhlContacts: async () => [contact("38R58HpyBSvtdnACqOzo", "Katie Liniger")],
        listPemIndex: async () => [],
        listSetupRuns: async () => [
          psRun({
            id: "katie-run",
            ghlContactId: "38R58HpyBSvtdnACqOzo",
            slackChannelName: "l01-26019-liniger",
          }),
        ],
        getSetupSteps: async () => [
          {
            id: "s1",
            runId: "katie-run",
            stepKey: "create_slack_channel",
            orderIndex: 1,
            status: "complete",
            outputJson: { channelId: "C_LINIGER" },
          } as never,
        ],
      },
      sources: [], // menu short-circuits before sources
    });

    expect(result.earlyAnswer?.kind).toBe("clarification");
    expect(result.earlyAnswer?.modelName).toBe("entity-source-menu");
    expect(result.earlyAnswer?.answer).toContain("Katie's contact info from GoHighLevel");
    expect(result.earlyAnswer?.answer).toContain("#l01-26019-liniger");
    expect(result.earlyAnswer?.answer).not.toMatch(/PEM/i);
    expect(result.earlyAnswer?.answer).toContain("What would you like to know?");
  });

  it("Denis generic question returns clarifying menu (PEM + GHL + Slack)", async () => {
    const result = await runEvidenceRegistry({
      question: "what can you tell me about the denis kornilov project",
      ghlConfigured: true,
      semantic: semanticGeneric("Denis Kornilov"),
      menuProbeDeps: {
        ghlConfigured: () => true,
        searchGhlContacts: async () => [contact("denis-id", "Denis Kornilov")],
        listPemIndex: async () => [
          {
            pemId: "pem-denis",
            prospectName: "Denis Kornilov",
            normalizedName: "denis kornilov",
            baseName: "Denis Kornilov",
          },
        ],
        listSetupRuns: async () => [
          psRun({
            id: "denis-run",
            ghlContactId: "denis-id",
            projectNumber: "L01-26018",
            projectLastName: "Kornilov",
            slackChannelName: "l01-26018-kornilov",
          }),
        ],
        getSetupSteps: async () => [
          {
            id: "s1",
            runId: "denis-run",
            stepKey: "create_slack_channel",
            orderIndex: 1,
            status: "complete",
            outputJson: { channelId: "C_DENIS" },
          } as never,
        ],
      },
      sources: [],
    });

    expect(result.earlyAnswer?.answer).toContain("PEM NEAT");
    expect(result.earlyAnswer?.answer).toContain("GoHighLevel");
    expect(result.earlyAnswer?.answer).toContain("#l01-26018-kornilov");
  });

  it("specific questions do not take the clarifying-menu short-circuit", async () => {
    let ghlResolved = false;
    const result = await runEvidenceRegistry({
      question: "what is Katie Liniger's email?",
      ghlConfigured: true,
      semantic: semanticSpecific("Katie Liniger"),
      menuProbeDeps: {
        // Would produce a menu if wrongly consulted
        searchGhlContacts: async () => [contact("38R58HpyBSvtdnACqOzo", "Katie Liniger")],
        listPemIndex: async () => [],
        listSetupRuns: async () => [
          psRun({ id: "katie-run", ghlContactId: "38R58HpyBSvtdnACqOzo" }),
        ],
        getSetupSteps: async () =>
          [
            {
              id: "s1",
              runId: "katie-run",
              stepKey: "create_slack_channel",
              orderIndex: 1,
              status: "complete",
              outputJson: { channelId: "C_LINIGER" },
            },
          ] as never,
      },
      sources: [
        {
          key: "ghl",
          canHandle: () => ({ plausible: true, confidence: 0.95 }),
          resolve: async () => {
            ghlResolved = true;
            return {
              items: [],
              deterministicAnswer: "Katie Liniger's email is katie@example.com",
              confidence: 0.95,
            };
          },
        },
      ],
    });

    expect(ghlResolved).toBe(true);
    expect(result.earlyAnswer?.modelName).not.toBe("entity-source-menu");
    expect(result.earlyAnswer?.answer).toContain("katie@example.com");
  });

  it("follow-up after menu keeps entity and answers a specific PEM ask directly", async () => {
    const first = await runEvidenceRegistry({
      question: "what can you tell me about the denis kornilov project",
      ghlConfigured: true,
      semantic: semanticGeneric("Denis Kornilov"),
      menuProbeDeps: {
        ghlConfigured: () => true,
        searchGhlContacts: async () => [contact("denis-id", "Denis Kornilov")],
        listPemIndex: async () => [
          {
            pemId: "pem-denis",
            prospectName: "Denis Kornilov",
            normalizedName: "denis kornilov",
            baseName: "Denis Kornilov",
          },
        ],
        listSetupRuns: async () => [
          psRun({
            id: "denis-run",
            ghlContactId: "denis-id",
            slackChannelName: "l01-26018-kornilov",
          }),
        ],
        getSetupSteps: async () =>
          [
            {
              id: "s1",
              runId: "denis-run",
              stepKey: "create_slack_channel",
              orderIndex: 1,
              status: "complete",
              outputJson: { channelId: "C_DENIS" },
            },
          ] as never,
      },
      sources: [],
    });

    expect(first.earlyAnswer?.modelName).toBe("entity-source-menu");
    const meta = first.conversationMetadata;
    expect((meta.entityArbitration as { label?: string } | undefined)?.label).toMatch(/Denis/i);

    const follow = await runEvidenceRegistry({
      question: "tell me about his PEM",
      history: [
        { role: "user", content: "what can you tell me about the denis kornilov project" },
        { role: "assistant", content: first.earlyAnswer!.answer },
      ],
      conversationMetadata: meta,
      ghlConfigured: true,
      semantic: {
        questionType: "entity_lookup",
        entityName: null, // follow-up — name carried by arbitration / history
        entityTypeGuess: "pem_prospect",
        lookupSpecificity: "specific",
        confidence: 0.93,
        source: "llm",
        latencyMs: 1,
        model: "injected",
      },
      sources: [
        {
          key: "pem_neat",
          canHandle: () => ({ plausible: true, confidence: 0.96 }),
          resolve: async () => ({
            items: [],
            deterministicAnswer: "Denis's Type 1 Pain: wants rental income from the ADU.",
            confidence: 0.95,
          }),
        },
      ],
    });

    expect(follow.earlyAnswer?.modelName).not.toBe("entity-source-menu");
    expect(follow.earlyAnswer?.answer).toContain("Type 1 Pain");
    expect(follow.earlyAnswer?.answer).not.toContain("What would you like to know?");
  });

  it("offers clarifying menu when routing LLM timed out but phrasing is open-ended", async () => {
    const result = await runEvidenceRegistry({
      question: "give me information about the katie liniger project",
      ghlConfigured: true,
      semantic: {
        questionType: "ambiguous",
        entityName: null,
        entityTypeGuess: null,
        lookupSpecificity: null,
        confidence: 0,
        source: "fallback_unavailable",
        latencyMs: 4000,
        model: "gpt-4o-mini",
        error: "timeout after 4000ms",
      },
      menuProbeDeps: {
        ghlConfigured: () => true,
        searchGhlContacts: async () => [contact("38R58HpyBSvtdnACqOzo", "Katie Liniger")],
        listPemIndex: async () => [],
        listSetupRuns: async () => [
          psRun({ id: "katie-run", ghlContactId: "38R58HpyBSvtdnACqOzo" }),
        ],
        getSetupSteps: async () =>
          [
            {
              id: "s1",
              runId: "katie-run",
              stepKey: "create_slack_channel",
              orderIndex: 1,
              status: "complete",
              outputJson: { channelId: "C_LINIGER" },
            },
          ] as never,
      },
      sources: [],
    });

    expect(result.earlyAnswer?.modelName).toBe("entity-source-menu");
    expect(result.earlyAnswer?.answer).toContain("GoHighLevel");
    expect(result.earlyAnswer?.answer).toContain("#l01-26019-liniger");
    expect(result.earlyAnswer?.answer).toContain("What would you like to know?");
  });

  it("Denis menu finds Slack via directory when Project Setup row is missing", async () => {
    const result = await runEvidenceRegistry({
      question: "give me information about the denis kornilov project",
      ghlConfigured: true,
      semantic: semanticGeneric("Denis Kornilov"),
      menuProbeDeps: {
        ghlConfigured: () => true,
        searchGhlContacts: async () => [contact("denis-id", "Denis Kornilov")],
        listPemIndex: async () => [
          {
            pemId: "pem-1",
            prospectName: "Denis Kornilov",
            normalizedName: "denis kornilov",
            baseName: "Denis Kornilov",
          },
        ],
        listSetupRuns: async () => [],
        listCachedChannels: async () => [{ id: "C_KORN", name: "l01-26018-kornilov" }],
        listLiveChannels: async () => [],
      },
      sources: [],
    });

    expect(result.earlyAnswer?.modelName).toBe("entity-source-menu");
    expect(result.earlyAnswer?.answer).toContain("PEM NEAT");
    expect(result.earlyAnswer?.answer).toContain("GoHighLevel");
    expect(result.earlyAnswer?.answer).toContain("#l01-26018-kornilov");
  });
});
