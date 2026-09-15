/**
 * Parts A–C answer-quality: insufficientKnowledge expand, project Slack channel
 * derivation from Master Project Log, Suggested Answer for Baxter preference.
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  shouldExpandKnowledgeOnInsufficient,
  expandIdentifiedKnowledgeEntries,
  answerSignalsInsufficientExcerpt,
  BAXTER_EXPANDED_ENTRY_MAX_CHARS,
} from "@/lib/baxter-ai/knowledge-expand";
import type { BaxterContextItem } from "@/lib/baxter-ai/types";
import {
  extractSuggestedAnswerSection,
  preferSuggestedAnswerExcerpt,
  formatExpandedEntryWithSuggestedAnswer,
  suggestedAnswerAddressesQuestion,
  SUGGESTED_ANSWER_HEADING_VARIANTS,
} from "@/lib/knowledge/suggested-answer";
import { scoreKnowledgeMatch, buildKnowledgeSearchResult } from "@/lib/knowledge/retrieval";
import type { KnowledgeEntry } from "@/lib/knowledge/types";
import {
  deriveProjectSlackChannelFromRegistry,
  extractProjectIdentityQueriesForChannel,
  projectRowToSlackChannelSlug,
  isNamedProjectChannelAsk,
} from "@/lib/baxter-data/slack/project-channel-derive";
import {
  extractChannelMentions,
  isRelationalOrMangledChannelSlug,
  detectSlackSearchIntent,
} from "@/lib/baxter-data/slack/intent";
import { planSlackSearch } from "@/lib/baxter-data/slack/query-plan";
import {
  clearProjectLogCacheForTests,
  setProjectRegistryLoadDepsForTests,
  expectedSlackChannelSlug,
  type ProjectLogRow,
} from "@/lib/baxter-data/project-registry";
import { sanitizeSlackChannelSegment } from "@/lib/project-setup/names";
import { normalizeEntitySearchName } from "@/lib/baxter-ai/entity-name-normalize";

const KB_ID = "11111111-1111-4111-8111-111111111111";

const REIMBURSEMENT_DOC = `
# Employee Reimbursement Process

## Information Not Covered by This Process
For guidance beyond this process, contact Ally or Milan, or email invoice@actonadu.com.

## Submission
Email the reimbursement request to invoice@actonadu.com. Requests must include proof of payment.
Approved reimbursements are issued during the company's weekly payments meeting.

## Suggested Answer for Baxter
Email the reimbursement request to invoice@actonadu.com. Include proof of payment. Approved reimbursements are issued during the company's weekly payments meeting.
`.trim();

const FIXTURE_ROWS: ProjectLogRow[] = [
  {
    projectNumber: "L01-26019",
    shortName: "Liniger",
    salesperson: "Kevin Lee",
    startDate: "7/10/2026",
    customerName: "Katie Liniger",
    street: "25 N Avalon Dr",
    city: "Los Altos",
    postalCode: "94022",
    jurisdiction: "Los Altos",
    rowNumber: 15,
  },
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
];

function kbItem(overrides?: Partial<BaxterContextItem>): BaxterContextItem {
  return {
    number: 1,
    id: KB_ID,
    title: "Employee Reimbursement Process",
    summary: "How to submit reimbursements",
    contentExcerpt:
      "For guidance beyond this process, contact Ally or Milan, or email invoice@actonadu.com.",
    category: "Process",
    tags: ["reimbursement"],
    sourceName: "Knowledge Base",
    sourceUrl: null,
    sourceType: "procedure",
    mimeType: null,
    updatedAt: new Date().toISOString(),
    citationLabel: "Knowledge Base — Employee Reimbursement Process",
    relevanceScore: 90,
    ...overrides,
  };
}

describe("Part A — insufficientKnowledge expand + single retry", () => {
  it("detects excerpt-insufficient escalation copy", () => {
    expect(
      answerSignalsInsufficientExcerpt(
        "I found the approved Employee Reimbursement Process, but the retrieved excerpt does not include the submission steps.",
      ),
    ).toBe(true);
  });

  it("shouldExpand when insufficientKnowledge + identified KB entry", () => {
    expect(
      shouldExpandKnowledgeOnInsufficient({
        llm: {
          insufficientKnowledge: true,
          answer: "Contact Ally or Milan.",
        },
        contextItems: [kbItem()],
        alreadyExpanded: false,
      }),
    ).toBe(true);
  });

  it("shouldExpand when excerpt-miss phrasing even if flag false", () => {
    expect(
      shouldExpandKnowledgeOnInsufficient({
        llm: {
          insufficientKnowledge: false,
          answer:
            "I found the approved Employee Reimbursement Process, but the retrieved excerpt does not include the submission steps. Contact Ally or Milan.",
        },
        contextItems: [kbItem()],
        alreadyExpanded: false,
      }),
    ).toBe(true);
  });

  it("does not expand twice or without a KB entry", () => {
    expect(
      shouldExpandKnowledgeOnInsufficient({
        llm: { insufficientKnowledge: true, answer: "x" },
        contextItems: [kbItem()],
        alreadyExpanded: true,
      }),
    ).toBe(false);
    expect(
      shouldExpandKnowledgeOnInsufficient({
        llm: { insufficientKnowledge: true, answer: "x" },
        contextItems: [
          kbItem({
            id: "slack:1",
            sourceType: "slack",
          }),
        ],
        alreadyExpanded: false,
      }),
    ).toBe(false);
  });

  it("expands identified entry with Suggested Answer preferred (size-capped)", async () => {
    const { items, expandedEntryIds } = await expandIdentifiedKnowledgeEntries({
      contextItems: [kbItem()],
      question: "what is the process for how to submit reimbursements?",
      getEntry: async () => ({
        content: REIMBURSEMENT_DOC,
        title: "Employee Reimbursement Process",
      }),
    });
    expect(expandedEntryIds).toEqual([KB_ID]);
    expect(items[0]!.contentExcerpt.toLowerCase()).toContain("invoice@actonadu.com");
    expect(items[0]!.contentExcerpt.toLowerCase()).toContain("proof of payment");
    expect(items[0]!.contentExcerpt.toLowerCase()).toContain("weekly payments meeting");
    expect(items[0]!.contentExcerpt).toMatch(/AUTHOR-SUGGESTED ANSWER/i);
    expect(items[0]!.contentExcerpt.length).toBeLessThanOrEqual(BAXTER_EXPANDED_ENTRY_MAX_CHARS);
  });
});

describe("Part B — derive Slack channel from Master Project Log", () => {
  beforeEach(() => {
    clearProjectLogCacheForTests();
    setProjectRegistryLoadDepsForTests({ rowsOverride: FIXTURE_ROWS });
  });
  afterEach(() => {
    setProjectRegistryLoadDepsForTests(null);
    clearProjectLogCacheForTests();
  });

  it("does not mangle 'liniger slack channel' into #liniger-slack", () => {
    const mentions = extractChannelMentions("What's the latest in the liniger slack channel?");
    expect(mentions).not.toContain("liniger-slack");
    expect(isRelationalOrMangledChannelSlug("liniger-slack")).toBe(true);
    expect(mentions).toContain("liniger");
  });

  it("strips slack noise from entity names", () => {
    expect(normalizeEntitySearchName("liniger slack")?.toLowerCase()).toBe("liniger");
  });

  it("derives #l01-26019-liniger cold from the question alone", async () => {
    const derived = await deriveProjectSlackChannelFromRegistry(
      "What's the latest in the liniger slack channel?",
    );
    expect(derived?.slug).toBe("l01-26019-liniger");
    expect(expectedSlackChannelSlug(FIXTURE_ROWS[0]!)).toBe(
      sanitizeSlackChannelSegment("L01-26019-Liniger"),
    );
  });

  it("works for other phrasings and projects (incl. no project_setup_runs)", async () => {
    // Chen has no implication of project_setup_runs — registry-only.
    const phrasings = [
      "latest in the chen slack channel",
      "what's going on in the Chen project channel?",
      "activity in L01-25001 channel",
      "yeh slack channel latest",
    ];
    const expected = ["l01-25001-chen", "l01-25001-chen", "l01-25001-chen", "l01-26016-yeh"];
    for (let i = 0; i < phrasings.length; i += 1) {
      const derived = await deriveProjectSlackChannelFromRegistry(phrasings[i]!);
      expect(derived?.slug, phrasings[i]).toBe(expected[i]);
    }
  });

  it("classifies latest-in-channel as latest_update", () => {
    expect(detectSlackSearchIntent("What's the latest in the liniger slack channel?")).toBe(
      "latest_update",
    );
  });

  it("planSlackSearch prefers derived slug and reports it when missing", async () => {
    const planned = await planSlackSearch({
      question: "What's the latest in the liniger slack channel?",
      teamId: "T1",
      deps: {
        listCachedChannels: async () => [
          {
            id: "C_OTHER",
            name: "general",
            displayLabel: "general",
            teamId: "T1",
            kind: "public_channel",
            isPrivate: false,
            isArchived: false,
            isMember: true,
          },
        ],
        listCachedUsers: async () => [],
      },
    });
    expect(planned.derivedProjectChannel?.slug).toBe("l01-26019-liniger");
    expect(planned.plan.channels).toHaveLength(0);
    expect(planned.notFound.channels[0]).toBe("l01-26019-liniger");
    expect(planned.notFound.channels).not.toContain("liniger-slack");
  });

  it("planSlackSearch resolves derived channel when present", async () => {
    const planned = await planSlackSearch({
      question: "What's the latest in the liniger slack channel?",
      teamId: "T1",
      deps: {
        listCachedChannels: async () => [
          {
            id: "C_LIN",
            name: "l01-26019-liniger",
            displayLabel: "l01-26019-liniger",
            teamId: "T1",
            kind: "public_channel",
            isPrivate: false,
            isArchived: false,
            isMember: true,
          },
        ],
        listCachedUsers: async () => [],
      },
    });
    expect(planned.plan.channels.map((c) => c.name)).toContain("l01-26019-liniger");
    expect(planned.notFound.channels).toHaveLength(0);
  });

  it("extracts identity queries from named channel asks", () => {
    expect(extractProjectIdentityQueriesForChannel("liniger slack channel").join(" ")).toMatch(
      /liniger/i,
    );
    expect(isNamedProjectChannelAsk("What's the latest in the liniger slack channel?")).toBe(true);
    expect(projectRowToSlackChannelSlug(FIXTURE_ROWS[0]!)).toBe("l01-26019-liniger");
  });
});

describe("Part C — Suggested Answer for Baxter", () => {
  it("matches heading variations in use", () => {
    for (const heading of SUGGESTED_ANSWER_HEADING_VARIANTS) {
      const content = `${heading}\n\nEmail invoice@actonadu.com with proof of payment.`;
      const section = extractSuggestedAnswerSection(content);
      expect(section?.body, heading).toMatch(/invoice@actonadu\.com/);
    }
  });

  it("prefers suggested wording when it addresses the question", () => {
    const excerpt = preferSuggestedAnswerExcerpt(
      REIMBURSEMENT_DOC,
      "what is the process for how to submit reimbursements?",
      400,
    );
    expect(excerpt).toMatch(/invoice@actonadu\.com/i);
    expect(excerpt).toMatch(/proof of payment/i);
    expect(excerpt).not.toMatch(/Ally or Milan/i);
  });

  it("does not force suggested answer when question is uncovered", () => {
    expect(
      suggestedAnswerAddressesQuestion(
        "Email invoice@actonadu.com with proof of payment.",
        "What is the max vacation accrual for part-time employees?",
      ),
    ).toBe(false);
    const formatted = formatExpandedEntryWithSuggestedAnswer({
      content: REIMBURSEMENT_DOC,
      question: "What is the max vacation accrual for part-time employees?",
      maxChars: 4000,
    });
    // Still returns content, but without AUTHOR-SUGGESTED preference banner.
    expect(formatted.usedSuggestedAnswer).toBe(false);
  });

  it("retrieval excerpt prefers suggested answer for reimbursement ask", () => {
    const entry: KnowledgeEntry = {
      id: KB_ID,
      title: "Employee Reimbursement Process",
      content: REIMBURSEMENT_DOC,
      summary: null,
      category: "Process",
      tags: ["reimbursement"],
      source_name: "KB",
      source_type: "procedure",
      source_url: null,
      source_external_id: null,
      status: "approved",
      visibility: "internal",
      version: 1,
      created_by: null,
      updated_by: null,
      approved_by: null,
      approved_at: null,
      archived_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {},
    };
    const result = buildKnowledgeSearchResult(
      entry,
      "what is the process for how to submit reimbursements?",
      scoreKnowledgeMatch(entry, "what is the process for how to submit reimbursements?"),
    );
    expect(result.contentExcerpt.toLowerCase()).toContain("invoice@actonadu.com");
    expect(result.contentExcerpt.toLowerCase()).toContain("proof of payment");
  });
});

describe("verbatim answer shapes (expand → prefer suggested)", () => {
  it("after expansion, a grounded model answer states the submission steps", async () => {
    const question = "what is the process for how to submit reimbursements?";
    const first = {
      insufficientKnowledge: true,
      answer:
        "I found the approved Employee Reimbursement Process, but the retrieved excerpt does not include the submission steps. For guidance beyond the documented excerpt, contact Ally or Milan, or email invoice@actonadu.com.",
    };
    expect(
      shouldExpandKnowledgeOnInsufficient({
        llm: first,
        contextItems: [kbItem()],
        alreadyExpanded: false,
      }),
    ).toBe(true);

    const { items } = await expandIdentifiedKnowledgeEntries({
      contextItems: [kbItem()],
      question,
      getEntry: async () => ({ content: REIMBURSEMENT_DOC }),
    });

    // Simulated second-pass answer following Suggested Answer wording.
    const secondAnswer =
      "Email the reimbursement request to invoice@actonadu.com. Include proof of payment. Approved reimbursements are issued during the company's weekly payments meeting.";
    expect(items[0]!.contentExcerpt.toLowerCase()).toContain("invoice@actonadu.com");
    expect(secondAnswer.toLowerCase()).toContain("invoice@actonadu.com");
    expect(secondAnswer.toLowerCase()).toContain("proof of payment");
    expect(secondAnswer.toLowerCase()).toContain("weekly payments meeting");
    expect(secondAnswer.toLowerCase()).not.toContain("ally or milan");
  });
});
