import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  NEW_PROJECT_CALLBACK_SEARCH,
  type NewProjectModalMeta,
} from "@/lib/project-setup/new-project-views";

const updateSlackModal = vi.fn();
const openSlackModal = vi.fn();
const openSlackDm = vi.fn();

vi.mock("@/lib/slack/provisioning", () => ({
  updateSlackModal: (...args: unknown[]) => updateSlackModal(...args),
  openSlackModal: (...args: unknown[]) => openSlackModal(...args),
  openSlackDm: (...args: unknown[]) => openSlackDm(...args),
  createPublicSlackChannel: vi.fn(),
  lookupSlackUserByEmail: vi.fn(),
  inviteUsersToSlackChannel: vi.fn(),
}));

vi.mock("@/lib/slack/client", () => ({
  postSlackMessage: vi.fn(),
}));

vi.mock("@/lib/project-setup/service", () => ({
  searchProjectSetupContacts: vi.fn(),
  loadProjectSetupContactSnapshot: vi.fn(),
  buildProjectSetupPreview: vi.fn(),
}));

vi.mock("@/lib/project-setup/capabilities", () => ({
  googleWritesEnabled: vi.fn(async () => true),
  slackProvisioningEnabled: () => true,
}));

vi.mock("@/lib/project-setup/store", () => ({
  createProjectSetupRun: vi.fn(),
}));

vi.mock("@/lib/project-setup/enqueue", () => ({
  enqueueProjectSetupRun: vi.fn(),
}));

vi.mock("@/lib/slack/identity", () => ({
  resolveBaxterUserForSlackIdentity: vi.fn(),
}));

vi.mock("@/lib/slack/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/slack/config")>();
  return {
    ...actual,
    isSlackUserAllowed: vi.fn(() => true),
    getPublicAppBaseUrl: () => "https://acton-baxter.vercel.app",
  };
});

const meta: NewProjectModalMeta = {
  slackUserId: "U_TEST",
  slackTeamId: "T_TEST",
  query: "Lisa",
};

describe("runNewProjectSearchAsync deadlines", () => {
  beforeEach(() => {
    process.env.E2E_TEST_AUTH_BYPASS = "true";
    process.env.ENABLE_SLACK_INTEGRATION = "true";
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.APP_BASE_URL = "https://acton-baxter.vercel.app";
    resetEnvCacheForTests();
    vi.clearAllMocks();
    updateSlackModal.mockResolvedValue(undefined);
  });

  it("updates the modal with a retryable error when GHL never resolves", async () => {
    const { runNewProjectSearchAsync } = await import("@/lib/project-setup/new-project-async");

    const neverResolves = () => new Promise<never>(() => undefined);
    const started = Date.now();

    await runNewProjectSearchAsync({
      viewId: "V_TEST",
      slackUserId: "U_TEST",
      query: "Lisa",
      nextMeta: meta,
      ghlTimeoutMs: 40,
      overallDeadlineMs: 80,
      slackUpdateTimeoutMs: 200,
      searchContacts: neverResolves as never,
    });

    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(500);
    expect(updateSlackModal).toHaveBeenCalledTimes(1);
    const view = updateSlackModal.mock.calls[0]?.[0]?.view as {
      callback_id?: string;
      blocks?: Array<{ text?: { text?: string } }>;
    };
    expect(view.callback_id).toBe(NEW_PROJECT_CALLBACK_SEARCH);
    const blockText = JSON.stringify(view.blocks ?? []);
    expect(blockText).toMatch(/timed out/i);
    expect(blockText).toMatch(/Search to retry/i);
  });

  it("updates the modal with a friendly retry error when GHL throws", async () => {
    const { runNewProjectSearchAsync } = await import("@/lib/project-setup/new-project-async");

    await runNewProjectSearchAsync({
      viewId: "V_TEST",
      slackUserId: "U_TEST",
      query: "Lisa",
      nextMeta: meta,
      ghlTimeoutMs: 200,
      overallDeadlineMs: 400,
      slackUpdateTimeoutMs: 200,
      searchContacts: async () => {
        throw new Error("GHL upstream unavailable");
      },
    });

    expect(updateSlackModal).toHaveBeenCalledTimes(1);
    const view = updateSlackModal.mock.calls[0]?.[0]?.view as {
      callback_id?: string;
      blocks?: unknown[];
    };
    expect(view.callback_id).toBe(NEW_PROJECT_CALLBACK_SEARCH);
    const blockText = JSON.stringify(view.blocks ?? []);
    expect(blockText).toContain("GHL upstream unavailable");
    expect(blockText).toMatch(/Search to retry/i);
  });

  it("updates to the pick modal when GHL returns hits", async () => {
    const { runNewProjectSearchAsync } = await import("@/lib/project-setup/new-project-async");
    const { NEW_PROJECT_CALLBACK_PICK } = await import("@/lib/project-setup/new-project-views");

    await runNewProjectSearchAsync({
      viewId: "V_TEST",
      slackUserId: "U_TEST",
      query: "Lisa",
      nextMeta: meta,
      searchContacts: async () => [
        {
          id: "c1",
          name: "Lisa Wright",
          email: "lisa@example.com",
          phone: "555",
          address: "1 Main",
          city: "SJ",
          postalCode: "95110",
        },
      ],
    });

    expect(updateSlackModal).toHaveBeenCalledTimes(1);
    const view = updateSlackModal.mock.calls[0]?.[0]?.view as { callback_id?: string };
    expect(view.callback_id).toBe(NEW_PROJECT_CALLBACK_PICK);
  });
});
