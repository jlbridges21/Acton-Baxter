/**
 * Baxter AI-CEO evaluation (organization awareness, disambiguation, delegation, follow-ups).
 * Runs every case through answerBaxterQuestion — the Slack/web entry point — with:
 *   - the live (seeded) Agent Registry: Baxter, Sam, Dexter,
 *   - GoHighLevel "configured" but stubbed, so CRM searches are recorded instead of sent,
 *   - a scripted specialist model (no real model calls).
 * Set BAXTER_ORG_ROUTING=off to measure the baseline (the pipeline without the new layer).
 */

import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const crm = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/lib/connectors/ghl/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/connectors/ghl/config")>()),
  isGhlConfigured: () => true,
}));
vi.mock("@/lib/baxter-ai/ghl-runtime", async (orig) => {
  const real = await orig<typeof import("@/lib/baxter-ai/ghl-runtime")>();
  return {
    ...real,
    handleGhlPendingConfirmation: async () => ({ handled: false }),
    handleGhlWriteProposal: async () => ({ handled: false }),
    retrieveGhlLiveEvidence: async (question: string) => {
      crm.calls.push(question);
      const { detectGhlIntent } = await import("@/lib/baxter-ai/ghl-intent");
      return {
        items: [],
        contextText: "",
        intent: detectGhlIntent(question),
        deterministicAnswer: "Sam Rivera is a lead in GoHighLevel (synthetic contact).",
      };
    },
  };
});
vi.mock("@/lib/slack/identity", () => ({ resolveBaxterUserForSlackIdentity: async () => null }));

import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { resetBaxterConversationMemoryForTests } from "@/lib/baxter-ai/conversations";
import { resetEnvCacheForTests } from "@/lib/env";
import { resetOrgRoutingCacheForTests } from "@/lib/agents/org-routing";
import {
  ORG_EVAL_CASES,
  ORG_EVAL_HELDOUT,
  ORG_EVAL_HELDOUT_2,
  scoreTurn,
  summarize,
  type TurnScore,
} from "@/lib/agents/org-eval";
import { setModelCallerForTests } from "@/lib/agents/models";
import { ADMIN_ID, EMPLOYEE_ID, installFakeModel, setupAgentTestEnv } from "./agents-test-helpers";

const specialistFinal = () =>
  JSON.stringify({
    action: "final",
    result: {
      outcome: "missing_information",
      summary: "I couldn't find an approved onboarding SOP in the Knowledge Hub yet.",
      missingInformation: ["Approved onboarding SOP"],
    },
  });

beforeEach(async () => {
  await setupAgentTestEnv();
  process.env.BAXTER_CHAT_ENABLED = "true";
  process.env.ENABLE_GHL_INTEGRATION = "true";
  process.env.BAXTER_ROUTING_TIMEOUT_MS = "200";
  resetEnvCacheForTests();
  resetBaxterConversationMemoryForTests();
  resetOrgRoutingCacheForTests();
  crm.calls = [];
  installFakeModel([specialistFinal]);
});
afterEach(() => setModelCallerForTests(null));

async function runCase(c: (typeof ORG_EVAL_CASES)[number]) {
  let conversationId: string | null = null;
  const turns: Array<TurnScore & { answer: string }> = [];
  for (const t of c.turns) {
    const before = crm.calls.length;
    const res = await answerBaxterQuestion({
      question: t.question,
      userId: c.asEmployee ? EMPLOYEE_ID : ADMIN_ID,
      userName: c.asEmployee ? "Eli Employee" : "Avery Admin",
      channel: c.channel ?? "web",
      conversationId,
      ...(c.channel === "slack"
        ? { externalUserId: "U-test", externalThreadId: `T-${c.id}`, slackIsDirectMessage: true }
        : {}),
    } as Parameters<typeof answerBaxterQuestion>[0]);
    conversationId = res.conversationId;
    turns.push({
      answer: res.answer.slice(0, 600),
      ...scoreTurn(t, {
        answer: res.answer,
        delegatedTo: res.delegation?.agentSlug ?? null,
        crmCalls: crm.calls.length - before,
        routingStrategy:
          (res as { routing?: { strategy?: string } | null }).routing?.strategy ?? null,
        answerMode: res.answerMode ?? null,
      }),
    });
  }
  return { id: c.id, category: c.category, turns };
}

describe("Baxter AI-CEO evaluation", () => {
  it("routes organization, disambiguation, delegation, and follow-up requests correctly", async () => {
    const results = [];
    for (const c of ORG_EVAL_CASES) results.push(await runCase(c));
    const heldout = [];
    for (const c of ORG_EVAL_HELDOUT) heldout.push(await runCase(c));
    const heldout2 = [];
    for (const c of ORG_EVAL_HELDOUT_2) heldout2.push(await runCase(c));
    const summary = {
      main: summarize(results),
      heldout: summarize(heldout),
      heldout2: summarize(heldout2),
    };
    results.push(...heldout, ...heldout2);
    const failures = results.flatMap((r) =>
      r.turns
        .filter((t) => !t.pass)
        .map((t) => `${r.id}: ${t.question} → ${t.failures.join("; ")}`),
    );
    if (process.env.EVAL_REPORT_PATH)
      writeFileSync(
        process.env.EVAL_REPORT_PATH,
        JSON.stringify(
          { mode: process.env.BAXTER_ORG_ROUTING ?? "on", summary, failures, transcripts: results },
          null,
          2,
        ),
      );
    console.log(JSON.stringify({ summary, failures }, null, 2));
    if (process.env.BAXTER_ORG_ROUTING === "off") return; // baseline measurement only
    expect(failures).toEqual([]);
  }, 120_000);
});
