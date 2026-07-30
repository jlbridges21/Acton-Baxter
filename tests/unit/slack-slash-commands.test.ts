import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { CLEAR_RESPONSE_SLACK } from "@/lib/baxter-ai/commands";
import { DEMO_CUSTOMER_NAME, DEMO_PROSPECT_NAME } from "@/lib/demo-identity";
import {
  buildPemWebHandoffAck,
  buildSlashHelpText,
  RECALL_USAGE,
  PEM_LIST_PATH,
  PEM_NEW_PATH,
  SLACK_PEM_TRANSCRIPT_MAX_CHARS,
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

  it("help text includes slash commands and web PEM handoff description", () => {
    const text = buildSlashHelpText();
    expect(text).toContain("/clear");
    expect(text).toContain("/recall");
    expect(text).toContain("/pem");
    expect(text).toContain("/property");
    expect(text).toContain("PEM NEAT tool");
    expect(text).toContain(DEMO_PROSPECT_NAME);
    expect(text).toContain(DEMO_CUSTOMER_NAME);
    expect(text).not.toContain("Robert Vertin");
    expect(text).not.toContain("Lori Harris");
    expect(text).not.toContain("Rachel Redmond");
    expect(text).toContain("acton-baxter.vercel.app");
  });

  it("recall usage examples when no query", () => {
    expect(RECALL_USAGE).toContain("/recall what did Jess say");
    expect(RECALL_USAGE).toContain("RACI");
  });

  it("documents Slack transcript platform limit without offering modal input", () => {
    expect(SLACK_PEM_TRANSCRIPT_MAX_CHARS).toBe(3000);
    const ack = buildPemWebHandoffAck();
    expect(ack.text).toMatch(/too long for Slack/i);
    const blocksJson = JSON.stringify(ack.blocks ?? []);
    expect(blocksJson).not.toMatch(/plain_text_input|block_id.:.transcript/i);
  });

  it("clear response constant matches product copy", () => {
    expect(CLEAR_RESPONSE_SLACK).toBe("Conversation cleared. We’re starting fresh.");
  });
});

describe("handlePemSlashCommand web handoff", () => {
  beforeEach(() => {
    vi.resetModules();
    seedEnv();
  });

  it("returns web handoff with /pem-neats/new button and no modal", async () => {
    const viewsOpen = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("views.open")) {
          viewsOpen();
          return { json: async () => ({ ok: true }) };
        }
        return { json: async () => ({ ok: false }) };
      }),
    );

    const { handlePemSlashCommand } = await import("@/lib/slack/slash-commands");
    const ack = await handlePemSlashCommand({
      team_id: "T_ACTON",
      user_id: "U1",
      channel_id: "D1",
      command: "/pem",
    });

    expect(ack.text).toMatch(/too long for Slack/i);
    expect(ack.text).toMatch(/web app/i);
    expect(viewsOpen).not.toHaveBeenCalled();

    const blocksJson = JSON.stringify(ack.blocks ?? []);
    expect(blocksJson).toContain(`https://acton-baxter.vercel.app${PEM_NEW_PATH}`);
    expect(blocksJson).toContain(`https://acton-baxter.vercel.app${PEM_LIST_PATH}`);
    expect(blocksJson).toContain("Open PEM NEAT Tool");
    expect(blocksJson).toContain("View Existing PEM NEATs");
    expect(blocksJson).not.toMatch(/plain_text_input|callback_id|baxter_pem_create/i);
  });

  it("does not require Slack Search OAuth or Baxter user mapping", async () => {
    const identity = vi.fn();
    vi.doMock("@/lib/slack/identity", () => ({
      resolveBaxterUserForSlackIdentity: identity,
      PEM_UNMAPPED_SLACK_USER_MESSAGE: "should not appear",
      upsertSlackUserMapping: async () => undefined,
    }));

    const { handlePemSlashCommand } = await import("@/lib/slack/slash-commands");
    const ack = await handlePemSlashCommand({
      team_id: "T_ACTON",
      user_id: "U_UNKNOWN",
      channel_id: "D1",
      command: "/pem",
    });

    expect(identity).not.toHaveBeenCalled();
    expect(ack.text).not.toMatch(/Connect Slack Search/i);
    expect(ack.text).not.toMatch(/couldn’t match your Slack account/i);
    expect(ack.text).toMatch(/too long for Slack/i);
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
