/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  claimJobById,
  claimNextJob,
  listJobsForReport,
  listMemoryJobsForTests,
  resetMemoryJobsForTests,
} from "@/lib/jobs/queue";
import { processJob, processQueuedJobs } from "@/lib/jobs/process";
import { getReportStore, resetMemoryStoreForTests } from "@/lib/research/report-store";
import { REPORT_VERSION } from "@/lib/research/constants";
import {
  STALE_RESEARCHING_ERROR_MESSAGE,
  recoverStaleResearchingReport,
} from "@/lib/research/stale-recovery";
import { buildPreferredFacts } from "@/lib/research/select-preferred-fact";
import { FIELD_KEYS, FOUNDATION_TYPE_VERIFY_NOTE } from "@/lib/research/constants";
import { buildSiteInspectionItems } from "@/lib/research/site-inspection";
import type { SourceClaim } from "@/lib/research/schemas";
import type { FullReport } from "@/lib/research/db-types";

const USER_ID = "11111111-1111-1111-1111-111111111111";

function installTestEnv() {
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  resetEnvCacheForTests();
  resetMemoryJobsForTests();
  resetMemoryStoreForTests();
}

async function seedUserAndReport() {
  const store = getReportStore();
  await store.ensureProfile({
    id: USER_ID,
    full_name: "Test User",
    role: "user",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return store.createReport({
    createdBy: USER_ID,
    inputAddress: "655 13th St, San Jose, CA 95112",
    standardizedAddress: "655 13th St, San Jose, CA 95112",
    reportVersion: REPORT_VERSION,
  });
}

describe("property research web queue enqueue", () => {
  beforeEach(() => {
    installTestEnv();
  });

  it("enqueues, claims, and completes a property_research job without double-execution", async () => {
    const report = await seedUserAndReport();
    const { enqueuePropertyResearch } = await import("@/lib/research/enqueue");

    const first = await enqueuePropertyResearch(report.id, { source: "web" });
    expect(first.reused).toBe(false);

    const jobs = listMemoryJobsForTests().filter((j) => j.jobType === "property_research");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.reportId).toBe(report.id);
    expect(jobs[0]?.status).toBe("complete");
    expect(jobs[0]?.metadata.source).toBe("web");

    const updated = await getReportStore().getReport(report.id);
    expect(updated?.status).toBe("complete");

    // Second enqueue reuses the completed path's active-job guard after completion
    // creates no active job — a new job would be created. Simulate mid-run:
    resetMemoryJobsForTests();
    const { enqueueJob } = await import("@/lib/jobs/queue");
    const queued = await enqueueJob({
      reportId: report.id,
      jobType: "property_research",
      metadata: { source: "web" },
    });
    const claimed = await claimJobById(queued.id);
    expect(claimed?.status).toBe("running");
    const secondClaim = await claimJobById(queued.id);
    expect(secondClaim).toBeNull();
    const cronClaim = await claimNextJob({ jobTypes: ["property_research"] });
    expect(cronClaim).toBeNull();
  });

  it("recovers a simulated inline-path death via reclaim + cron without double-run", async () => {
    const report = await seedUserAndReport();
    const { enqueueJob } = await import("@/lib/jobs/queue");
    const job = await enqueueJob({
      reportId: report.id,
      jobType: "property_research",
      metadata: { source: "web" },
    });

    const claimed = await claimJobById(job.id);
    expect(claimed?.status).toBe("running");

    // Simulate process death: lock is stale, research never finished.
    const running = listMemoryJobsForTests().find((j) => j.id === job.id)!;
    const staleLock = new Date(Date.now() - 10 * 60_000).toISOString();
    (running as { lockedAt: string }).lockedAt = staleLock;
    (running as { updatedAt: string }).updatedAt = staleLock;

    const runSpy = vi.spyOn(
      await import("@/lib/research/run-property-research"),
      "runPropertyResearch",
    );

    const result = await processQueuedJobs({ limit: 5 });
    expect(result.reclaimed).toBeGreaterThanOrEqual(1);
    expect(result.completed).toBeGreaterThanOrEqual(1);
    expect(runSpy).toHaveBeenCalledTimes(1);

    const after = listMemoryJobsForTests().find((j) => j.id === job.id)!;
    expect(after.status).toBe("complete");
    expect(await getReportStore().getReport(report.id)).toMatchObject({ status: "complete" });

    runSpy.mockRestore();
  });

  it("refresh path enqueues with web_refresh source metadata", async () => {
    const parent = await seedUserAndReport();
    await getReportStore().updateReportStatus(parent.id, "complete", {
      completedAt: new Date().toISOString(),
    });

    const child = await getReportStore().createReport({
      createdBy: USER_ID,
      inputAddress: parent.input_address,
      standardizedAddress: parent.standardized_address ?? parent.input_address,
      reportVersion: REPORT_VERSION,
      parentReportId: parent.id,
      refreshReason: "Refresh live research",
    });

    const { enqueuePropertyResearch } = await import("@/lib/research/enqueue");
    const { jobId } = await enqueuePropertyResearch(child.id, {
      source: "web_refresh",
      metadata: { parentReportId: parent.id },
    });

    const job = listMemoryJobsForTests().find((j) => j.id === jobId);
    expect(job?.metadata.source).toBe("web_refresh");
    expect(job?.metadata.parentReportId).toBe(parent.id);
    expect(job?.status).toBe("complete");
  });
});

describe("stale researching report recovery", () => {
  beforeEach(() => {
    installTestEnv();
  });

  it("flips researching reports older than 30m with no live job to failed", async () => {
    const report = await seedUserAndReport();
    const startedAt = new Date(Date.now() - 45 * 60_000).toISOString();
    await getReportStore().updateReportStatus(report.id, "researching", {
      startedAt,
      errorMessage: null,
    });

    const result = await recoverStaleResearchingReport(report.id);
    expect(result.recovered).toBe(true);

    const updated = await getReportStore().getReport(report.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error_message).toBe(STALE_RESEARCHING_ERROR_MESSAGE);
  });

  it("does not fail researching reports that still have a live job", async () => {
    const report = await seedUserAndReport();
    const startedAt = new Date(Date.now() - 45 * 60_000).toISOString();
    await getReportStore().updateReportStatus(report.id, "researching", {
      startedAt,
    });

    const { enqueueJob } = await import("@/lib/jobs/queue");
    await enqueueJob({
      reportId: report.id,
      jobType: "property_research",
      metadata: { source: "web" },
    });
    // Leave job queued (active) — recovery must not flip the report.
    const active = await listJobsForReport(report.id, {
      jobTypes: ["property_research"],
      statuses: ["queued", "running"],
    });
    expect(active).toHaveLength(1);

    const result = await recoverStaleResearchingReport(report.id);
    expect(result.recovered).toBe(false);
    expect((await getReportStore().getReport(report.id))?.status).toBe("researching");
  });
});

describe("foundation type claims and UI", () => {
  it("promotes ATTOM foundationType into preferred facts", () => {
    const claims: SourceClaim[] = [
      {
        fieldKey: FIELD_KEYS.foundationType,
        sourceName: "ATTOM",
        sourceType: "licensed_property_api",
        sourceUrl: null,
        rawValue: "Concrete Slab",
        normalizedValue: "Concrete Slab",
        matchMethod: "address",
        confidence: "medium",
        retrievedAt: new Date().toISOString(),
      },
    ];
    const facts = buildPreferredFacts(claims);
    const foundation = facts.find((f) => f.fieldKey === FIELD_KEYS.foundationType);
    expect(foundation?.normalizedValueText).toBe("Concrete Slab");
    expect(foundation?.preferredSourceName).toBe("ATTOM");
    expect(FOUNDATION_TYPE_VERIFY_NOTE).toMatch(/verify on site/i);
  });

  it("omits foundation fact gracefully when ATTOM has no value", () => {
    const facts = buildPreferredFacts([]);
    expect(facts.find((f) => f.fieldKey === FIELD_KEYS.foundationType)).toBeUndefined();
  });
});

describe("Site Inspection Required items", () => {
  it("seeds utilities and easements with deep links and is props-driven", () => {
    const report = {
      id: USER_ID,
      apn: "47222019",
      property_profile_url: "https://experience.arcgis.com/example",
      maps_json: {
        assessorUrl:
          "https://asr.santaclaracounty.gov/online-services/property-search/real-property",
      },
      facts: [
        {
          id: "1",
          report_id: USER_ID,
          category: "characteristics",
          field_key: "tract_number",
          field_label: "Tract number",
          normalized_value_text: "Tract 512",
          normalized_value_number: null,
          normalized_value_boolean: null,
          unit: null,
          preferred_source_name: "ATTOM",
          preferred_source_url: null,
          confidence: "medium",
          created_at: new Date().toISOString(),
        },
        {
          id: "2",
          report_id: USER_ID,
          category: "characteristics",
          field_key: "subdivision",
          field_label: "Subdivision",
          normalized_value_text: "Hensley Addition",
          normalized_value_number: null,
          normalized_value_boolean: null,
          unit: null,
          preferred_source_name: "ATTOM",
          preferred_source_url: null,
          confidence: "medium",
          created_at: new Date().toISOString(),
        },
      ],
    } as unknown as FullReport;

    const items = buildSiteInspectionItems(report);
    expect(items.map((i) => i.id)).toEqual(["utilities", "easements-tract-maps"]);
    expect(items[0]?.title).toBe("Utilities");
    expect(items[0]?.verifySteps.length).toBeGreaterThan(0);

    const easements = items[1]!;
    expect(easements.facts?.some((f) => f.label === "APN" && f.value === "47222019")).toBe(true);
    expect(easements.facts?.some((f) => f.value === "Tract 512")).toBe(true);
    expect(easements.links?.some((l) => l.href.includes("santaclaracounty.gov"))).toBe(true);
    expect(easements.links?.some((l) => l.href.includes("experience.arcgis.com"))).toBe(true);

    // Reusability: empty items array is valid; component is props-driven.
    expect(
      buildSiteInspectionItems({ ...report, apn: null, facts: [] } as FullReport),
    ).toHaveLength(2);
  });
});

describe("processJob property_research still works for Slack-shaped jobs", () => {
  beforeEach(() => {
    installTestEnv();
  });

  it("completes a Slack-sourced property_research job via processJob", async () => {
    const report = await seedUserAndReport();
    const { enqueueJob } = await import("@/lib/jobs/queue");
    const job = await enqueueJob({
      reportId: report.id,
      jobType: "property_research",
      metadata: { source: "slack" },
    });
    const claimed = await claimJobById(job.id);
    expect(claimed).not.toBeNull();
    const result = await processJob(claimed!);
    expect(result).toBe("complete");
    expect((await getReportStore().getReport(report.id))?.status).toBe("complete");
  });
});
