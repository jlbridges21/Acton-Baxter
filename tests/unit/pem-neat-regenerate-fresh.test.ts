/**
 * Regenerate must not silently reuse a completed run's stage outputs (prompt/transcript changes
 * would never apply). Stage outputs only resume a failed run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/jobs/queue", () => ({
  usesMemoryJobStore: () => false,
  enqueueJob: vi.fn(async () => ({ id: "job-1" })),
}));

import { resetEnvCacheForTests } from "@/lib/env";
import { buildMockPemNeatResult } from "@/lib/pem-neat/mock-result";
import { startPemNeatGeneration } from "@/lib/pem-neat/run-generation";
import { getPemNeatStore, resetPemNeatMemoryStoreForTests } from "@/lib/pem-neat/store";

const SALES_ID = "00000000-0000-4000-8000-000000000099";
const CACHED = { salesIntelligenceStage: { cached: true }, schemaVersion: 3 };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetPemNeatMemoryStoreForTests();
});

async function createRecord() {
  return getPemNeatStore().create({
    prospectName: "Pat Homeowner",
    salespersonUserId: SALES_ID,
    salespersonDisplayName: "Alex Sales",
    meetingDate: "2026-10-13",
    transcript: "Advisor: Purpose today is fit. Prospect: We need an ADU. ".repeat(40),
    createdBy: SALES_ID,
  });
}

describe("startPemNeatGeneration stage-output reuse", () => {
  it("starts fresh when regenerating a completed NEAT", async () => {
    const store = getPemNeatStore();
    const record = await createRecord();
    const mock = buildMockPemNeatResult({
      prospectName: "Pat Homeowner",
      advisorName: "Alex Sales",
      meetingDate: "2026-10-13",
    });
    await store.saveGenerationSuccess(record.id, {
      structuredResult: mock,
      buildertrendFields: mock.buildertrendFields,
      analysisMetadata: mock.analysisMetadata,
      meetingOutcome: mock.salesIntelligence.meetingOutcome.classification,
      qualification: mock.salesIntelligence.qualification.classification,
      modelProvider: "mock",
      modelName: "mock-pem-neat",
      latencyMs: 5,
      neatStandardVersion: "1.0.0",
      transcriptHash: record.transcript_hash,
      stageOutputs: CACHED,
    });

    await startPemNeatGeneration(record.id);
    const after = await store.get(record.id);
    expect(after?.stage_outputs_json).toEqual({});
  });

  it("resumes stage outputs when retrying a failed NEAT", async () => {
    const store = getPemNeatStore();
    const record = await createRecord();
    await store.saveGenerationFailure(record.id, {
      errorMessage: "boom",
      stageOutputs: CACHED,
    });
    expect((await store.get(record.id))?.status).toBe("failed");

    await startPemNeatGeneration(record.id);
    const after = await store.get(record.id);
    expect(after?.stage_outputs_json).toEqual(CACHED);
  });
});
