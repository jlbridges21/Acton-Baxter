import { describe, expect, it } from "vitest";
import {
  runAllSlackRecallEvals,
  summarizeSlackRecallEvals,
} from "@/lib/baxter-data/slack/eval-suite";
import { classifyDecisionRole, buildDecisionCandidate } from "@/lib/baxter-data/slack/decisions";
import {
  shouldResetSlackFollowUpContext,
  expandRelativeTimeFollowUp,
} from "@/lib/baxter-data/slack/follow-up";
import { filterSlackEvidenceNoise, evidenceBudgetForIntent } from "@/lib/baxter-data/slack/filter";
import { dedupeSourceReferences, mapUsedSourceNumbers } from "@/lib/baxter-ai/citations";
import type { BaxterContextItem, BaxterSourceReference } from "@/lib/baxter-ai/types";

describe("Slack recall evaluation suite", () => {
  it("passes all deterministic Slack recall categories", () => {
    const summary = summarizeSlackRecallEvals();
    if (summary.failed > 0) {
      const failed = summary.results.filter((r) => !r.passed);
      console.error(
        failed.map((f) => ({
          id: f.id,
          checks: f.checks.filter((c) => !c.ok),
        })),
      );
    }
    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(summary.total);
    expect(summary.total).toBeGreaterThanOrEqual(14);
  });

  it("exposes expected category coverage", () => {
    const cats = new Set(runAllSlackRecallEvals().map((r) => r.category));
    for (const required of [
      "person_recall",
      "latest_message",
      "latest_update",
      "decision",
      "who_mentioned",
      "channel_summary",
      "thread_reconstruction",
      "follow_up",
      "temporal_precision",
      "prompt_injection",
    ]) {
      expect(cats.has(required as never)).toBe(true);
    }
  });
});

describe("Decision role classification", () => {
  it("distinguishes suggestion from decision", () => {
    expect(classifyDecisionRole("Maybe we should remove the 10-minute wait.")).toBe("suggestion");
    expect(
      classifyDecisionRole("Yes. Remove the wait and let the automation assign immediately."),
    ).toBe("decision");
    expect(classifyDecisionRole("I updated it.")).toBe("implementation");
    expect(classifyDecisionRole("Actually, keep it Thursday.")).toBe("reversal");
  });
});

describe("Follow-up context", () => {
  const prior = {
    topic: "design presentation",
    people: ["Jess"],
    channels: ["#design"],
    timeRangeLabel: "last week",
    intent: "person_statement",
    refs: [],
    updatedAt: new Date().toISOString(),
  };

  it("resets on new topic", () => {
    expect(shouldResetSlackFollowUpContext("What did Kevin say about Gwen yesterday?", prior)).toBe(
      true,
    );
  });

  it("keeps short pronoun follow-ups", () => {
    expect(shouldResetSlackFollowUpContext("Did Kevin respond?", prior)).toBe(false);
    expect(shouldResetSlackFollowUpContext("What did he say?", prior)).toBe(false);
  });

  it("expands relative time follow-ups", () => {
    const expanded = expandRelativeTimeFollowUp("What about this week?", {
      ...prior,
      topic: "RACI matrix",
    });
    expect(expanded).toMatch(/RACI/i);
    expect(expanded).toMatch(/this week/i);
  });
});

describe("Noise and budgets", () => {
  it("filters Baxter self and social noise", () => {
    const filtered = filterSlackEvidenceNoise(
      [
        {
          sourceType: "slack" as const,
          messageTs: "1",
          threadTs: null,
          channelId: "C",
          channelName: "sales",
          channelKind: "public_channel",
          authorId: "U1",
          authorName: "Baxter",
          timestamp: null,
          text: "I found Slack messages about RACI.",
          permalink: null,
          isThreadReply: false,
          relevance: 1,
          contextMessages: [],
          clusterKey: "C:1",
        },
        {
          sourceType: "slack" as const,
          messageTs: "2",
          threadTs: null,
          channelId: "C",
          channelName: "sales",
          channelKind: "public_channel",
          authorId: "U2",
          authorName: "Jess",
          timestamp: null,
          text: "Happy birthday!",
          permalink: null,
          isThreadReply: false,
          relevance: 1,
          contextMessages: [],
          clusterKey: "C:2",
        },
        {
          sourceType: "slack" as const,
          messageTs: "3",
          threadTs: null,
          channelId: "C",
          channelName: "sales",
          channelKind: "public_channel",
          authorId: "U3",
          authorName: "Kevin",
          timestamp: null,
          text: "PEM process update: wait step removed.",
          permalink: null,
          isThreadReply: false,
          relevance: 1,
          contextMessages: [],
          clusterKey: "C:3",
        },
      ],
      { intent: "channel_search" },
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.authorName).toBe("Kevin");
  });

  it("uses tight budget for latest_message", () => {
    expect(evidenceBudgetForIntent("latest_message")).toBe(1);
  });
});

describe("Citation dedupe", () => {
  it("dedupes Slack sources by permalink", () => {
    const items: BaxterContextItem[] = [
      {
        number: 1,
        id: "slack:C:1",
        title: "Jess in #design",
        summary: "a",
        contentExcerpt: "a",
        category: "Slack",
        tags: ["slack"],
        sourceName: "#design",
        sourceUrl: "https://example.slack.com/archives/C/p1",
        sourceType: "slack",
        mimeType: null,
        updatedAt: new Date().toISOString(),
        citationLabel: "Slack · Jess · #design",
        relevanceScore: 50,
      },
      {
        number: 2,
        id: "slack:C:2",
        title: "Jess in #design",
        summary: "b",
        contentExcerpt: "b",
        category: "Slack",
        tags: ["slack"],
        sourceName: "#design",
        sourceUrl: "https://example.slack.com/archives/C/p1",
        sourceType: "slack",
        mimeType: null,
        updatedAt: new Date().toISOString(),
        citationLabel: "Slack · Jess · #design",
        relevanceScore: 50,
      },
    ];
    const mapped = mapUsedSourceNumbers([1, 2], items);
    expect(mapped).toHaveLength(1);
  });

  it("dedupeSourceReferences collapses identical Slack links", () => {
    const sources: BaxterSourceReference[] = [
      {
        title: "a",
        sourceName: "#design",
        category: "Slack",
        sourceUrl: "https://example.slack.com/a",
        citationLabel: "Slack",
        sourceKind: "slack",
        openLabel: "View in Slack",
        lastUpdated: null,
        relevanceScore: 1,
        availability: "available",
      },
      {
        title: "b",
        sourceName: "#design",
        category: "Slack",
        sourceUrl: "https://example.slack.com/a",
        citationLabel: "Slack",
        sourceKind: "slack",
        openLabel: "View in Slack",
        lastUpdated: null,
        relevanceScore: 1,
        availability: "available",
      },
    ];
    expect(dedupeSourceReferences(sources)).toHaveLength(1);
  });
});

describe("Decision candidate chain", () => {
  it("clears decision after reversal", () => {
    const candidate = buildDecisionCandidate("day", [
      {
        sourceType: "slack",
        messageTs: "1",
        threadTs: null,
        channelId: "C",
        channelName: "design",
        channelKind: "public_channel",
        authorId: "U1",
        authorName: "Jess",
        timestamp: "2024-07-22T12:00:00Z",
        text: "Let's move it to Friday.",
        permalink: null,
        isThreadReply: false,
        relevance: 1,
        contextMessages: [],
        clusterKey: "C:1",
      },
      {
        sourceType: "slack",
        messageTs: "2",
        threadTs: null,
        channelId: "C",
        channelName: "design",
        channelKind: "public_channel",
        authorId: "U2",
        authorName: "Kevin",
        timestamp: "2024-07-23T12:00:00Z",
        text: "Actually, keep it Thursday.",
        permalink: null,
        isThreadReply: false,
        relevance: 1,
        contextMessages: [],
        clusterKey: "C:2",
      },
    ]);
    expect(candidate.reversedBy?.authorName).toBe("Kevin");
    expect(candidate.currentStateMessage?.text).toMatch(/Thursday/);
  });
});
