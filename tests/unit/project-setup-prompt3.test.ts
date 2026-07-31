import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  buildCharterListRowValues,
  charterListAlreadyHasCharter,
} from "@/lib/project-setup/charter-list";
import { buildKickoffMessageText } from "@/lib/project-setup/steps";
import { formatProjectSetupStepStatus } from "@/lib/project-setup/step-status";
import {
  buildConfirmModal,
  buildPickModal,
  buildSearchModal,
  decodeModalMeta,
  encodeModalMeta,
  NEW_PROJECT_CALLBACK_CONFIRM,
  NEW_PROJECT_CALLBACK_PICK,
  NEW_PROJECT_CALLBACK_SEARCH,
} from "@/lib/project-setup/new-project-views";
import { handleNewProjectViewSubmission } from "@/lib/project-setup/new-project-slack";

const createPublicSlackChannel = vi.fn();
const lookupSlackUserByEmail = vi.fn();
const inviteUsersToSlackChannel = vi.fn();
const postSlackMessage = vi.fn();
const openSlackModal = vi.fn();
const updateSlackModal = vi.fn();
const openSlackDm = vi.fn();

vi.mock("@/lib/slack/provisioning", () => ({
  createPublicSlackChannel: (...args: unknown[]) => createPublicSlackChannel(...args),
  lookupSlackUserByEmail: (...args: unknown[]) => lookupSlackUserByEmail(...args),
  inviteUsersToSlackChannel: (...args: unknown[]) => inviteUsersToSlackChannel(...args),
  openSlackModal: (...args: unknown[]) => openSlackModal(...args),
  updateSlackModal: (...args: unknown[]) => updateSlackModal(...args),
  openSlackDm: (...args: unknown[]) => openSlackDm(...args),
}));

vi.mock("@/lib/slack/client", () => ({
  postSlackMessage: (...args: unknown[]) => postSlackMessage(...args),
}));

vi.mock("@/lib/project-setup/service", () => ({
  searchProjectSetupContacts: vi.fn(async () => [
    {
      id: "c1",
      name: "Lisa Wright",
      email: "lisa@example.com",
      phone: "555",
      address: "1 Main",
      city: "SJ",
      postalCode: "95110",
    },
  ]),
  loadProjectSetupContactSnapshot: vi.fn(async () => ({
    id: "c1",
    name: "Lisa Wright",
    firstName: "Lisa",
    lastName: "Wright",
    email: "lisa@example.com",
    phone: "555",
    address: "1 Main",
    city: "San Jose",
    state: "CA",
    postalCode: "95110",
    assignedUserId: "u1",
    assignedUserName: "Jesse Soares",
  })),
  buildProjectSetupPreview: vi.fn(async () => ({
    contact: { id: "c1", name: "Lisa Wright", lastName: "Wright" },
    salesRep: "Jesse Soares",
    fpPaidDate: "2026-07-31",
    projectNumber: "L01-26020",
    projectLastName: "Wright",
    folderName: "L01-26020 Wright",
    charterName: "Wright Project Charter",
    slackChannelName: "l01-26020-wright",
    inviteLabel: "TEST MODE — only jackson.bridges@actonadu.com will be invited",
    inviteEmails: ["jackson.bridges@actonadu.com"],
    testMode: true,
    googleWritesEnabled: true,
    dryRunDefault: false,
  })),
}));

vi.mock("@/lib/project-setup/capabilities", () => ({
  googleWritesEnabled: vi.fn(async () => true),
  slackProvisioningEnabled: () => true,
}));

vi.mock("@/lib/project-setup/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/project-setup/store")>();
  return {
    ...actual,
    createProjectSetupRun: vi.fn(async () => ({
      run: { id: "run-1", projectNumber: "L01-26020" },
      steps: [],
    })),
    updateProjectSetupStep: vi.fn(async () => ({ id: "step-1" })),
  };
});

vi.mock("@/lib/project-setup/enqueue", () => ({
  enqueueProjectSetupRun: vi.fn(async () => ({ jobId: "job-1" })),
}));

vi.mock("@/lib/slack/identity", () => ({
  resolveBaxterUserForSlackIdentity: vi.fn(async () => ({
    userId: "baxter-user-1",
    displayName: "Jackson",
    matchedVia: "email",
  })),
}));

vi.mock("@/lib/slack/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/slack/config")>();
  return {
    ...actual,
    isSlackUserAllowed: () => true,
    getPublicAppBaseUrl: () => "https://acton-baxter.vercel.app",
  };
});

beforeEach(() => {
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  process.env.ENABLE_SLACK_INTEGRATION = "true";
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.APP_BASE_URL = "https://acton-baxter.vercel.app";
  resetEnvCacheForTests();
  vi.clearAllMocks();
  openSlackDm.mockResolvedValue({ channelId: "D123" });
  postSlackMessage.mockResolvedValue({ ok: true, ts: "1.2" });
});

describe("planned status labels", () => {
  it("renders planned distinctly from complete", () => {
    expect(formatProjectSetupStepStatus("planned")).toBe("Planned — not executed");
    expect(formatProjectSetupStepStatus("complete")).toBe("Complete");
  });
});

describe("charter list row builder", () => {
  it("builds HYPERLINK formula and detects already-present rows", () => {
    const values = buildCharterListRowValues({
      charterName: 'Wright "Test" Project Charter',
      webViewLink: "https://docs.google.com/spreadsheets/d/FILE123/edit",
    });
    expect(values[0]).toContain("=HYPERLINK(");
    expect(values[0]).toContain("FILE123");
    expect(values[0]).toContain('Wright ""Test"" Project Charter');

    expect(
      charterListAlreadyHasCharter([['=HYPERLINK("https://docs.google.com/d/FILE123","x")']], {
        fileId: "FILE123",
        webViewLink: "https://docs.google.com/spreadsheets/d/FILE123/edit",
      }),
    ).toBe(true);
    expect(
      charterListAlreadyHasCharter([["other"]], {
        fileId: "FILE123",
        webViewLink: "https://docs.google.com/spreadsheets/d/FILE123/edit",
      }),
    ).toBe(false);
  });
});

describe("kickoff message", () => {
  it("formats Slack mrkdwn links", () => {
    const text = buildKickoffMessageText({
      projectNumber: "L01-26020",
      projectLastName: "Wright",
      folderName: "L01-26020 Wright",
      charterName: "Wright Project Charter",
      folderLink: "https://drive.google.com/folder",
      charterLink: "https://docs.google.com/charter",
    });
    expect(text).toContain("New project L01-26020 — Wright");
    expect(text).toContain("<https://drive.google.com/folder|L01-26020 Wright>");
    expect(text).toContain("<https://docs.google.com/charter|Wright Project Charter>");
    expect(text).toContain("Setting up BuilderTrend now.");
  });
});

describe("Slack channel + invite paths", () => {
  it("reuses recorded channel id and treats name_taken without prior attempt as failure", async () => {
    const { PROJECT_SETUP_STEPS } = await import("@/lib/project-setup/steps");
    const createStep = PROJECT_SETUP_STEPS.find((s) => s.key === "create_slack_channel")!;

    createPublicSlackChannel.mockResolvedValueOnce({
      channelId: "",
      name: "l01-26020-wright",
      alreadyExistsError: "name_taken",
    });

    const baseCtx = {
      run: {
        id: "run-1",
        dryRun: false,
        slackChannelName: "l01-26020-wright",
        projectNumber: "L01-26020",
        projectLastName: "Wright",
        contactSnapshot: { name: "Lisa" },
      },
      settings: {
        testMode: true,
        memberEmails: ["ally.moin@actonadu.com"],
        testMemberEmails: ["jackson.bridges@actonadu.com"],
      },
      priorOutputs: {},
      stepId: "step-1",
      partialOutput: {},
    };

    await expect(createStep.execute(baseCtx as never)).rejects.toThrow(/name_taken|already exists/);

    // Resume with prior channel id
    createPublicSlackChannel.mockClear();
    lookupSlackUserByEmail.mockResolvedValue({ userId: "U1" });
    inviteUsersToSlackChannel.mockResolvedValue({
      results: [{ email: "jackson.bridges@actonadu.com", status: "invited", userId: "U1" }],
      successCount: 1,
    });

    const resumed = await createStep.execute({
      ...baseCtx,
      partialOutput: { channelId: "CEXIST" },
    } as never);
    expect(createPublicSlackChannel).not.toHaveBeenCalled();
    expect(resumed.outputJson.channelId).toBe("CEXIST");
    expect(resumed.outputJson.inviteSuccessCount).toBe(1);
  });

  it("records invite warnings and fails when zero invites succeed", async () => {
    const { PROJECT_SETUP_STEPS } = await import("@/lib/project-setup/steps");
    const createStep = PROJECT_SETUP_STEPS.find((s) => s.key === "create_slack_channel")!;
    createPublicSlackChannel.mockResolvedValue({ channelId: "CNEW", name: "l01-26020-wright" });
    lookupSlackUserByEmail.mockResolvedValue({ notFound: true });
    inviteUsersToSlackChannel.mockResolvedValue({ results: [], successCount: 0 });

    await expect(
      createStep.execute({
        run: {
          id: "run-1",
          dryRun: false,
          slackChannelName: "l01-26020-wright",
          projectNumber: "L01-26020",
          projectLastName: "Wright",
          contactSnapshot: { name: "Lisa" },
        },
        settings: {
          testMode: true,
          memberEmails: [],
          testMemberEmails: ["missing@actonadu.com"],
        },
        priorOutputs: {},
        stepId: "step-1",
        partialOutput: {},
      } as never),
    ).rejects.toThrow(/could not invite any members/i);
  });

  it("skips kickoff repost when messageTs already recorded", async () => {
    const { PROJECT_SETUP_STEPS } = await import("@/lib/project-setup/steps");
    const kickoff = PROJECT_SETUP_STEPS.find((s) => s.key === "post_kickoff_message")!;
    const result = await kickoff.execute({
      run: {
        id: "run-1",
        dryRun: false,
        projectNumber: "L01-26020",
        projectLastName: "Wright",
        folderName: "L01-26020 Wright",
        charterName: "Wright Project Charter",
        slackChannelName: "l01-26020-wright",
        contactSnapshot: { name: "Lisa" },
      },
      settings: { testMode: true, memberEmails: [], testMemberEmails: [] },
      priorOutputs: {
        create_slack_channel: { channelId: "C1" },
        copy_template_folder: { webViewLink: "https://drive/x" },
        copy_charter_spreadsheet: { webViewLink: "https://docs/y" },
      },
      stepId: "step-2",
      partialOutput: { messageTs: "99.1" },
    } as never);
    expect(result.outputJson.alreadyPresent).toBe(true);
    expect(postSlackMessage).not.toHaveBeenCalled();
  });
});

describe("new-project modal views + view_submission", () => {
  it("builds search/pick/confirm modals with callbacks and prefill", () => {
    const meta = { slackUserId: "U1", slackTeamId: "T1" };
    const search = buildSearchModal({ prefill: "Lisa Wright", meta });
    expect(search.callback_id).toBe(NEW_PROJECT_CALLBACK_SEARCH);
    expect(JSON.stringify(search)).toContain("Lisa Wright");

    const pick = buildPickModal({
      meta,
      hits: [
        {
          id: "c1",
          name: "Lisa Wright",
          email: "a@b.com",
          phone: null,
          address: null,
          city: null,
          postalCode: null,
        },
      ],
    });
    expect(pick.callback_id).toBe(NEW_PROJECT_CALLBACK_PICK);

    const confirm = buildConfirmModal({
      meta: { ...meta, contactId: "c1" },
      contactName: "Lisa Wright",
      email: "a@b.com",
      phone: null,
      address: null,
      salesRep: "Jesse",
      projectNumber: "L01-26020",
      folderName: "L01-26020 Wright",
      charterName: "Wright Project Charter",
      slackChannelName: "l01-26020-wright",
      inviteLabel: "TEST MODE — only jackson.bridges@actonadu.com will be invited",
      fpPaidDate: "2026-07-31",
    });
    expect(confirm.callback_id).toBe(NEW_PROJECT_CALLBACK_CONFIRM);
    expect(decodeModalMeta(encodeModalMeta(meta))?.slackUserId).toBe("U1");
  });

  it("search submission returns loading update and schedules GHL search", async () => {
    const scheduled: Array<() => Promise<void>> = [];
    const response = await handleNewProjectViewSubmission(
      {
        type: "view_submission",
        user: { id: "U1" },
        team: { id: "T1" },
        view: {
          id: "V1",
          callback_id: NEW_PROJECT_CALLBACK_SEARCH,
          private_metadata: encodeModalMeta({ slackUserId: "U1", slackTeamId: "T1" }),
          state: {
            values: {
              customer_name: { customer_name_input: { value: "Lisa Wright" } },
            },
          },
        },
      },
      (work) => {
        scheduled.push(work);
      },
    );
    expect(response.response_action).toBe("update");
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    expect(updateSlackModal).toHaveBeenCalled();
  });

  it("confirm submission clears modal and schedules live run create", async () => {
    const { createProjectSetupRun } = await import("@/lib/project-setup/store");
    const { enqueueProjectSetupRun } = await import("@/lib/project-setup/enqueue");
    const scheduled: Array<() => Promise<void>> = [];
    const response = await handleNewProjectViewSubmission(
      {
        type: "view_submission",
        user: { id: "U1" },
        team: { id: "T1" },
        view: {
          id: "V1",
          callback_id: NEW_PROJECT_CALLBACK_CONFIRM,
          private_metadata: encodeModalMeta({
            slackUserId: "U1",
            slackTeamId: "T1",
            contactId: "c1",
          }),
        },
      },
      (work) => {
        scheduled.push(work);
      },
    );
    expect(response).toEqual({ response_action: "clear" });
    await scheduled[0]!();
    expect(createProjectSetupRun).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: false,
        triggerChannel: "slack",
        slackInitiatorId: "U1",
      }),
    );
    expect(enqueueProjectSetupRun).toHaveBeenCalledWith("run-1");
    expect(postSlackMessage).toHaveBeenCalled();
  });
});

describe("migration 032 SQL", () => {
  it("excludes dry_run from the active project_number unique index", async () => {
    const fs = await import("node:fs/promises");
    const sql = await fs.readFile(
      new URL("../../supabase/migrations/032_project_setup_slack.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toMatch(/dry_run = false/);
    expect(sql).toMatch(/planned/);
    expect(sql).toMatch(/charter_list_tab_name/);
  });
});
