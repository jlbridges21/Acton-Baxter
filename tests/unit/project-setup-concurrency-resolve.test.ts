import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { resetMemoryJobsForTests } from "@/lib/jobs/queue";
import { AppError } from "@/lib/errors";
import { runProjectSetupJob } from "@/lib/project-setup/runner";
import {
  createProjectSetupRun,
  getProjectSetupRun,
  getProjectSetupSteps,
  resetProjectSetupMemoryForTests,
  tryAcquireProjectSetupExecution,
  updateProjectSetupRun,
  updateProjectSetupStep,
} from "@/lib/project-setup/store";
import { manuallyResolveProjectSetupStep } from "@/lib/project-setup/manual-resolve";
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

vi.mock("@/lib/project-setup/notify-slack", () => ({
  notifyProjectSetupSlackInitiator: vi.fn(async () => undefined),
}));

const contact = {
  id: "c1",
  name: "Liniger",
  firstName: "L",
  lastName: "Liniger",
  email: null,
  phone: null,
  address: null,
  city: null,
  state: null,
  postalCode: null,
  assignedUserId: null,
  assignedUserName: "Rep",
};

async function seedRun(overrides?: { dryRun?: boolean; projectNumber?: string }) {
  return createProjectSetupRun({
    initiatedBy: "user-1",
    ghlContactId: "c-liniger",
    contactSnapshot: contact,
    salesRep: "Rep",
    projectNumber: overrides?.projectNumber ?? "L01-26019",
    projectLastName: "Liniger",
    folderName: "L01-26019 Liniger",
    charterName: "Liniger Project Charter",
    slackChannelName: "l01-26019-liniger",
    fpPaidDate: "2026-07-31",
    dryRun: overrides?.dryRun ?? true,
  });
}

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
  resetMemoryJobsForTests();
});

describe("project setup concurrency guard", () => {
  it("only one of two near-simultaneous executions performs steps", async () => {
    const { run } = await seedRun();

    const [a, b] = await Promise.all([runProjectSetupJob(run.id), runProjectSetupJob(run.id)]);

    const results = [a, b];
    const busy = results.filter((r) => r.skippedBusy);
    const executed = results.filter((r) => !r.skippedBusy);

    expect(busy).toHaveLength(1);
    expect(executed).toHaveLength(1);
    expect(executed[0]?.status).toBe("complete");
    expect(executed[0]?.completedSteps).toBe(PROJECT_SETUP_STEPS.length);
    expect(busy[0]?.completedSteps).toBe(0);

    const final = await getProjectSetupRun(run.id);
    expect(final?.status).toBe("complete");
  });

  it("second caller no-ops cleanly while a lock is already held", async () => {
    const { run } = await seedRun({ projectNumber: "L01-26020" });
    const held = await tryAcquireProjectSetupExecution(run.id);
    expect(held.acquired).toBe(true);

    const result = await runProjectSetupJob(run.id);
    expect(result.skippedBusy).toBe(true);
    expect(result.completedSteps).toBe(0);

    const steps = await getProjectSetupSteps(run.id);
    expect(steps.every((s) => s.status === "pending")).toBe(true);
  });
});

describe("manual step resolution", () => {
  it("rejects resolving a dependent step without required outputs", async () => {
    const { run } = await seedRun({ projectNumber: "L01-26021" });
    await updateProjectSetupRun(run.id, {
      status: "failed",
      error: "Folder copy verification failed",
    });
    const steps = await getProjectSetupSteps(run.id);
    const folder = steps.find((s) => s.stepKey === "copy_template_folder")!;
    await updateProjectSetupStep(folder.id, {
      status: "failed",
      error: "Folder copy verification failed",
      finishedAt: new Date().toISOString(),
    });

    await expect(
      manuallyResolveProjectSetupStep({
        runId: run.id,
        stepId: folder.id,
        note: "cleaned up duplicates in Drive",
        outputs: {},
        resolvedBy: "admin-1",
        resolvedByEmail: "admin@actonadu.com",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("resolves a terminal step with note only and resumes", async () => {
    const { run } = await seedRun({ projectNumber: "L01-26022" });
    // Complete all but last step
    const steps = await getProjectSetupSteps(run.id);
    for (const step of steps) {
      if (step.stepKey === "post_kickoff_message") {
        await updateProjectSetupStep(step.id, {
          status: "failed",
          error: "Slack post failed",
          finishedAt: new Date().toISOString(),
        });
      } else {
        await updateProjectSetupStep(step.id, {
          status: "complete",
          outputJson: {
            mode: "live",
            executed: true,
            ...(step.stepKey === "create_slack_channel"
              ? { channelId: "C_MANUAL" }
              : step.stepKey === "allocate_project_number"
                ? { projectNumber: "L01-26022" }
                : {}),
          },
          finishedAt: new Date().toISOString(),
        });
      }
    }
    await updateProjectSetupRun(run.id, {
      status: "failed",
      error: "Slack post failed",
      projectNumber: "L01-26022",
    });

    const kickoff = (await getProjectSetupSteps(run.id)).find(
      (s) => s.stepKey === "post_kickoff_message",
    )!;

    const result = await manuallyResolveProjectSetupStep({
      runId: run.id,
      stepId: kickoff.id,
      note: "Confirmed kickoff was posted manually in Slack",
      resolvedBy: "admin-1",
      resolvedByEmail: "admin@actonadu.com",
    });

    expect(result.jobId).toBeTruthy();
    const after = await getProjectSetupSteps(run.id);
    const resolved = after.find((s) => s.stepKey === "post_kickoff_message")!;
    expect(resolved.status).toBe("complete");
    expect(resolved.outputJson.manuallyResolved).toBe(true);
    expect((resolved.outputJson.manualResolution as { note?: string } | undefined)?.note).toMatch(
      /kickoff was posted/,
    );

    const finalRun = await getProjectSetupRun(run.id);
    // enqueue runs immediately in memory store → should complete (gates off → planned/complete)
    expect(["confirmed", "running", "complete"]).toContain(finalRun?.status ?? "");
  });

  it("resolves copy_template_folder with destination id and feeds downstream priorOutputs", async () => {
    const { run } = await seedRun({ projectNumber: "L01-26023" });
    const steps = await getProjectSetupSteps(run.id);
    for (const step of steps) {
      if (step.stepKey === "allocate_project_number" || step.stepKey === "append_master_log_row") {
        await updateProjectSetupStep(step.id, {
          status: "complete",
          outputJson: {
            mode: "live",
            projectNumber: "L01-26023",
            executed: true,
          },
          finishedAt: new Date().toISOString(),
        });
      } else if (step.stepKey === "copy_template_folder") {
        await updateProjectSetupStep(step.id, {
          status: "failed",
          error: "verification failed",
          finishedAt: new Date().toISOString(),
        });
      }
    }
    await updateProjectSetupRun(run.id, {
      status: "failed",
      error: "verification failed",
      projectNumber: "L01-26023",
    });

    const folder = (await getProjectSetupSteps(run.id)).find(
      (s) => s.stepKey === "copy_template_folder",
    )!;

    await manuallyResolveProjectSetupStep({
      runId: run.id,
      stepId: folder.id,
      note: "confirmed folder exists in Drive, removed duplicates, folder id is dest-keep",
      outputs: {
        destinationFolderId: "dest-keep",
        webViewLink: "https://drive.google.com/drive/folders/dest-keep",
      },
      resolvedBy: "admin-1",
    });

    const after = await getProjectSetupSteps(run.id);
    const resolved = after.find((s) => s.stepKey === "copy_template_folder")!;
    expect(resolved.status).toBe("complete");
    expect(resolved.outputJson.destinationFolderId).toBe("dest-keep");

    // Resume should pick up later steps as planned (google writes off)
    const final = await getProjectSetupRun(run.id);
    expect(final?.status).toBe("complete");
    const charter = after.find((s) => s.stepKey === "copy_charter_spreadsheet");
    // After enqueue+run, charter should no longer be pending
    const refreshed = await getProjectSetupSteps(run.id);
    const charterAfter = refreshed.find((s) => s.stepKey === "copy_charter_spreadsheet");
    expect(charterAfter?.status).toBe("planned");
    expect(charter).toBeDefined();
  });

  it("is refused for non-failed runs", async () => {
    const { run } = await seedRun({ projectNumber: "L01-26024" });
    const steps = await getProjectSetupSteps(run.id);
    await expect(
      manuallyResolveProjectSetupStep({
        runId: run.id,
        stepId: steps[0]!.id,
        note: "should not work on confirmed run",
        resolvedBy: "admin-1",
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("resolve-step API admin gate", () => {
  it("rejects non-admin callers", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/session", () => ({
      requireActiveUser: vi.fn(async () => ({
        id: "user-1",
        email: "employee@actonadu.com",
        profile: { role: "user" },
      })),
    }));
    const { POST } = await import("@/app/api/projects/setup/[runId]/resolve-step/route");
    const response = await POST(
      new Request("http://localhost/api/projects/setup/run-1/resolve-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: "step-1",
          note: "employee should not be able to do this",
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );
    expect(response.status).toBe(403);
  });
});
