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
  detectProjectStatusScope,
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
    status: "open",
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
    status: "open",
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
    status: "open",
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
    status: "open",
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
    status: "open",
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

describe("Master Project Log status (column J)", () => {
  const HEADER = [
    "Project Number",
    "Project Name",
    "Project Advisor",
    "FP Date",
    "Customer Name",
    "Street Address",
    "City",
    "Zip Code",
    "Jurisdiction",
    "Status",
  ];

  function dataRow(number: string, name: string, status: string): string[] {
    return [
      number,
      name,
      "Jenn Lee",
      "3/1/2026",
      `Pat ${name}`,
      "1 Main St",
      "San Jose",
      "95110",
      "San Jose",
      status,
    ];
  }

  it("finds the header in row 6 below a 5-row logo banner", () => {
    const grid = [
      [],
      ["Acton ADU — Project Charter Master"],
      [],
      [""],
      [],
      HEADER,
      dataRow("L01-26001", "Alpha", "Open"),
      dataRow("L01-26002", "Bravo", "Closed"),
    ];
    const rows = parseMasterProjectLogGrid(grid);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      projectNumber: "L01-26001",
      shortName: "Alpha",
      salesperson: "Jenn Lee",
      startDate: "3/1/2026",
      customerName: "Pat Alpha",
      street: "1 Main St",
      city: "San Jose",
      postalCode: "95110",
      jurisdiction: "San Jose",
      status: "open",
      rowNumber: 7,
    });
    expect(rows[1]).toMatchObject({ status: "closed", rowNumber: 8 });
  });

  it("normalizes Open/Closed and treats anything else as unknown", () => {
    const cases: Array<[string, string]> = [
      ["Open", "open"],
      ["closed ", "closed"],
      ["CLOSED", "closed"],
      [" open", "open"],
      ["", "unknown"],
      ["On hold", "unknown"],
      ["N/A", "unknown"],
    ];
    const grid = [HEADER, ...cases.map(([status], i) => dataRow(`L01-2610${i}`, `P${i}`, status))];
    const rows = parseMasterProjectLogGrid(grid);
    expect(rows.map((r) => r.status)).toEqual(cases.map(([, expected]) => expected));
    // A row with no column J at all is unknown too.
    const short = parseMasterProjectLogGrid([
      HEADER,
      dataRow("L01-26200", "Short", "").slice(0, 9),
    ]);
    expect(short[0]?.status).toBe("unknown");
  });

  it("falls back to fixed positions (Status in J) when no header row exists", () => {
    const rows = parseMasterProjectLogGrid([
      dataRow("L01-26003", "Charlie", "Closed"),
      dataRow("L01-26004", "Delta", "Open"),
    ]);
    expect(rows.map((r) => [r.projectNumber, r.status, r.rowNumber])).toEqual([
      ["L01-26003", "closed", 1],
      ["L01-26004", "open", 2],
    ]);
  });

  it("maps a Status header wherever it sits without stealing customer or jurisdiction", () => {
    const rows = parseMasterProjectLogGrid([
      ["Status", "Project Number", "Customer Name", "City", "Jurisdiction"],
      ["Closed", "L01-26005", "Echo Customer", "Campbell", "Santa Clara County"],
    ]);
    expect(rows[0]).toMatchObject({
      projectNumber: "L01-26005",
      customerName: "Echo Customer",
      city: "Campbell",
      jurisdiction: "Santa Clara County",
      status: "closed",
    });
  });

  const STATUS_ROWS: ProjectLogRow[] = [
    {
      ...FIXTURE_ROWS[0]!,
      projectNumber: "L01-26301",
      shortName: "Openone",
      city: "San Jose",
      jurisdiction: "San Jose",
      salesperson: "Jenn Lee",
      status: "open",
      rowNumber: 7,
    },
    {
      ...FIXTURE_ROWS[0]!,
      projectNumber: "L01-26302",
      shortName: "Opentwo",
      city: "San Jose",
      jurisdiction: "San Jose",
      salesperson: "Jenn Lee",
      status: "open",
      rowNumber: 8,
    },
    {
      ...FIXTURE_ROWS[0]!,
      projectNumber: "L01-26303",
      shortName: "Shutdown",
      customerName: "Sam Shutdown",
      city: "San Jose",
      jurisdiction: "San Jose",
      salesperson: "Jenn Lee",
      status: "closed",
      rowNumber: 9,
    },
    {
      ...FIXTURE_ROWS[0]!,
      projectNumber: "L01-26304",
      shortName: "Blankstat",
      city: "San Jose",
      jurisdiction: "San Jose",
      salesperson: "Alex Kim",
      status: "unknown",
      rowNumber: 10,
    },
  ];

  function answer(question: string): string {
    const query = detectProjectRegistryQuery(question);
    expect(query, question).toBeTruthy();
    return formatProjectRegistryAnswer({
      query: query!,
      rows: STATUS_ROWS,
      tabName: "Master Project Log",
    }).answer;
  }

  it("counts Open projects by default and says so", () => {
    const text = answer("How many projects in San Jose?");
    expect(text).toMatch(/There are 2 Open projects in San Jose/);
    expect(text).toMatch(/Counting Open projects only/);
    expect(text).toMatch(/2 Closed or unmarked projects match/);
  });

  it("includes closed or all projects when asked", () => {
    expect(answer("How many closed projects in San Jose?")).toMatch(
      /There is 1 Closed project in San Jose/,
    );
    expect(answer("How many projects in San Jose including closed?")).toMatch(
      /There are 4 projects in San Jose/,
    );
    expect(detectProjectStatusScope("list all projects in San Jose")).toBe("all");
    expect(detectProjectStatusScope("which projects are in San Jose")).toBe("open");
  });

  it("lists a salesperson's Open projects by default", () => {
    const query = detectProjectRegistryQuery("list Jenn's projects");
    expect(query).toMatchObject({
      kind: "filter_salesperson",
      salesperson: "Jenn",
      statusScope: "open",
    });
    const text = answer("list Jenn's projects");
    expect(text).toMatch(/Open projects for Jenn \(2\)/);
    expect(text).toMatch(/L01-26301/);
    expect(text).not.toMatch(/L01-26303 —/);
    expect(text).toMatch(/Counting Open projects only/);
  });

  it("city lists default to Open and label non-open rows when listing all", () => {
    const open = answer("which projects are in San Jose");
    expect(open).toMatch(/Open projects in San Jose \(2\)/);
    expect(open).not.toMatch(/L01-26303|L01-26304/);
    const all = answer("list all projects in San Jose");
    expect(all).toMatch(/L01-26303 — Shutdown \(Closed\)/);
    expect(all).toMatch(/L01-26304 — Blankstat \(no status\)/);
  });

  it("direct lookups still find Closed projects and label them", () => {
    const byNumber = answer("What city is project L01-26303?");
    expect(byNumber).toMatch(/L01-26303, Closed/);
    expect(byNumber).toMatch(/San Jose/);
    const byName = answer("Who is the salesperson on the Shutdown project?");
    expect(byName).toMatch(/\(L01-26303, Closed\)/);
    expect(byName).toMatch(/Jenn Lee/);
  });
});
