/**
 * Capability question scope: general overview vs specific vs resource access.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  classifyCapabilityQuestion,
  isImpliedCapabilityAction,
} from "@/lib/baxter/capability-intent";
import {
  answerCapabilityHelp,
  answerResourceAccessCheck,
  detectCapabilityHelpIntent,
} from "@/lib/baxter/capability-help";
import { buildBaxterQueryPlan } from "@/lib/baxter/query-plan";
import { detectSlackSearchIntent } from "@/lib/baxter-data/slack";
import { GoogleConnectorError } from "@/lib/connectors/google/errors";

const DOC_URL =
  "https://docs.google.com/document/d/1ugXZqBWNP7CjI6Tt0htBjUqpQOMLvn70--CNBbR3cBQ/edit";
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://acton-baxter.vercel.app";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.ENABLE_SLACK_INTEGRATION = "true";
  process.env.ENABLE_SLACK_SEARCH = "true";
  resetEnvCacheForTests();
});

describe("capability question classification", () => {
  it("A) What can you do? → general_capabilities", () => {
    const c = classifyCapabilityQuestion("What can you do?");
    expect(c.kind).toBe("general_capabilities");
    expect(buildBaxterQueryPlan("What can you do?").intent).toBe("general_capabilities");
  });

  it("B) What can you help me with? → general_capabilities", () => {
    expect(classifyCapabilityQuestion("What can you help me with?").kind).toBe(
      "general_capabilities",
    );
  });

  it("J) What are all the systems you have access to? → general_capabilities", () => {
    expect(classifyCapabilityQuestion("What are all the systems you have access to?").kind).toBe(
      "general_capabilities",
    );
  });

  it("C) Can you search Slack? → specific_capability", () => {
    const c = classifyCapabilityQuestion("Can you search Slack?");
    expect(c.kind).toBe("specific_capability");
    expect(c.topic).toBe("slack");
  });

  it("D) Do you have access to BuilderTrend? → specific_capability", () => {
    const c = classifyCapabilityQuestion("Do you have access to BuilderTrend?");
    expect(c.kind).toBe("specific_capability");
    expect(c.topic).toBe("buildertrend");
  });

  it("E) Google Doc URL access → resource_access_check", () => {
    const q = `Do you have access to this document?\n${DOC_URL}`;
    const c = classifyCapabilityQuestion(q);
    expect(c.kind).toBe("resource_access_check");
    expect(c.googleUrl).toContain("1ugXZqBWNP7CjI6Tt0htBjUqpQOMLvn70--CNBbR3cBQ");
    expect(detectCapabilityHelpIntent(q)).toBe(false);
  });

  it("F) Google Sheet URL → resource_access_check", () => {
    const q = `Can you read this spreadsheet? ${SHEET_URL}`;
    expect(classifyCapabilityQuestion(q).kind).toBe("resource_access_check");
  });

  it("G) Can you find Stanley Quan in GHL? → implied_action", () => {
    const q = "Can you find Stanley Quan in GHL?";
    expect(classifyCapabilityQuestion(q).kind).toBe("implied_action");
    expect(isImpliedCapabilityAction(q)).toBe(true);
    expect(detectCapabilityHelpIntent(q)).toBe(false);
    expect(answerCapabilityHelp({ question: q })).toBeNull();
  });

  it("H) Can you see what Jess said last in #project-management? → implied_action / Slack", () => {
    const q = "Can you see what Jess said last in #project-management?";
    expect(classifyCapabilityQuestion(q).kind).toBe("implied_action");
    expect(detectSlackSearchIntent(q)).toBe("latest_message");
    expect(answerCapabilityHelp({ question: q })).toBeNull();
  });

  it("I) Can you generate a PEM NEAT? → specific_capability", () => {
    const c = classifyCapabilityQuestion("Can you generate a PEM NEAT?");
    expect(c.kind).toBe("specific_capability");
    expect(c.topic).toBe("pem_neat");
  });
});

describe("capability answer scope", () => {
  it("A/B/J overview is comprehensive; C/D/I stay narrow", () => {
    const overview = answerCapabilityHelp({ question: "What can you do?" });
    expect(overview?.answer).toMatch(/PEM NEAT|Property Research|knowledge/i);
    expect(overview?.answer.split("\n").length).toBeGreaterThan(5);

    const slack = answerCapabilityHelp({ question: "Can you search Slack?" });
    expect(slack?.answer).toMatch(/slack/i);
    expect(slack?.answer).not.toMatch(/BuilderTrend API connection[\s\S]*Property Research/i);
    expect(slack?.answer.toLowerCase()).not.toContain("• pem neats");

    const bt = answerCapabilityHelp({ question: "Do you have access to BuilderTrend?" });
    expect(bt?.answer).toMatch(
      /does not currently have a direct BuilderTrend|not directly connected/i,
    );
    expect(bt?.answer).not.toMatch(/• Acton knowledge/i);

    const pem = answerCapabilityHelp({ question: "Can you generate a PEM NEAT?" });
    expect(pem?.answer).toMatch(/PEM NEAT/i);
    expect(pem?.answer).not.toMatch(/• CRM —/i);
  });

  it("E) Google Doc access check uses live lookup result", async () => {
    const q = `Do you have access to this document? ${DOC_URL}`;
    const ok = await answerResourceAccessCheck({
      question: q,
      isGoogleConfiguredFn: () => true,
      getDriveFileFn: async () =>
        ({
          id: "1ugXZqBWNP7CjI6Tt0htBjUqpQOMLvn70--CNBbR3cBQ",
          name: "Acton Sample Spec",
          mimeType: "application/vnd.google-apps.document",
          modifiedTime: "2026-01-01T00:00:00.000Z",
          webViewLink: DOC_URL,
          owners: [],
          parents: [],
        }) as Awaited<ReturnType<typeof import("@/lib/connectors/google/drive").getDriveFile>>,
    });
    expect(ok?.answer).toMatch(/Yes\. I can access that Google Doc/i);
    expect(ok?.answer).toMatch(/Acton Sample Spec/);
    expect(ok?.answer).not.toMatch(/• PEM NEAT/i);

    const denied = await answerResourceAccessCheck({
      question: q,
      isGoogleConfiguredFn: () => true,
      getDriveFileFn: async () => {
        throw new GoogleConnectorError("Permission denied", {
          code: "BAXTER_GOOGLE_PERMISSION_DENIED",
          statusCode: 403,
        });
      },
    });
    expect(denied?.answer).toMatch(/can’t access|can't access/i);

    const missing = await answerResourceAccessCheck({
      question: q,
      isGoogleConfiguredFn: () => true,
      getDriveFileFn: async () => {
        throw new GoogleConnectorError("Not found", {
          code: "BAXTER_GOOGLE_FOLDER_NOT_FOUND",
          statusCode: 404,
        });
      },
    });
    expect(missing?.answer).toMatch(/couldn’t find|couldn't find/i);

    const offline = await answerResourceAccessCheck({
      question: q,
      isGoogleConfiguredFn: () => false,
    });
    expect(offline?.answer).toMatch(/unavailable|not configured/i);
  });

  it("does not dump overview for Google Doc access questions via sync help", () => {
    const q = `Do you have access to this document? ${DOC_URL}`;
    expect(answerCapabilityHelp({ question: q })).toBeNull();
  });
});
