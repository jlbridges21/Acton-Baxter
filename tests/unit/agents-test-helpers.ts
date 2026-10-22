import { resetEnvCacheForTests } from "@/lib/env";
import { resetAgentStoreForTests } from "@/lib/agents/store";
import { resetSeedForTests } from "@/lib/agents/seed";
import { resetDelegationBackoffForTests } from "@/lib/agents/orchestrator";
import { invalidateAgentRegistry } from "@/lib/agents/registry";
import {
  setModelCallerForTests,
  type ModelCallInput,
  type ModelCallOutput,
} from "@/lib/agents/models";
import { getReportStore, resetMemoryStoreForTests } from "@/lib/research/report-store";
import type { Requester } from "@/lib/agents/types";

export const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1";
export const EMPLOYEE_ID = "00000000-0000-4000-8000-0000000000e1";
export const HR_ID = "00000000-0000-4000-8000-0000000000c1";

/** In-memory stores, mock embeddings, no network. */
export async function setupAgentTestEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.APP_BASE_URL = "https://baxter.example.com";
  process.env.NEXT_PUBLIC_APP_URL = "https://baxter.example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.AI_WORKFORCE_DELEGATION_ENABLED;
  resetEnvCacheForTests();
  resetAgentStoreForTests();
  resetSeedForTests();
  invalidateAgentRegistry();
  resetDelegationBackoffForTests();
  resetMemoryStoreForTests();
  const store = getReportStore();
  const now = new Date().toISOString();
  for (const [id, full_name, role] of [
    [ADMIN_ID, "Avery Admin", "admin"],
    [EMPLOYEE_ID, "Eli Employee", "user"],
    [HR_ID, "Harper HR", "user"],
  ] as const) {
    await store.ensureProfile({ id, full_name, role, created_at: now, updated_at: now });
  }
}

export function requester(id: string, role: string, label = "Test"): Requester {
  return { userId: id, role, departmentId: null, label, verifiedVia: "web_session" };
}

export type FakeTurn = (
  input: ModelCallInput,
  turn: number,
) => string | Error | Promise<string | Error>;

/** Scripted model: each call gets the next turn function. Records every call. */
export function installFakeModel(turns: FakeTurn[]) {
  const calls: ModelCallInput[] = [];
  setModelCallerForTests(async (input): Promise<ModelCallOutput> => {
    calls.push(input);
    const turn = turns[Math.min(calls.length - 1, turns.length - 1)]!;
    const out = await turn(input, calls.length);
    if (out instanceof Error) throw out;
    return {
      text: out,
      provider: input.provider,
      model: input.model,
      inputTokens: 1000,
      outputTokens: 200,
      latencyMs: 5,
    };
  });
  return calls;
}

export function lastUserMessage(input: ModelCallInput): string {
  return [...input.messages].reverse().find((m) => m.role === "user")?.content ?? "";
}

export const searchTurn =
  (query: string): FakeTurn =>
  () =>
    JSON.stringify({ action: "tools", calls: [{ tool: "knowledge_search", args: { query } }] });

/** Final turn that cites the first document returned by the previous tool call. */
export const citeFirstResultTurn: FakeTurn = (input) => {
  const toolMsg = lastUserMessage(input);
  const json = JSON.parse(toolMsg.slice(toolMsg.indexOf("\n") + 1)) as Array<{
    result?: { results?: Array<{ documentId: string; documentTitle: string; excerpt: string }> };
  }>;
  const first = json[0]?.result?.results?.[0];
  return JSON.stringify({
    action: "final",
    result: first
      ? {
          outcome: "answered",
          summary: `New hires complete the forms listed in ${first.documentTitle}.`,
          findings: [],
          sources: [
            {
              documentId: first.documentId,
              title: first.documentTitle,
              excerpt: first.excerpt.slice(0, 80),
            },
            { documentId: "fabricated-id", title: "Made Up Policy", excerpt: "not real" },
          ],
          nextSteps: ["Send the paperwork packet"],
          proposedActions: [],
          missingInformation: [],
          requiresHumanReview: false,
        }
      : {
          outcome: "missing_information",
          summary: "I couldn't find an approved document that covers this.",
          missingInformation: ["Approved onboarding SOP"],
        },
  });
};
