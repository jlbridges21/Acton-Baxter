/**
 * Regression tests for Baxter's organization-aware routing (the "Who is Sam?" → GoHighLevel bug),
 * through answerBaxterQuestion — the shared Slack / web entry point. GoHighLevel is "configured"
 * but stubbed, so any CRM search is recorded instead of sent.
 */

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
import {
  listMessagesForConversation,
  resetBaxterConversationMemoryForTests,
} from "@/lib/baxter-ai/conversations";
import { resetEnvCacheForTests } from "@/lib/env";
import { resetOrgRoutingCacheForTests } from "@/lib/agents/org-routing";
import { createAgent } from "@/lib/agents/admin";
import { SAM_DEFAULT_CONFIG } from "@/lib/agents/defaults";
import { getResolvedAgent } from "@/lib/agents/registry";
import { setModelCallerForTests } from "@/lib/agents/models";
import { ADMIN_ID, installFakeModel, setupAgentTestEnv } from "./agents-test-helpers";

const specialistFinal = () =>
  JSON.stringify({
    action: "final",
    result: {
      outcome: "answered",
      summary: "Here is the onboarding overview (synthetic).",
      missingInformation: [],
    },
  });

type Answer = Awaited<ReturnType<typeof answerBaxterQuestion>>;

async function ask(
  question: string,
  opts: { conversationId?: string | null; channel?: "web" | "slack" } = {},
): Promise<Answer> {
  return answerBaxterQuestion({
    question,
    userId: ADMIN_ID,
    userName: "Avery Admin",
    channel: opts.channel ?? "web",
    conversationId: opts.conversationId ?? null,
    ...(opts.channel === "slack"
      ? { externalUserId: "U-test", externalThreadId: "T-org", slackIsDirectMessage: true }
      : {}),
  } as Parameters<typeof answerBaxterQuestion>[0]);
}

beforeEach(async () => {
  await setupAgentTestEnv();
  process.env.BAXTER_CHAT_ENABLED = "true";
  process.env.ENABLE_GHL_INTEGRATION = "true";
  process.env.BAXTER_ROUTING_TIMEOUT_MS = "200";
  delete process.env.BAXTER_ORG_ROUTING;
  resetEnvCacheForTests();
  resetBaxterConversationMemoryForTests();
  resetOrgRoutingCacheForTests();
  crm.calls = [];
  installFakeModel([specialistFinal]);
});
afterEach(() => {
  setModelCallerForTests(null);
  delete process.env.BAXTER_ORG_ROUTING;
});

describe("Baxter organization routing — required cases", () => {
  it("'Who is Sam?' answers from the Agent Registry without searching GoHighLevel", async () => {
    const res = await ask("Who is Sam?");
    expect(crm.calls).toEqual([]);
    expect(res.delegation ?? null).toBeNull();
    expect(res.routing?.strategy).toBe("registry");
    expect(res.routing?.agent).toBe("sam");
    expect(res.answer).toMatch(
      /\*\*Sam\*\* is our AI HR, Administration & Legal Operations Coordinator/,
    );
    expect(res.sources.some((s) => s.sourceName === "Agent Registry")).toBe(true);
  });

  it("'Who is Sam in GoHighLevel?' searches the CRM, not the agent profile", async () => {
    const res = await ask("Who is Sam in GoHighLevel?");
    expect(crm.calls.length).toBeGreaterThan(0);
    expect(res.delegation ?? null).toBeNull();
    expect(res.routing?.strategy).not.toBe("registry");
    expect(res.answer).not.toContain("Operations Coordinator");
  });

  it("'Ask Sam to explain our onboarding process.' delegates to Sam", async () => {
    const res = await ask("Ask Sam to explain our onboarding process.");
    expect(res.delegation?.agentSlug).toBe("sam");
    expect(res.routing?.strategy).toBe("delegation");
    expect(crm.calls).toEqual([]);
  });

  it("'What can Sam currently do?' reports live readiness per source, not just the job description", async () => {
    const res = await ask("What can Sam currently do?");
    expect(res.routing?.strategy).toBe("registry");
    expect(res.answer).toContain("What's working right now");
    // Tool readiness is checked, so unconfigured sources are reported as not working.
    expect(res.answer).toMatch(/not working yet|working —/);
    expect(crm.calls).toEqual([]);
  });
});

describe("Baxter organization routing — behaviour", () => {
  it("discovers a newly published agent from the registry with no code change", async () => {
    const before = await ask("Who is Olivia?");
    expect(before.answer).not.toContain("Olivia** is our");
    const baxter = (await getResolvedAgent("baxter"))!;
    await createAgent({
      displayName: "Olivia",
      title: "Permitting Coordinator",
      description: "Tracks permit submissions and city corrections.",
      departmentId: null,
      managerAgentId: baxter.row.id,
      config: {
        ...SAM_DEFAULT_CONFIG,
        delegation: {
          ...SAM_DEFAULT_CONFIG.delegation,
          specialization: "City permit submissions and plan-check corrections",
          keywords: ["permit", "plan check"],
          positiveExamples: [
            "Where is the permit for the Smith ADU?",
            "What corrections came back from plan check?",
          ],
          negativeExamples: [],
        },
      },
      activate: true,
      actor: { userId: ADMIN_ID, label: "Avery Admin" },
    });
    crm.calls = [];
    const who = await ask("Who is Olivia?");
    expect(who.routing?.agent).toBe("olivia");
    expect(who.answer).toContain("Permitting Coordinator");
    expect(crm.calls).toEqual([]);
    const handles = await ask("Which agent handles permits?");
    expect(handles.answer).toMatch(/Olivia\*\*, our Permitting Coordinator, handles permits/);
  });

  it("resolves pronouns to the agent under discussion and delegates follow-up work", async () => {
    const first = await ask("Who is Sam?");
    const second = await ask("Can she help with onboarding?", {
      conversationId: first.conversationId,
    });
    expect(second.routing?.strategy).toBe("registry");
    expect(second.answer).toMatch(/^Yes/);
    const third = await ask("Ask her what documents we need.", {
      conversationId: first.conversationId,
    });
    expect(third.delegation?.agentSlug).toBe("sam");
    expect(crm.calls).toEqual([]);
  });

  it("asks one clarifying question when a bare name follows CRM context, then uses the answer", async () => {
    const first = await ask("Find the contact Sam Rivera in GoHighLevel");
    const second = await ask("Who is Sam?", { conversationId: first.conversationId });
    expect(second.routing?.strategy).toBe("clarify");
    expect(second.answer).toContain("or a person named Sam");
    const third = await ask("The AI agent", { conversationId: first.conversationId });
    expect(third.routing?.strategy).toBe("registry");
    expect(third.routing?.agent).toBe("sam");
  });

  it("does not delegate when an agent's name is used for a CRM record", async () => {
    const res = await ask("What's the phone number for Sam Johnson?");
    expect(res.delegation ?? null).toBeNull();
    expect(crm.calls.length).toBeGreaterThan(0);
  });

  it("formats for Slack with single-asterisk bold", async () => {
    const res = await ask("Who is Sam?", { channel: "slack" });
    expect(res.routing?.strategy).toBe("registry");
    expect(res.answer).toContain("*Sam* is our");
    expect(res.answer).not.toContain("**");
  });

  it("records a non-sensitive routing trace on the assistant message", async () => {
    const res = await ask("Who is Sam?");
    const messages = await listMessagesForConversation(res.conversationId);
    const assistant = messages.filter((m) => m.role === "assistant").at(-1)!;
    expect(assistant.metadata?.routing).toMatchObject({
      strategy: "registry",
      intent: "agent_info",
      agent: "sam",
    });
  });

  it("admin quality view: intent checks pass against the live registry and traces carry no content", async () => {
    await ask("Who is Sam?");
    await ask("Ask Sam to explain our onboarding process.");
    const { getOrgQuality } = await import("@/lib/agents/org-quality");
    const q = await getOrgQuality();
    expect(q.checks.filter((c) => !c.pass)).toEqual([]);
    expect(q.traces.byStrategy).toMatchObject({ registry: 1, delegation: 1 });
    expect(JSON.stringify(q.traces)).not.toContain("onboarding process");
  });

  it("BAXTER_ORG_ROUTING=off restores the previous pipeline", async () => {
    process.env.BAXTER_ORG_ROUTING = "off";
    const res = await ask("Who is Sam?");
    expect(res.routing ?? null).toBeNull();
  });
});
