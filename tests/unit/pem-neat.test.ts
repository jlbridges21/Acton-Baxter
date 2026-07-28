import { describe, expect, it, beforeEach } from "vitest";
import {
  ASSESSMENT_CATEGORY_KEYS,
  INTERNAL_NOTES_MAX_CHARS,
  MEETING_OUTCOMES,
} from "@/lib/pem-neat/constants";
import {
  buildertrendFieldsSchema,
  createPemNeatInputSchema,
  parsePemNeatStructuredResult,
  pemNeatStructuredResultSchema,
  sanitizeCustomerEmailBody,
  validateFollowUpEmailCustomerSafe,
} from "@/lib/pem-neat/schemas";
import {
  BUILDERTREND_FIELD_DEFS,
  buildCopyAllFieldsText,
  formatBudgetDisplay,
  getCopyableValue,
  getDisplayValue,
} from "@/lib/pem-neat/buildertrend-display";
import { buildMockPemNeatResult } from "@/lib/pem-neat/mock-result";
import { getPemNeatStore, resetPemNeatMemoryStoreForTests } from "@/lib/pem-neat/store";
import { prepareTranscriptForModel, stage0ValidateTranscript } from "@/lib/pem-neat/transcript";
import { runDeterministicNeatChecks } from "@/lib/pem-neat/validate";
import { getEnabledBaxterTools, getNavContext } from "@/lib/baxter/tools";

const SAMPLE_TRANSCRIPT = `
Advisor: Thanks for meeting — today's purpose is to see if we're a good fit to help with an ADU for your parent.
Prospect: Mom is increasingly vulnerable living alone. We want her nearby but independent. Our working budget is about $400,000 all-in. Another builder said around $380,000. We need to talk to my spouse and reconnect in two weeks. Previously a contractor stopped communicating and costs jumped. Schedule: we'd like to start this year if possible.
Advisor: Great — I'll follow up after you speak with your spouse.
`.repeat(3);

describe("PEM NEAT dashboard registration", () => {
  it("registers Partnership Evaluation Meeting NEAT on the home tools list", () => {
    const tools = getEnabledBaxterTools();
    expect(tools.some((t) => t.key === "pem-neat")).toBe(true);
    const neat = tools.find((t) => t.key === "pem-neat");
    expect(neat?.href).toBe("/pem-neats");
    expect(neat?.name).toBe("Partnership Evaluation Meeting NEAT");
  });

  it("uses pem-neat nav context", () => {
    expect(getNavContext("/pem-neats")).toBe("pem-neat");
    expect(getNavContext("/pem-neats/new")).toBe("pem-neat");
    expect(getNavContext("/pem-neats/abc")).toBe("pem-neat");
  });
});

describe("PEM NEAT schema", () => {
  it("accepts a valid structured NEAT", () => {
    const result = buildMockPemNeatResult({
      prospectName: "Alex Prospect",
      advisorName: "Test Salesperson",
    });
    expect(() => parsePemNeatStructuredResult(result)).not.toThrow();
    expect(result.assessment.categories).toHaveLength(12);
    expect(new Set(result.assessment.categories.map((c) => c.key)).size).toBe(12);
  });

  it("rejects invalid meeting outcome", () => {
    const result = buildMockPemNeatResult({
      prospectName: "Alex Prospect",
      advisorName: "Test Salesperson",
    });
    const bad = {
      ...result,
      salesIntelligence: {
        ...result.salesIntelligence,
        meetingOutcome: { classification: "MAYBE", explanation: "nope" },
      },
    };
    expect(() => pemNeatStructuredResultSchema.parse(bad)).toThrow();
  });

  it("clamps out-of-range assessment scores into 1–10", () => {
    const result = buildMockPemNeatResult({
      prospectName: "Alex Prospect",
      advisorName: "Test Salesperson",
    });
    result.assessment.categories[0]!.score = 11;
    const parsed = pemNeatStructuredResultSchema.parse(result);
    expect(parsed.assessment.categories[0]?.score).toBe(10);
  });

  it("coerces invalid BuilderTrend enum fields to null / empty", () => {
    const parsed = buildertrendFieldsSchema.parse({
      preferredContactMethod: "Carrier pigeon",
      bedBathCount: "9 Bed / 9 Bath",
    });
    expect(parsed.preferredContactMethod).toBeNull();
    expect(parsed.bedBathCount).toBeNull();
  });

  it("accepts null BuilderTrend fields", () => {
    const parsed = buildertrendFieldsSchema.parse({});
    expect(parsed.customerBudget).toBeNull();
    expect(parsed.bedBathCount).toBeNull();
    expect(parsed.projectType).toBeNull();
  });

  it("enforces internal notes character limit", () => {
    const result = buildMockPemNeatResult({
      prospectName: "Alex Prospect",
      advisorName: "Test Salesperson",
    });
    result.internalOpportunityNotes = "x".repeat(INTERNAL_NOTES_MAX_CHARS + 1);
    expect(() => pemNeatStructuredResultSchema.parse(result)).toThrow();
  });

  it("flags internal sales terminology in customer email", () => {
    const issues = validateFollowUpEmailCustomerSafe(
      "Thanks for meeting. Your Type 1 pain is clear and qualification is STRONGLY_QUALIFIED.",
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it("sanitizes internal email language instead of failing parse", () => {
    const result = buildMockPemNeatResult({
      prospectName: "Alex Prospect",
      advisorName: "Test Salesperson",
    });
    result.followUpEmail.body =
      "Thanks for meeting. Your Type 1 pain is clear and qualification is STRONGLY_QUALIFIED.";
    const parsed = parsePemNeatStructuredResult(result);
    expect(parsed.followUpEmail.body).not.toMatch(/Type 1 pain/i);
    expect(parsed.followUpEmail.body).not.toMatch(/STRONGLY_QUALIFIED/);
    expect(parsed.analysisMetadata.limitations?.some((l) => l.includes("Sanitized"))).toBe(true);
  });

  it("sanitizes customer email body helper", () => {
    const sanitized = sanitizeCustomerEmailBody(
      "Your Type 1 pain and qualification score / 10 need coaching.",
    );
    expect(sanitized).not.toMatch(/Type 1 pain/i);
    expect(sanitized).not.toMatch(/score\s*\/\s*10/i);
  });

  it("normalizes partial assessment categories to 12", () => {
    const result = buildMockPemNeatResult({
      prospectName: "Alex Prospect",
      advisorName: "Test Salesperson",
    });
    result.assessment.categories = result.assessment.categories.slice(0, 11);
    const parsed = parsePemNeatStructuredResult(result);
    expect(parsed.assessment.categories).toHaveLength(12);
    expect(new Set(parsed.assessment.categories.map((c) => c.key)).size).toBe(12);
  });

  it("coerces customerBudget currency string to number", () => {
    const parsed = buildertrendFieldsSchema.parse({ customerBudget: "$1,000,000" });
    expect(parsed.customerBudget).toBe(1000000);
    expect(formatBudgetDisplay(parsed.customerBudget)).toBe("$1,000,000");
  });

  it("keeps Type 1 and Type 2 distinct in fixture", () => {
    const result = buildMockPemNeatResult({
      prospectName: "Alex Prospect",
      advisorName: "Test Salesperson",
    });
    expect(result.salesIntelligence.type1Pain[0]?.statement).toMatch(/vulnerable|independence/i);
    expect(result.salesIntelligence.type2Pain[0]?.statement).toMatch(/contractor|communication/i);
    expect(result.salesIntelligence.type1Pain[0]?.statement).not.toEqual(
      result.salesIntelligence.type2Pain[0]?.statement,
    );
  });

  it("uses documented meeting outcome enums", () => {
    for (const outcome of MEETING_OUTCOMES) {
      expect(outcome).toMatch(/^[A-Z_]+$/);
    }
    expect(ASSESSMENT_CATEGORY_KEYS).toHaveLength(12);
  });
});

describe("BuilderTrend display helpers", () => {
  it("shows Not established for empty display but empty copyable value", () => {
    const fields = buildertrendFieldsSchema.parse({});
    const def = BUILDERTREND_FIELD_DEFS.find((d) => d.key === "customerStory")!;
    expect(getDisplayValue(fields, def)).toBe("Not established");
    expect(getCopyableValue(fields, def)).toBe("");
  });

  it("copies customerBudget without dollar sign", () => {
    const fields = buildertrendFieldsSchema.parse({ customerBudget: 1000000 });
    const def = BUILDERTREND_FIELD_DEFS.find((d) => d.key === "customerBudget")!;
    expect(getDisplayValue(fields, def)).toBe("$1,000,000");
    expect(getCopyableValue(fields, def)).toBe("1000000");
  });

  it("copies priorities as newline bullets", () => {
    const fields = buildertrendFieldsSchema.parse({
      customerPriorities: ["Communication", "Quality"],
    });
    const def = BUILDERTREND_FIELD_DEFS.find((d) => d.key === "customerPriorities")!;
    expect(getCopyableValue(fields, def)).toBe("- Communication\n- Quality");
    expect(buildCopyAllFieldsText(fields)).toContain("Customer Priorities:\n- Communication");
  });

  it("omits empty fields from copy all", () => {
    const fields = buildertrendFieldsSchema.parse({ customerStory: "ADU for parent" });
    const text = buildCopyAllFieldsText(fields);
    expect(text).toContain("Customer Story:\nADU for parent");
    expect(text).not.toContain("Square Feet:");
  });
});

describe("PEM NEAT input validation", () => {
  it("rejects tiny transcripts", () => {
    const parsed = createPemNeatInputSchema.safeParse({
      prospectName: "Alex",
      salespersonUserId: "00000000-0000-4000-8000-000000000001",
      transcript: "too short",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts meaningful transcripts", () => {
    const parsed = createPemNeatInputSchema.safeParse({
      prospectName: "Alex Prospect",
      salespersonUserId: "00000000-0000-4000-8000-000000000001",
      meetingDate: "2026-07-01",
      transcript: SAMPLE_TRANSCRIPT,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("PEM NEAT stage 0 and long transcript", () => {
  it("rejects empty transcript at stage 0", () => {
    const result = stage0ValidateTranscript("hi");
    expect(result.ok).toBe(false);
  });

  it("accepts sample PEM transcript", () => {
    const result = stage0ValidateTranscript(SAMPLE_TRANSCRIPT);
    expect(result.ok).toBe(true);
  });

  it("preserves beginning and end for long transcripts", () => {
    const long = `START_MARKER ${"x".repeat(100_000)} END_MARKER outcome post-sell`;
    const prepared = prepareTranscriptForModel(long);
    expect(prepared.strategy).toBe("head_tail_preserved");
    expect(prepared.text.startsWith("START_MARKER")).toBe(true);
    expect(prepared.text.includes("END_MARKER")).toBe(true);
    expect(prepared.text.includes("BAXTER_TRANSCRIPT_NOTE")).toBe(true);
  });
});

describe("PEM NEAT deterministic QC", () => {
  it("flags internal sales terminology in follow-up email QC", () => {
    const result = buildMockPemNeatResult({
      prospectName: "Alex Prospect",
      advisorName: "Test Salesperson",
    });
    result.followUpEmail.body = "Your Type 1 pain score is 10/10.";
    const issues = runDeterministicNeatChecks(result, SAMPLE_TRANSCRIPT);
    expect(issues.some((i) => i.includes("internal sales terminology"))).toBe(true);
  });

  it("passes mock fixture against sample transcript grounding", () => {
    const result = buildMockPemNeatResult({
      prospectName: "Alex Prospect",
      advisorName: "Test Salesperson",
    });
    const issues = runDeterministicNeatChecks(result, SAMPLE_TRANSCRIPT);
    expect(issues.some((i) => i.startsWith("HARD:"))).toBe(false);
  });
});

describe("PEM NEAT persistence", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetPemNeatMemoryStoreForTests();
  });

  it("creates, saves, reopens, and preserves success on failed regenerate path", async () => {
    const store = getPemNeatStore();
    const created = await store.create({
      prospectName: "Alex Prospect",
      salespersonUserId: "00000000-0000-4000-8000-000000000001",
      salespersonDisplayName: "Test Salesperson",
      meetingDate: "2026-07-01",
      transcript: SAMPLE_TRANSCRIPT,
      createdBy: "00000000-0000-4000-8000-000000000001",
    });
    expect(created.status).toBe("draft");
    expect(created.transcript).toBe(SAMPLE_TRANSCRIPT);

    await store.markGenerating(created.id);
    const mock = buildMockPemNeatResult({
      prospectName: "Alex Prospect",
      advisorName: "Test Salesperson",
      meetingDate: "2026-07-01",
    });
    const saved = await store.saveGenerationSuccess(created.id, {
      structuredResult: mock,
      buildertrendFields: mock.buildertrendFields,
      analysisMetadata: mock.analysisMetadata,
      meetingOutcome: mock.salesIntelligence.meetingOutcome.classification,
      qualification: mock.salesIntelligence.qualification.classification,
      modelProvider: "mock",
      modelName: "mock-pem-neat",
      latencyMs: 12,
      neatStandardVersion: "1.0.0",
    });
    expect(saved.status).toBe("completed");
    expect(saved.meeting_outcome).toBe("DECISION_DATE");

    const reopened = await store.get(created.id);
    expect(reopened?.structured_result).toMatchObject({
      salesIntelligence: { meetingOutcome: { classification: "DECISION_DATE" } },
    });
    expect(reopened?.transcript).toBe(SAMPLE_TRANSCRIPT);

    const afterFail = await store.saveGenerationFailure(created.id, {
      errorMessage: "provider down",
    });
    expect(afterFail.status).toBe("completed");
    expect(afterFail.generation_error).toBe("provider down");
    expect(
      (
        afterFail.structured_result as {
          salesIntelligence?: { meetingOutcome?: { classification?: string } };
        }
      ).salesIntelligence?.meetingOutcome?.classification,
    ).toBe("DECISION_DATE");

    const listed = await store.list({ query: "alex" });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.salesperson_display_name).toBe("Test Salesperson");
  });

  it("preserves salesperson display-name snapshot independently of prospect uniqueness", async () => {
    const store = getPemNeatStore();
    await store.create({
      prospectName: "Same Prospect",
      salespersonUserId: "00000000-0000-4000-8000-000000000001",
      salespersonDisplayName: "Jesse Snapshot",
      transcript: SAMPLE_TRANSCRIPT,
      createdBy: "00000000-0000-4000-8000-000000000001",
    });
    await store.create({
      prospectName: "Same Prospect",
      salespersonUserId: "00000000-0000-4000-8000-000000000002",
      salespersonDisplayName: "Kevin Snapshot",
      transcript: SAMPLE_TRANSCRIPT,
      createdBy: "00000000-0000-4000-8000-000000000001",
    });
    const listed = await store.list({ query: "Same Prospect" });
    expect(listed).toHaveLength(2);
  });
});
