import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { resetEnvCacheForTests } from "@/lib/env";
import { hashContent, googleOpenLabel, googleSourceKind } from "@/lib/connectors/google/parser";
import { GOOGLE_DOC_MIME, GOOGLE_SHEET_MIME } from "@/lib/connectors/google/types";
import { GoogleWorkspaceConnector } from "@/lib/connectors/google/sync";
import {
  resetGoogleFoldersMemoryForTests,
  addGoogleSyncFolder,
} from "@/lib/connectors/google/folders";
import { listConnectorHealth } from "@/lib/connectors/registry";
import { verifySlackRequest, SlackSignatureError } from "@/lib/slack/verify";
import {
  shouldIgnoreSlackEvent,
  buildBaxterSlackBlocks,
  claimSlackEvent,
} from "@/lib/slack/baxter-events";
import { contextItemToSourceReference, mapUsedSourceNumbers } from "@/lib/baxter-ai/citations";
import type { BaxterAnswer, BaxterContextItem } from "@/lib/baxter-ai/types";
import { resetBaxterConversationMemoryForTests } from "@/lib/baxter-ai/conversations";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { resetKnowledgeMemoryForTests } from "@/lib/knowledge/store";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.ENABLE_SLACK_INTEGRATION = "true";
  process.env.ENABLE_GHL_INTEGRATION = "false";
  process.env.SLACK_SIGNING_SECRET = "secret";
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_ALLOWED_TEAM_IDS = "T123";
  process.env.SLACK_REPORT_USER_ID = "00000000-0000-4000-8000-000000000099";
  process.env.BAXTER_CHAT_ENABLED = "true";
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.GOOGLE_CLIENT_EMAIL;
  delete process.env.GOOGLE_PRIVATE_KEY;
  resetEnvCacheForTests();
  resetGoogleFoldersMemoryForTests();
  resetBaxterConversationMemoryForTests();
  resetKnowledgeMemoryForTests();
});

describe("Google connector helpers", () => {
  it("hashes content deterministically and labels Google source kinds", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
    expect(hashContent("hello")).not.toBe(hashContent("hello!"));
    expect(googleSourceKind(GOOGLE_DOC_MIME)).toBe("google_doc");
    expect(googleSourceKind(GOOGLE_SHEET_MIME)).toBe("google_sheet");
    expect(googleOpenLabel(GOOGLE_DOC_MIME)).toBe("Open Google Doc");
    expect(googleOpenLabel(GOOGLE_SHEET_MIME)).toBe("Open Google Sheet");
  });

  it("reports Google connector offline when credentials are missing", async () => {
    const health = await new GoogleWorkspaceConnector().health();
    expect(health.status).toBe("offline");
    expect(health.label).toBe("Offline");
  });

  it("lists connectors with appropriate statuses", async () => {
    const health = await listConnectorHealth();
    expect(health.find((item) => item.key === "gohighlevel")).toBeTruthy();
    expect(health.find((item) => item.key === "buildertrend")?.status).toBe("coming_soon");
    expect(health.find((item) => item.key === "domo")?.status).toBe("coming_soon");
    expect(health.find((item) => item.key === "google_workspace")).toBeTruthy();
    expect(health.find((item) => item.key === "slack")?.status).toBe("healthy");
  });

  it("stores connected folders in memory for local/admin testing", async () => {
    const folder = await addGoogleSyncFolder({
      folderId: "folder-1",
      folderName: "SOPs",
      userId: "00000000-0000-4000-8000-000000000001",
    });
    expect(folder.folder_name).toBe("SOPs");
    expect(folder.status).toBe("active");
  });
});

describe("Clickable sources", () => {
  it("builds Google and knowledge entry open links from retrieved records only", () => {
    const items: BaxterContextItem[] = [
      {
        number: 1,
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "PEM Preparation",
        summary: null,
        contentExcerpt: "Prepare the PEM packet.",
        category: "Sales Process",
        tags: ["pem"],
        sourceName: "Sales",
        sourceUrl: "https://docs.google.com/document/d/abc",
        sourceType: "Google Drive",
        mimeType: GOOGLE_DOC_MIME,
        updatedAt: new Date().toISOString(),
        citationLabel: "Sales — PEM Preparation",
        relevanceScore: 42,
      },
      {
        number: 2,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "Manual Policy",
        summary: null,
        contentExcerpt: "Manual entry",
        category: "HR",
        tags: [],
        sourceName: null,
        sourceUrl: null,
        sourceType: "manual",
        mimeType: null,
        updatedAt: new Date().toISOString(),
        citationLabel: "HR — Manual Policy",
        relevanceScore: 12,
      },
    ];

    const sources = mapUsedSourceNumbers([1, 2], items);
    expect(sources[0]?.openLabel).toBe("Open Google Doc");
    expect(sources[0]?.sourceUrl).toBe("https://docs.google.com/document/d/abc");
    expect(sources[0]?.relevanceScore).toBe(42);
    expect(sources[1]?.openLabel).toBe("Open Knowledge Entry");
    expect(sources[1]?.sourceUrl).toBe("/knowledge/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    const forged = contextItemToSourceReference({
      ...items[0]!,
      sourceUrl: "javascript:alert(1)",
    });
    expect(forged.sourceUrl).toBeNull();
    expect(forged.availability).toBe("unavailable");
  });
});

describe("Slack verification and events", () => {
  it("verifies Slack signatures and rejects replayed/old timestamps", () => {
    const rawBody = '{"type":"event_callback"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const base = `v0:${timestamp}:${rawBody}`;
    const signature = `v0=${createHmac("sha256", "secret").update(base).digest("hex")}`;
    expect(() =>
      verifySlackRequest({ signature, timestamp, rawBody, signingSecret: "secret" }),
    ).not.toThrow();
    expect(() =>
      verifySlackRequest({
        signature,
        timestamp: String(Math.floor(Date.now() / 1000) - 10_000),
        rawBody,
        signingSecret: "secret",
      }),
    ).toThrow(SlackSignatureError);
  });

  it("ignores bot messages and claims events once", async () => {
    expect(shouldIgnoreSlackEvent({ type: "message", bot_id: "B1", text: "hi" })).toBe(true);
    expect(shouldIgnoreSlackEvent({ type: "app_mention", user: "U1", text: "<@B> hi" })).toBe(
      false,
    );
    expect(await claimSlackEvent("evt-1", "app_mention", "T123")).toBe(true);
    expect(await claimSlackEvent("evt-1", "app_mention", "T123")).toBe(false);
  });

  it("formats Slack source blocks with links from stored metadata", () => {
    const answer: BaxterAnswer = {
      answer: "Follow the PEM checklist.",
      confidence: "high",
      insufficientKnowledge: false,
      conversationId: "c1",
      sources: [
        {
          title: "PEM Preparation",
          sourceName: "Sales",
          category: "Sales Process",
          sourceUrl: "https://docs.google.com/document/d/abc",
          citationLabel: "Sales — PEM Preparation",
          sourceKind: "google_doc",
          openLabel: "Open Google Doc",
          lastUpdated: new Date().toISOString(),
          relevanceScore: 40,
          availability: "available",
        },
      ],
    };
    const blocks = buildBaxterSlackBlocks(answer);
    const serialized = JSON.stringify(blocks);
    expect(serialized).toContain("Sources");
    expect(serialized).toContain("https://docs.google.com/document/d/abc");
    expect(serialized).not.toContain("javascript:");
  });

  it("logs Slack-channel conversations through the shared answer path", async () => {
    const result = await answerBaxterQuestion({
      question: "Is there a totally unknown Acton process xyzzy?",
      userId: "00000000-0000-4000-8000-000000000099",
      userName: "Slack User",
      channel: "slack",
      externalThreadId: "111.222",
      externalUserId: "U123",
    });
    expect(result.insufficientKnowledge).toBe(true);
    expect(result.conversationId).toBeTruthy();
  });
});
