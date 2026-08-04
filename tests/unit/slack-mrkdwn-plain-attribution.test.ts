/**
 * Slack mrkdwn → plain text, author attribution, channel-activity summaries.
 */
import { describe, expect, it } from "vitest";
import {
  firstReadableSentence,
  slackMrkdwnToPlainText,
  truncateAtWordBoundary,
} from "@/lib/baxter-data/slack/mrkdwn-plain";
import {
  formatSlackEvidenceExcerpt,
  summarizeProjectChannelActivity,
} from "@/lib/baxter-data/slack/format";
import { slackEvidenceToContextItems } from "@/lib/baxter-data/slack/to-context";
import { hydrateSlackEvidenceAuthorNames } from "@/lib/baxter-data/slack/author-labels";
import { SLACK_SOURCE_TYPE, type SlackMessageEvidence } from "@/lib/baxter-data/slack/types";
import { formatSlackRetrievalStatusForModel } from "@/lib/baxter-data/slack/retrieval-status";

function evidence(partial: Partial<SlackMessageEvidence> & { text: string }): SlackMessageEvidence {
  return {
    sourceType: SLACK_SOURCE_TYPE,
    messageTs: "1.1",
    threadTs: null,
    channelId: "C_LINIGER",
    channelName: "l01-26019-liniger",
    channelKind: "public_channel",
    authorId: "U_SENDER",
    authorName: null,
    timestamp: "2026-08-04T15:00:00.000Z",
    permalink: null,
    isThreadReply: false,
    relevance: 1,
    contextMessages: [],
    clusterKey: "c1",
    ...partial,
  };
}

describe("slackMrkdwnToPlainText", () => {
  it("resolves mentions, mailto, and link labels from a real Katie-shaped message", () => {
    const raw =
      "<@U03JHQC5B61> Katie <mailto:kathryn_liniger@yahoo.com|kathryn_liniger@yahoo.com> confirmed both the site-inspection and the Kickoff with <https://drive.google.com/x|G-Drive>";
    const plain = slackMrkdwnToPlainText(raw, {
      U03JHQC5B61: "Jess",
    });
    expect(plain).toBe(
      "Jess Katie kathryn_liniger@yahoo.com confirmed both the site-inspection and the Kickoff with G-Drive",
    );
    expect(plain).not.toContain("<@");
    expect(plain).not.toContain("<mailto:");
    expect(plain).not.toContain("https://");
  });
});

describe("truncateAtWordBoundary", () => {
  it("never truncates mid-word", () => {
    const long =
      "Confirmed CMS setup and created the project folder in Google Drive for Liniger ADU kickoff";
    const cut = truncateAtWordBoundary(long, 40);
    expect(cut.endsWith("…")).toBe(true);
    const withoutEllipsis = cut.replace(/…$/, "").trimEnd();
    expect(long.startsWith(withoutEllipsis)).toBe(true);
    const nextChar = long[withoutEllipsis.length];
    expect(nextChar === undefined || /\s/.test(nextChar)).toBe(true);
    expect(withoutEllipsis).not.toMatch(/projec$/i);
  });

  it("firstReadableSentence prefers a complete sentence", () => {
    expect(firstReadableSentence("Katie confirmed kickoff. More later.", 80)).toBe(
      "Katie confirmed kickoff.",
    );
  });
});

describe("formatSlackEvidenceExcerpt + summarize", () => {
  it("uses resolved author and cleaned text — not Unknown or raw markup", () => {
    const item = evidence({
      authorId: "U03JHQC5B61",
      authorName: "Jess",
      text: "<@U09ABC> Katie <mailto:kathryn_liniger@yahoo.com|kathryn_liniger@yahoo.com> confirmed both the site-inspection and the Kickoff",
    });
    const formatted = formatSlackEvidenceExcerpt(item, 200, { U09ABC: "Maxx" });
    expect(formatted.author).toBe("Jess");
    expect(formatted.author).not.toBe("Unknown");
    expect(formatted.excerpt).toContain("Maxx");
    expect(formatted.excerpt).toContain("kathryn_liniger@yahoo.com");
    expect(formatted.excerpt).not.toContain("<@");
    expect(formatted.excerpt).not.toContain("<mailto:");
  });

  it("summarizes channel activity into readable prose without mid-word cuts", () => {
    const summary = summarizeProjectChannelActivity({
      channelDisplay: "#l01-26019-liniger",
      messages: [
        {
          author: "Jess",
          text: "Katie confirmed both the site-inspection and the Kickoff.",
          timestamp: "2026-08-04T15:00:00.000Z",
        },
        {
          author: "Maxx",
          text: "CMS setup confirmed and the project folder was created.",
          timestamp: "2026-08-04T16:00:00.000Z",
        },
      ],
    });
    expect(summary).toContain("Recent activity in #l01-26019-liniger");
    expect(summary).toContain("Jess");
    expect(summary).toContain("Maxx");
    expect(summary).toContain("Katie confirmed");
    expect(summary).not.toMatch(/\w…/);
    expect(summary).not.toContain("Unknown");
  });
});

describe("hydrateSlackEvidenceAuthorNames", () => {
  it("uses pickSlackDisplayName-style profile fields (Feedback dashboard path)", async () => {
    const { messages, nameByUserId } = await hydrateSlackEvidenceAuthorNames(
      [
        evidence({
          authorId: "U_SENDER",
          authorName: null,
          text: "<@U_MENTION> please confirm",
        }),
      ],
      "T_ACTON",
      {
        getCachedProfile: async (_team, id) =>
          id === "U_SENDER"
            ? {
                slack_user_id: "U_SENDER",
                display_name: "Jess",
                real_name: "Jessica",
                username: "jess",
              }
            : {
                slack_user_id: "U_MENTION",
                display_name: "Maxx",
                real_name: null,
                username: "maxx",
              },
      },
    );
    expect(messages[0]!.authorName).toBe("Jess");
    expect(nameByUserId.get("U_MENTION")).toBe("Maxx");
    expect(messages[0]!.authorName).not.toBe("Unknown");
  });
});

describe("slackEvidenceToContextItems attribution", () => {
  it("instructs the model to name the author, never 'the sender'", () => {
    const items = slackEvidenceToContextItems(
      [
        evidence({
          authorId: "U1",
          authorName: "Maxx",
          text: "The privacy considerations were revised in the charter.",
        }),
      ],
      null,
      1,
    );
    expect(items[0]!.contentExcerpt).toContain("AUTHOR: Maxx");
    expect(items[0]!.contentExcerpt).toMatch(/Maxx said/);
    expect(items[0]!.contentExcerpt).toMatch(/Never say “the sender”/);
    expect(items[0]!.title).toContain("Maxx");
  });
});

describe("formatSlackRetrievalStatusForModel", () => {
  it("forbids 'the sender' attribution when results are found", () => {
    const prompt = formatSlackRetrievalStatusForModel({
      status: "results_found",
      intent: "latest_update",
      channel: "#ops",
      person: null,
      resultCount: 2,
      credentialPath: "user",
      retrievalMethod: "search.messages",
      employeeNote: null,
    });
    expect(prompt).toMatch(/never say “the sender”/i);
    expect(prompt).toMatch(/Jess said/i);
  });
});
