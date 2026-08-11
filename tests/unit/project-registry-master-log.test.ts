/**
 * Master Project Log registry — Yeh city + filters/counts + Alvin bridge.
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { runEvidenceRegistry } from "@/lib/baxter-ai/evidence-registry";
import {
  setProjectRegistryLoadDepsForTests,
  resolveCustomerNameFromProjectRegistry,
} from "@/lib/baxter-ai/evidence-registry/sources/project-registry";
import {
  clearProjectLogCacheForTests,
  detectProjectRegistryQuery,
  formatProjectRegistryAnswer,
  lookupProjectRow,
  parseMasterProjectLogGrid,
  type ProjectLogRow,
} from "@/lib/baxter-data/project-registry";
import { shouldOfferEntitySourceMenu } from "@/lib/baxter-ai/semantic-question-classification";
import type { SemanticQuestionClassification } from "@/lib/baxter-ai/semantic-question-classification";
import type { EvidenceSource } from "@/lib/baxter-ai/evidence-registry/types";

const Q_CITY = "What city is the Yeh project";

const FIXTURE_ROWS: ProjectLogRow[] = [
  {
    projectNumber: "L01-26016",
    shortName: "Yeh",
    salesperson: "Jesse Soares",
    startDate: "6/15/2026",
    customerName: "Alvin Yeh",
    street: "2212 Culver Creek",
    city: "Walnut Creek",
    postalCode: "94598",
    jurisdiction: "Walnut Creek",
    rowNumber: 12,
  },
  {
    projectNumber: "L01-26018",
    shortName: "Kornilov",
    salesperson: "Kevin Lee",
    startDate: "7/01/2026",
    customerName: "Denis Kornilov",
    street: "10 Oak",
    city: "Lafayette",
    postalCode: "94549",
    jurisdiction: "Lafayette",
    rowNumber: 14,
  },
  {
    projectNumber: "L01-26019",
    shortName: "Liniger",
    salesperson: "Kevin Lee",
    startDate: "7/10/2026",
    customerName: "Katie Liniger",
    street: "1 Main",
    city: "Austin",
    postalCode: "78701",
    jurisdiction: "Austin",
    rowNumber: 15,
  },
  {
    projectNumber: "L01-25001",
    shortName: "Chen",
    salesperson: "Jesse Soares",
    startDate: "3/01/2026",
    customerName: "Amy Chen",
    street: "9 Park",
    city: "San Jose",
    postalCode: "95112",
    jurisdiction: "San Jose",
    rowNumber: 8,
  },
  {
    projectNumber: "L01-25002",
    shortName: "Park",
    salesperson: "Jesse Soares",
    startDate: "4/12/2026",
    customerName: "Sam Park",
    street: "2 First",
    city: "San Jose",
    postalCode: "95113",
    jurisdiction: "San Jose",
    rowNumber: 9,
  },
];

function semantic(
  overrides: Partial<SemanticQuestionClassification> = {},
): SemanticQuestionClassification {
  return {
    questionType: "entity_lookup",
    entityName: "Yeh",
    entityTypeGuess: "unknown",
    lookupSpecificity: "specific",
    confidence: 0.92,
    source: "llm",
    latencyMs: 1,
    model: "test",
    ...overrides,
  };
}

describe("Master Project Log registry", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://example.com";
    process.env.E2E_TEST_AUTH_BYPASS = "true";
    resetEnvCacheForTests();
    clearProjectLogCacheForTests();
    setProjectRegistryLoadDepsForTests({ rowsOverride: FIXTURE_ROWS });
  });

  afterEach(() => {
    setProjectRegistryLoadDepsForTests(null);
    clearProjectLogCacheForTests();
  });

  it("parses Project Setup column order from a headered grid", () => {
    const grid = [
      [
        "Project Number",
        "Short Name",
        "Salesperson",
        "Date",
        "Customer Name",
        "Street Address",
        "City",
        "ZIP",
        "Jurisdiction",
      ],
      [
        "L01-26016",
        "Yeh",
        "Jesse Soares",
        "6/15/2026",
        "Alvin Yeh",
        "2212 Culver Creek",
        "Walnut Creek",
        "94598",
        "Walnut Creek",
      ],
    ];
    const rows = parseMasterProjectLogGrid(grid);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.city).toBe("Walnut Creek");
    expect(rows[0]?.customerName).toBe("Alvin Yeh");
  });

  it("resolves Yeh uniquely to Alvin / L01-26016", () => {
    const hit = lookupProjectRow(FIXTURE_ROWS, "Yeh");
    expect(hit.kind).toBe("unique");
    if (hit.kind === "unique") {
      expect(hit.row.customerName).toBe("Alvin Yeh");
      expect(hit.row.projectNumber).toBe("L01-26016");
      expect(hit.row.city).toBe("Walnut Creek");
    }
  });

  it("answers city for Yeh twice identically (no menu / dump)", async () => {
    expect(shouldOfferEntitySourceMenu(Q_CITY, semantic({ lookupSpecificity: "generic" }))).toBe(
      false,
    );

    const runOnce = async (sem: SemanticQuestionClassification) => {
      const result = await runEvidenceRegistry({
        question: Q_CITY,
        history: [],
        conversationMetadata: {},
        role: "admin",
        channel: "web",
        ghlConfigured: true,
        semantic: sem,
        // Default sources include project_registry
      });
      return result.earlyAnswer?.answer ?? "";
    };

    const a1 = await runOnce(semantic({ lookupSpecificity: "specific" }));
    const a2 = await runOnce(semantic({ lookupSpecificity: "generic" }));
    console.log("\n--- YEH CITY ---\n" + a1 + "\n---\n");

    expect(a1).toMatch(/Walnut Creek/i);
    expect(a1).toMatch(/L01-26016/);
    expect(a1).toMatch(/Master Project Log/i);
    expect(a1).not.toMatch(/I can tell you about|@gmail|Nancy Yeh|Which one do you mean/i);
    expect(a1).toBe(a2);
    expect(detectProjectRegistryQuery(Q_CITY)).toMatchObject({
      kind: "field_lookup",
      field: "city",
      projectQuery: "Yeh",
    });
  });

  it("answers address, jurisdiction, salesperson, and project number", () => {
    const cases: Array<[string, RegExp]> = [
      ["What is the address of the Yeh project?", /2212 Culver Creek|Walnut Creek/],
      ["What jurisdiction is the Yeh project?", /Walnut Creek/],
      ["Who is the salesperson on the Yeh project?", /Jesse Soares/],
      ["What is the project number for Alvin Yeh?", /L01-26016/],
    ];
    for (const [q, re] of cases) {
      const query = detectProjectRegistryQuery(q);
      expect(query, q).toBeTruthy();
      const formatted = formatProjectRegistryAnswer({
        query: query!,
        rows: FIXTURE_ROWS,
        tabName: "Master Project Log",
      });
      console.log(`\n--- ${q} ---\n${formatted.answer}\n---\n`);
      expect(formatted.answer, q).toMatch(re);
      expect(formatted.answer, q).toMatch(/Master Project Log/i);
    }
  });

  it("filters San Jose projects and counts Jesse 2026 starts", () => {
    const filterQ = detectProjectRegistryQuery("which projects are in San Jose");
    expect(filterQ?.kind).toBe("filter_city");
    const filterAnswer = formatProjectRegistryAnswer({
      query: filterQ!,
      rows: FIXTURE_ROWS,
      tabName: "Master Project Log",
    });
    expect(filterAnswer.answer).toMatch(/L01-25001/);
    expect(filterAnswer.answer).toMatch(/L01-25002/);
    expect(filterAnswer.answer).not.toMatch(/Yeh|L01-26016/);

    const countQ = detectProjectRegistryQuery("How many projects did Jesse Soares start in 2026?");
    // salesperson extraction may be partial — at least count+year works
    expect(countQ?.kind).toBe("count");
    const countAnswer = formatProjectRegistryAnswer({
      query: {
        kind: "count",
        salesperson: "Jesse Soares",
        year: 2026,
        city: null,
      },
      rows: FIXTURE_ROWS,
      tabName: "Master Project Log",
    });
    // Yeh + Chen + Park = 3
    expect(countAnswer.answer).toMatch(/\b3\b/);
  });

  it("honest miss for absent project", () => {
    const formatted = formatProjectRegistryAnswer({
      query: { kind: "field_lookup", projectQuery: "Zzznobody", field: "city" },
      rows: FIXTURE_ROWS,
      tabName: "Master Project Log",
    });
    expect(formatted.answer).toMatch(/couldn['’]t find/i);
    expect(formatted.answer).toMatch(/Master Project Log/i);
    expect(formatted.softMiss).toBe(true);
  });

  it("bridges Yeh → Alvin Yeh for GHL identity", async () => {
    const bridged = await resolveCustomerNameFromProjectRegistry(Q_CITY);
    expect(bridged?.customerName).toBe("Alvin Yeh");
    expect(bridged?.projectNumber).toBe("L01-26016");
    expect(bridged?.city).toBe("Walnut Creek");
  });

  it("Project Setup runs still resolve Kornilov / Liniger linkage", async () => {
    const { resolveUniqueProjectSetupByName } =
      await import("@/lib/dossier/project-setup-name-resolve");
    const kornilov = await resolveUniqueProjectSetupByName("Kornilov", {
      listSetupRuns: async () => [
        {
          id: "run-k",
          status: "complete",
          dryRun: false,
          initiatedBy: null,
          triggerChannel: "web",
          slackInitiatorId: null,
          ghlContactId: "denis-ghl",
          contactSnapshot: { id: "denis-ghl", name: "Denis Kornilov" },
          salesRep: null,
          projectNumber: "L01-26018",
          projectLastName: "Kornilov",
          folderName: "L01-26018 Kornilov",
          charterName: "Charter",
          slackChannelName: "l01-26018-kornilov",
          fpPaidDate: null,
          error: null,
          startedAt: null,
          finishedAt: null,
          createdAt: "2026-07-01T12:00:00.000Z",
          updatedAt: "2026-07-01T12:00:00.000Z",
        } as never,
      ],
    });
    expect(kornilov?.ghlContactId).toBe("denis-ghl");
    expect(kornilov?.run.slackChannelName).toBe("l01-26018-kornilov");
    expect(kornilov?.run.projectNumber).toBe("L01-26018");

    const registryHit = lookupProjectRow(FIXTURE_ROWS, "Kornilov");
    expect(registryHit.kind).toBe("unique");
    if (registryHit.kind === "unique") {
      expect(registryHit.row.customerName).toBe("Denis Kornilov");
      expect(registryHit.row.projectNumber).toBe("L01-26018");
    }
  });

  it("open-ended Yeh project still offers clarifying menu (not a registry dump)", async () => {
    const ghlStub: EvidenceSource = {
      key: "ghl",
      canHandle: () => ({ plausible: true, confidence: 0.5 }),
      resolve: async () => null,
    };
    const result = await runEvidenceRegistry({
      question: "what can you tell me about the Yeh project",
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: true,
      semantic: semantic({ lookupSpecificity: "generic" }),
      sources: [ghlStub],
      menuProbeDeps: {
        ghlConfigured: () => true,
        searchGhlContacts: async () => [
          {
            id: "alvin",
            name: "Alvin Yeh",
            email: "kristyandalvin@gmail.com",
            firstName: "Alvin",
            lastName: "Yeh",
          } as never,
        ],
        listPemIndex: async () => [],
        listSetupRuns: async () => [],
        resolveProjectByName: async () => null,
      },
    });
    expect(
      shouldOfferEntitySourceMenu(
        "what can you tell me about the Yeh project",
        semantic({ lookupSpecificity: "generic" }),
      ),
    ).toBe(true);
    const answer = result.earlyAnswer?.answer ?? "";
    expect(answer).not.toMatch(/Nancy Yeh|Mike Yeh|@hotmail/);
  });
});
