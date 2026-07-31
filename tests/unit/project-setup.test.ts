import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  buildDerivedProjectNames,
  isActonEmail,
  resolveInviteMemberEmails,
  sanitizeSlackChannelSegment,
} from "@/lib/project-setup/names";
import {
  computeNextProjectNumberFromColumnA,
  incrementProjectNumber,
  lastNonEmptyColumnAValue,
  parseProjectNumber,
} from "@/lib/project-setup/project-number";
import { nextPendingStep, runProjectSetupJob } from "@/lib/project-setup/runner";
import {
  createProjectSetupRun,
  isProjectNumberInUse,
  resetProjectSetupMemoryForTests,
  updateProjectSetupSettings,
  updateProjectSetupStep,
  updateProjectSetupRun,
  getProjectSetupSteps,
} from "@/lib/project-setup/store";
import { validateSettingsEmails } from "@/lib/project-setup/validation";
import { googleWritesEnabled, slackProvisioningEnabled } from "@/lib/project-setup/capabilities";
import { PROJECT_SETUP_STEPS } from "@/lib/project-setup/steps";

vi.mock("@/lib/project-setup/sheets", () => ({
  readSheetColumnA: vi.fn(async () => [["L01-26017"]]),
}));

vi.mock("@/lib/project-setup/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/project-setup/capabilities")>();
  return {
    ...actual,
    googleWritesEnabled: vi.fn(async () => false),
    slackProvisioningEnabled: () => false,
  };
});

beforeEach(() => {
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  resetEnvCacheForTests();
  resetProjectSetupMemoryForTests();
});

describe("project number parse / increment", () => {
  it("parses and increments normally", () => {
    expect(parseProjectNumber("l01-26017")).toEqual({
      raw: "L01-26017",
      prefix: "L01",
      numeric: 26017,
      year: 26,
      seq: 17,
    });
    expect(incrementProjectNumber("L01-26017")).toBe("L01-26018");
  });

  it("rejects malformed values", () => {
    expect(parseProjectNumber("L1-26017")).toBeNull();
    expect(parseProjectNumber("L01-2601")).toBeNull();
    expect(parseProjectNumber("hello")).toBeNull();
    expect(() => incrementProjectNumber("bad")).toThrow(/Could not parse/);
  });

  it("computes next from column A and fails clearly on bad last cell", () => {
    const ok = computeNextProjectNumberFromColumnA([["L01-26016"], ["L01-26017"], [""]], {
      referenceYear: 26,
    });
    expect(ok).toEqual({
      nextNumber: "L01-26018",
      sourceValue: "L01-26017",
      sourceRowIndex: 2,
      rolledOver: false,
    });
    expect(() => computeNextProjectNumberFromColumnA([["not-a-number"]])).toThrow(
      /not in the expected format/,
    );
    expect(() => computeNextProjectNumberFromColumnA([[], [""]])).toThrow(/empty/);
  });

  it("rolls over year when FP paid year is newer", () => {
    const next = computeNextProjectNumberFromColumnA([["L01-26017"]], { referenceYear: 27 });
    expect(next.nextNumber).toBe("L01-27001");
    expect(next.rolledOver).toBe(true);
  });

  it("finds last non-empty column A value", () => {
    expect(lastNonEmptyColumnAValue([["a"], [""], ["b"], [""]])).toEqual({
      value: "b",
      rowIndex: 3,
    });
  });
});

describe("derived names + Slack sanitize", () => {
  it("builds folder, charter, and channel names", () => {
    const names = buildDerivedProjectNames({
      projectNumber: "L01-26018",
      lastName: "O'Brien-Smith",
    });
    expect(names.folderName).toBe("L01-26018 OBrien-Smith");
    expect(names.charterName).toBe("OBrien-Smith Project Charter");
    expect(names.slackChannelName).toBe("l01-26018-obrien-smith");
  });

  it("sanitizes apostrophes, spaces, unicode, and long names", () => {
    expect(sanitizeSlackChannelSegment("L01-26018 José García")).toBe("l01-26018-jose-garcia");
    expect(sanitizeSlackChannelSegment("Foo!!! Bar")).toBe("foo-bar");
    const long = sanitizeSlackChannelSegment(`L01-26018 ${"x".repeat(200)}`);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("test-mode member resolution + settings validation", () => {
  it("resolves test members when test mode is on", () => {
    const test = resolveInviteMemberEmails({
      testMode: true,
      memberEmails: ["ally.moin@actonadu.com"],
      testMemberEmails: ["jackson.bridges@actonadu.com"],
    });
    expect(test.emails).toEqual(["jackson.bridges@actonadu.com"]);
    expect(test.label).toMatch(/TEST MODE/);

    const live = resolveInviteMemberEmails({
      testMode: false,
      memberEmails: ["ally.moin@actonadu.com", "aws.jabir@actonadu.com"],
      testMemberEmails: ["jackson.bridges@actonadu.com"],
    });
    expect(live.emails).toHaveLength(2);
    expect(live.testMode).toBe(false);
  });

  it("warns on non-acton emails without hard-blocking", () => {
    expect(isActonEmail("jackson.bridges@actonadu.com")).toBe(true);
    expect(isActonEmail("someone@gmail.com")).toBe(false);
    const warnings = validateSettingsEmails({
      memberEmails: ["ally.moin@actonadu.com", "vendor@example.com"],
      testMemberEmails: ["ok@actonadu.com"],
    });
    expect(warnings.nonActonMemberEmails).toEqual(["vendor@example.com"]);
    expect(warnings.nonActonTestMemberEmails).toEqual([]);
  });

  it("persists settings in memory store", async () => {
    const updated = await updateProjectSetupSettings(
      { testMode: false, testMemberEmails: ["milan.romic@actonadu.com"] },
      "user-1",
    );
    expect(updated.testMode).toBe(false);
    expect(updated.testMemberEmails).toEqual(["milan.romic@actonadu.com"]);
  });
});

describe("capabilities gates", () => {
  it("keeps Slack provisioning off", () => {
    expect(slackProvisioningEnabled()).toBe(false);
  });

  it("googleWritesEnabled is async and mocked off in these tests", async () => {
    expect(await googleWritesEnabled()).toBe(false);
  });
});

describe("step runner resume + idempotency", () => {
  it("nextPendingStep skips complete steps", () => {
    expect(
      nextPendingStep([
        { stepKey: "allocate_project_number", orderIndex: 0, status: "complete" },
        { stepKey: "append_master_log_row", orderIndex: 1, status: "failed" },
        { stepKey: "copy_template_folder", orderIndex: 2, status: "pending" },
      ]),
    ).toBe("append_master_log_row");
  });

  it("runs dry-run end-to-end and resumes without re-executing complete steps", async () => {
    const contact = {
      id: "c1",
      name: "Pat Example",
      firstName: "Pat",
      lastName: "Example",
      email: "pat@example.com",
      phone: null,
      address: "1 Main St",
      city: "San Jose",
      state: "CA",
      postalCode: "95110",
      assignedUserId: null,
      assignedUserName: "Jesse Soares",
    };

    const { run } = await createProjectSetupRun({
      initiatedBy: "user-1",
      ghlContactId: "c1",
      contactSnapshot: contact,
      salesRep: "Jesse Soares",
      projectNumber: "L01-26099",
      projectLastName: "Example",
      folderName: "L01-26099 Example",
      charterName: "Example Project Charter",
      slackChannelName: "l01-26099-example",
      fpPaidDate: "2026-07-31",
      dryRun: true,
    });

    expect(await isProjectNumberInUse("L01-26099")).toBe(true);

    const first = await runProjectSetupJob(run.id);
    expect(first.status).toBe("complete");
    expect(first.completedSteps).toBe(PROJECT_SETUP_STEPS.length);

    const steps = await getProjectSetupSteps(run.id);
    expect(steps.every((s) => s.status === "complete")).toBe(true);
    const slackStep = steps.find((s) => s.stepKey === "create_slack_channel");
    expect(slackStep?.outputJson.planned).toMatchObject({
      channelName: "l01-26099-example",
      testMode: true,
    });
    expect(slackStep?.outputJson.executed).toBe(false);

    // Mark last step pending again and ensure earlier steps stay complete on resume.
    const last = steps[steps.length - 1]!;
    await updateProjectSetupStep(last.id, { status: "pending", outputJson: {}, finishedAt: null });
    await updateProjectSetupRun(run.id, { status: "confirmed", finishedAt: null });

    const second = await runProjectSetupJob(run.id);
    expect(second.status).toBe("complete");
    const after = await getProjectSetupSteps(run.id);
    expect(after.filter((s) => s.status === "complete")).toHaveLength(PROJECT_SETUP_STEPS.length);
    // First step still has allocate output (not wiped)
    expect(after[0]?.outputJson.projectNumber).toBe("L01-26099");
  });

  it("rejects uniqueness conflicts for active numbers", async () => {
    const base = {
      initiatedBy: "user-1",
      ghlContactId: "c1",
      contactSnapshot: {
        id: "c1",
        name: "A",
        firstName: "A",
        lastName: "B",
        email: null,
        phone: null,
        address: null,
        city: null,
        state: null,
        postalCode: null,
        assignedUserId: null,
        assignedUserName: null,
      },
      salesRep: "Rep",
      projectNumber: "L01-26100",
      projectLastName: "B",
      folderName: "L01-26100 B",
      charterName: "B Project Charter",
      slackChannelName: "l01-26100-b",
      fpPaidDate: "2026-07-31",
    };
    await createProjectSetupRun(base);
    await expect(createProjectSetupRun({ ...base, ghlContactId: "c2" })).rejects.toThrow(
      /already in use/,
    );
  });
});
