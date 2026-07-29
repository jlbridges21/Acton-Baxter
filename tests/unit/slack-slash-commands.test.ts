import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { CLEAR_RESPONSE_SLACK } from "@/lib/baxter-ai/commands";
import {
  buildSlashHelpText,
  RECALL_USAGE,
  SLACK_PEM_TRANSCRIPT_MAX_CHARS,
  PEM_MODAL_CALLBACK_ID,
} from "@/lib/slack/slash-commands";
import { parseSlackCommandBody } from "@/lib/slack/commands";

function seedEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://acton-baxter.vercel.app";
  process.env.NEXT_PUBLIC_APP_URL = "https://acton-baxter.vercel.app";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.ENABLE_SLACK_INTEGRATION = "true";
  process.env.SLACK_SIGNING_SECRET = "secret";
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_ALLOWED_TEAM_IDS = "T_ACTON";
  resetEnvCacheForTests();
}

describe("Slack slash command helpers", () => {
  beforeEach(() => {
    seedEnv();
  });

  it("parses trigger_id from slash command body", () => {
    const body = new URLSearchParams({
      team_id: "T_ACTON",
      user_id: "U1",
      channel_id: "D1",
      command: "/pem",
      trigger_id: "trig.123",
      text: "",
    }).toString();
    expect(parseSlackCommandBody(body).trigger_id).toBe("trig.123");
  });

  it("help text includes slash commands and examples without LLM", () => {
    const text = buildSlashHelpText();
    expect(text).toContain("/clear");
    expect(text).toContain("/recall");
    expect(text).toContain("/pem");
    expect(text).toContain("/property");
    expect(text).toContain("Rachel Redmond");
    expect(text).toContain("acton-baxter.vercel.app");
  });

  it("recall usage examples when no query", () => {
    expect(RECALL_USAGE).toContain("/recall what did Jess say");
    expect(RECALL_USAGE).toContain("RACI");
  });

  it("PEM modal uses salesperson options and transcript max", async () => {
    vi.resetModules();
    seedEnv();
    vi.doMock("@/lib/pem-neat/salespeople", () => ({
      listSalespeople: async () => [
        { id: "11111111-1111-1111-1111-111111111111", displayName: "Alex Sales" },
      ],
      resolveSalespersonDisplayName: async () => ({
        displayName: "Alex Sales",
      }),
    }));
    const { buildPemCreateModalView } = await import("@/lib/slack/slash-commands");
    const view = await buildPemCreateModalView({ privateMetadata: "{}" });
    expect(view.callback_id).toBe(PEM_MODAL_CALLBACK_ID);
    const blocks = view.blocks as Array<Record<string, unknown>>;
    const transcript = blocks.find((b) => b.block_id === "transcript") as {
      element: { max_length: number; multiline: boolean };
    };
    expect(transcript.element.max_length).toBe(SLACK_PEM_TRANSCRIPT_MAX_CHARS);
    expect(transcript.element.multiline).toBe(true);
    const salesperson = blocks.find((b) => b.block_id === "salesperson") as {
      element: { options: Array<{ value: string; text: { text: string } }> };
    };
    expect(salesperson.element.options[0]?.text.text).toBe("Alex Sales");
  });

  it("clear response constant matches product copy", () => {
    expect(CLEAR_RESPONSE_SLACK).toBe("Conversation cleared. We’re starting fresh.");
  });
});

describe("handleClearSlashCommand", () => {
  beforeEach(() => {
    vi.resetModules();
    seedEnv();
  });

  it("routes /clear through answerBaxterQuestion", async () => {
    const answerBaxterQuestion = vi.fn(async () => ({
      answer: CLEAR_RESPONSE_SLACK,
      sources: [],
      confidence: "high",
      insufficientKnowledge: false,
      conversationId: "c1",
      answerMode: "identity",
    }));
    vi.doMock("@/lib/baxter-ai/answer", () => ({ answerBaxterQuestion }));

    const { handleClearSlashCommand } = await import("@/lib/slack/slash-commands");
    const ack = await handleClearSlashCommand({
      team_id: "T_ACTON",
      user_id: "U1",
      channel_id: "D1",
    });
    expect(ack.text).toBe(CLEAR_RESPONSE_SLACK);
    expect(answerBaxterQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "/clear",
        channel: "slack",
        externalUserId: "U1",
      }),
    );
  });
});

describe("handleRecallSlashCommand", () => {
  beforeEach(() => {
    vi.resetModules();
    seedEnv();
  });

  it("forces Slack recall intent", async () => {
    const answerBaxterQuestion = vi.fn(async () => ({
      answer: "Jess said the timeline slipped.",
      sources: [
        {
          title: "Jess",
          sourceName: "Slack",
          category: null,
          sourceUrl: null,
          citationLabel: "Slack",
          sourceKind: "slack",
          openLabel: "Open",
          lastUpdated: null,
          relevanceScore: 1,
          availability: "available",
        },
      ],
      confidence: "high",
      insufficientKnowledge: false,
      conversationId: "c1",
      answerMode: "grounded",
    }));
    vi.doMock("@/lib/baxter-ai/answer", () => ({ answerBaxterQuestion }));

    const { handleRecallSlashCommand } = await import("@/lib/slack/slash-commands");
    const ack = await handleRecallSlashCommand({
      team_id: "T_ACTON",
      user_id: "U1",
      channel_id: "D1",
      text: "what did Jess say last in #project-management?",
    });
    expect(ack.text).toContain("Jess");
    expect(answerBaxterQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        slackRecallForced: true,
        question: "what did Jess say last in #project-management?",
      }),
    );
  });

  it("returns usage when query empty", async () => {
    const { handleRecallSlashCommand } = await import("@/lib/slack/slash-commands");
    const ack = await handleRecallSlashCommand({
      team_id: "T_ACTON",
      user_id: "U1",
      channel_id: "D1",
      text: "  ",
    });
    expect(ack.text).toBe(RECALL_USAGE);
  });
});

describe("handlePemModalSubmission auth", () => {
  beforeEach(() => {
    vi.resetModules();
    seedEnv();
  });

  it("rejects unauthorized Slack users", async () => {
    vi.doMock("@/lib/slack/identity", () => ({
      resolveBaxterUserForSlackIdentity: async () => null,
      PEM_UNMAPPED_SLACK_USER_MESSAGE: "Baxter couldn’t match your Slack account to a Baxter user.",
      upsertSlackUserMapping: async () => undefined,
    }));

    const { handlePemModalSubmission } = await import("@/lib/slack/slash-commands");
    const result = await handlePemModalSubmission({
      private_metadata: JSON.stringify({
        teamId: "T_ACTON",
        userId: "U_EXT",
        baxterUserId: "11111111-1111-1111-1111-111111111111",
      }),
      state: {
        values: {
          prospect_name: { value: { value: "Robert Vertin" } },
          salesperson: {
            value: { selected_option: { value: "11111111-1111-1111-1111-111111111111" } },
          },
          transcript: {
            value: { value: "x".repeat(250) },
          },
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect("message" in result ? result.message : "").toMatch(/not authorized|identity|match/i);
    }
  });
});
