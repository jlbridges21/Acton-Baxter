import { describe, expect, it, beforeEach } from "vitest";
import { ASSESSMENT_CATEGORY_KEYS } from "@/lib/pem-neat/constants";
import { BUILDERTREND_FIELD_DEFS } from "@/lib/pem-neat/buildertrend-display";
import {
  emptyPemNeatShell,
  mergeAssessmentCategories,
  mergeBuildertrendFields,
} from "@/lib/pem-neat/defaults";
import { generatePemNeat } from "@/lib/pem-neat/generate";
import { buildMockPemNeatResult } from "@/lib/pem-neat/mock-result";
import { parsePemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import {
  getPemNeatStore,
  hashTranscript,
  resetPemNeatMemoryStoreForTests,
} from "@/lib/pem-neat/store";
import { chunkTranscript } from "@/lib/pem-neat/transcript";
import { getAdminNavLinks } from "@/lib/baxter/admin-nav";

const SAMPLE_TRANSCRIPT = `
Advisor: Thanks for meeting — today's purpose is to see if we're a good fit to help with an ADU for your parent.
Prospect: Mom is increasingly vulnerable living alone. We want her nearby but independent. Our working budget is about $400,000 all-in. Another builder said around $380,000. We need to talk to my spouse and reconnect in two weeks. Previously a contractor stopped communicating and costs jumped. Schedule: we'd like to start this year if possible.
Advisor: Great — I'll follow up after you speak with your spouse.
`.repeat(3);

describe("PEM NEAT Prompt 3 nav", () => {
  it("replaces Diagnostics with PEM NEAT in admin nav", () => {
    const links = getAdminNavLinks();
    expect(links.some((l) => l.label === "Diagnostics")).toBe(false);
    const pem = links.find((l) => l.label === "PEM NEAT");
    expect(pem?.href).toBe("/pem-neats");
  });
});

describe("PEM NEAT defaults and merge", () => {
  it("creates shell with 12 categories and all BuilderTrend keys", () => {
    const shell = emptyPemNeatShell({
      prospectName: "Betsy",
      advisorName: "Jesse",
    });
    expect(shell.assessment.categories).toHaveLength(12);
    expect(BUILDERTREND_FIELD_DEFS).toHaveLength(31);
    for (const def of BUILDERTREND_FIELD_DEFS) {
      expect(shell.buildertrendFields).toHaveProperty(def.key);
    }
    const parsed = parsePemNeatStructuredResult(shell);
    expect(parsed.assessment.categories).toHaveLength(12);
  });

  it("fills omitted assessment categories as NOT_DETERMINABLE", () => {
    const merged = mergeAssessmentCategories([
      {
        key: "bonding_rapport",
        label: "Bonding",
        score: 8,
        status: "COMPLETED",
        evidence: "Warm open",
        whatWorked: null,
        coachingOpportunity: null,
        timestamps: [],
      },
    ]);
    expect(merged).toHaveLength(12);
    expect(merged.find((c) => c.key === "budget")?.status).toBe("NOT_DETERMINABLE");
    expect(ASSESSMENT_CATEGORY_KEYS.every((k) => merged.some((c) => c.key === k))).toBe(true);
  });

  it("defaults missing BuilderTrend fields without failing", () => {
    const fields = mergeBuildertrendFields({ customerBudget: 250000 });
    expect(fields.customerBudget).toBe(250000);
    expect(fields.preferredContactMethod).toBeNull();
    expect(fields.customerPriorities).toEqual([]);
  });
});

describe("PEM NEAT chunking", () => {
  it("does not use head-tail-only for long transcripts", () => {
    const long = [
      "PALO beginning purpose agenda",
      "middle filler paragraph\n\n".repeat(2500),
      "MIDDLE budget $300k then later $400k",
      "more filler paragraph\n\n".repeat(2500),
      "END outcome yes post-sell commitments",
    ].join("\n\n");
    const chunks = chunkTranscript(long);
    expect(chunks.length).toBeGreaterThan(1);
    const joined = chunks.map((c) => c.text).join("\n");
    expect(joined).toContain("PALO beginning");
    expect(joined).toContain("MIDDLE budget");
    expect(joined).toContain("END outcome");
  });
});

describe("PEM NEAT edit delete stale", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetPemNeatMemoryStoreForTests();
  });

  it("marks transcript edits as needs_regeneration and preserves prior generation", async () => {
    const store = getPemNeatStore();
    const created = await store.create({
      prospectName: "Betsy Smith",
      salespersonUserId: "00000000-0000-4000-8000-000000000001",
      salespersonDisplayName: "Jesse",
      meetingDate: "2026-07-01",
      transcript: SAMPLE_TRANSCRIPT,
      createdBy: "00000000-0000-4000-8000-000000000001",
    });
    const mock = buildMockPemNeatResult({
      prospectName: "Betsy Smith",
      advisorName: "Jesse",
      meetingDate: "2026-07-01",
    });
    await store.saveGenerationSuccess(created.id, {
      structuredResult: mock,
      buildertrendFields: mock.buildertrendFields,
      analysisMetadata: mock.analysisMetadata,
      meetingOutcome: mock.salesIntelligence.meetingOutcome.classification,
      qualification: mock.salesIntelligence.qualification.classification,
      modelProvider: "mock",
      modelName: "mock-pem-neat",
      latencyMs: 10,
      neatStandardVersion: "1.0.0",
      transcriptHash: created.transcript_hash,
    });

    const updated = await store.updateSource(created.id, {
      prospectName: "Betsy Smith",
      salespersonUserId: "00000000-0000-4000-8000-000000000001",
      salespersonDisplayName: "Jesse",
      meetingDate: "2026-07-01",
      transcript: `${SAMPLE_TRANSCRIPT}\nProspect: Also we prefer email contact.`,
      updatedBy: "00000000-0000-4000-8000-000000000001",
    });
    expect(updated.transcriptChanged).toBe(true);
    expect(updated.record.status).toBe("needs_regeneration");
    expect(updated.record.analysis_stale).toBe(true);
    expect(
      (
        updated.record.structured_result as {
          salesIntelligence?: { meetingOutcome?: { classification?: string } };
        }
      ).salesIntelligence?.meetingOutcome?.classification,
    ).toBe(mock.salesIntelligence.meetingOutcome.classification);

    const gens = await store.listGenerations(created.id);
    expect(gens).toHaveLength(1);
    expect(gens[0]?.status).toBe("completed");
  });

  it("soft-deletes from library and hides from get", async () => {
    const store = getPemNeatStore();
    const created = await store.create({
      prospectName: "Delete Me",
      salespersonUserId: "00000000-0000-4000-8000-000000000001",
      salespersonDisplayName: "Jesse",
      transcript: SAMPLE_TRANSCRIPT,
      createdBy: "00000000-0000-4000-8000-000000000001",
    });
    await store.softDelete(created.id, "00000000-0000-4000-8000-000000000001");
    expect(await store.get(created.id)).toBeNull();
    expect(await store.list()).toHaveLength(0);
  });

  it("blocks concurrent generation while locked", async () => {
    const store = getPemNeatStore();
    const created = await store.create({
      prospectName: "Lock Test",
      salespersonUserId: "00000000-0000-4000-8000-000000000001",
      salespersonDisplayName: "Jesse",
      transcript: SAMPLE_TRANSCRIPT,
      createdBy: "00000000-0000-4000-8000-000000000001",
    });
    await store.markGenerating(created.id);
    await expect(store.markGenerating(created.id)).rejects.toMatchObject({
      code: "PEM_NEAT_GENERATION_IN_PROGRESS",
    });
  });

  it("keeps prior result current when regeneration fails after stale", async () => {
    const store = getPemNeatStore();
    const created = await store.create({
      prospectName: "Keep Result",
      salespersonUserId: "00000000-0000-4000-8000-000000000001",
      salespersonDisplayName: "Jesse",
      transcript: SAMPLE_TRANSCRIPT,
      createdBy: "00000000-0000-4000-8000-000000000001",
    });
    const mock = buildMockPemNeatResult({
      prospectName: "Keep Result",
      advisorName: "Jesse",
    });
    await store.saveGenerationSuccess(created.id, {
      structuredResult: mock,
      buildertrendFields: mock.buildertrendFields,
      analysisMetadata: mock.analysisMetadata,
      meetingOutcome: mock.salesIntelligence.meetingOutcome.classification,
      qualification: mock.salesIntelligence.qualification.classification,
      modelProvider: "mock",
      modelName: "mock",
      latencyMs: 5,
      neatStandardVersion: "1.0.0",
      transcriptHash: hashTranscript(SAMPLE_TRANSCRIPT),
    });
    await store.updateSource(created.id, {
      prospectName: "Keep Result",
      salespersonUserId: "00000000-0000-4000-8000-000000000001",
      salespersonDisplayName: "Jesse",
      transcript: `${SAMPLE_TRANSCRIPT}\nExtra line`,
      updatedBy: "00000000-0000-4000-8000-000000000001",
    });
    const failed = await store.saveGenerationFailure(created.id, {
      errorMessage: "truncated",
      errorCode: "PEM_NEAT_OUTPUT_TRUNCATED",
    });
    expect(failed.status).toBe("needs_regeneration");
    expect(
      (
        failed.structured_result as {
          assessment?: { categories?: unknown[] };
        }
      ).assessment?.categories,
    ).toHaveLength(12);
  });
});

describe("PEM NEAT mock generation reliability", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.ENABLE_MOCK_RESEARCH = "true";
  });

  it("produces structurally complete NEAT via generatePemNeat mock path", async () => {
    const out = await generatePemNeat({
      prospectName: "Alex Prospect",
      advisorName: "Test Salesperson",
      meetingDate: "2026-07-01",
      transcript: SAMPLE_TRANSCRIPT,
    });
    expect(out.usedMock).toBe(true);
    expect(out.result.assessment.categories).toHaveLength(12);
    expect(BUILDERTREND_FIELD_DEFS).toHaveLength(31);
    for (const def of BUILDERTREND_FIELD_DEFS) {
      expect(out.result.buildertrendFields).toHaveProperty(def.key);
    }
    expect(out.result.followUpEmail.body.length).toBeGreaterThan(10);
  });
});
