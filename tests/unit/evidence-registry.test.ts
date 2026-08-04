/**
 * Evidence registry — entity resolution, arbitration, and GHL↔PEM collision regressions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  adaptQuestionForPemLookup,
  mostRecentEntitySource,
  preferredSourceForFollowUp,
  resolveQuestionEntity,
  runEvidenceRegistry,
  writeEntityArbitration,
} from "@/lib/baxter-ai/evidence-registry";
import { detectGhlIntent } from "@/lib/baxter-ai/ghl-intent";
import { getPemNeatStore, resetPemNeatMemoryStoreForTests } from "@/lib/pem-neat/store";
import { buildMockPemNeatResult } from "@/lib/pem-neat/mock-result";
import type { EvidenceSource } from "@/lib/baxter-ai/evidence-registry/types";

const SALES_ID = "00000000-0000-4000-8000-000000000099";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  process.env.BAXTER_CHAT_ENABLED = "true";
  resetEnvCacheForTests();
  resetPemNeatMemoryStoreForTests();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("resolveQuestionEntity", () => {
  it("surfaces both ghl_opportunity and pem_prospect for opportunity-phrased person questions", () => {
    const q = "What's the status of the Robert Vertin opportunity?";
    expect(detectGhlIntent(q).intent).toBe("opportunity_lookup");

    const resolved = resolveQuestionEntity({ question: q });
    expect(resolved.extractedName).toMatch(/Robert Vertin/i);
    expect(resolved.candidates.some((c) => c.type === "ghl_opportunity")).toBe(true);
    expect(resolved.candidates.some((c) => c.type === "pem_prospect")).toBe(true);
    expect(resolved.ambiguousAcrossTypes).toBe(true);
    expect(resolved.primary).toBeNull();
  });

  it("classifies rulebook responsibility questions", () => {
    const resolved = resolveQuestionEntity({
      question: "Who is responsible for conducting the PEM?",
    });
    expect(resolved.candidates.some((c) => c.type === "rulebook_step_or_role")).toBe(true);
  });

  it("boosts PEM candidate when arbitration prefers pem on follow-up", () => {
    const resolved = resolveQuestionEntity({
      question: "When is it due?",
      history: [{ role: "user", content: "Tell me about Carter French's PEM" }],
      preferredSource: "pem",
    });
    const pem = resolved.candidates.find(
      (c) => c.type === "pem_prospect" && c.via === "arbitration",
    );
    expect(pem?.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe("conversation-entity arbitration", () => {
  it("prefers the most-recently established entity type over code order", () => {
    let metadata: Record<string, unknown> = {};
    metadata = writeEntityArbitration(metadata, {
      lastSource: "pem",
      label: "Carter French",
      setAt: "2026-08-01T12:00:00.000Z",
    });

    // Older GHL stamp must not override newer PEM arbitration
    metadata.ghlContext = {
      contact: {
        id: "c1",
        displayName: "Other Person",
        setAt: "2026-07-01T12:00:00.000Z",
      },
      opportunity: null,
      lastRequestedFields: [],
      updatedAt: "2026-07-01T12:00:00.000Z",
    };

    const recent = mostRecentEntitySource(metadata);
    expect(recent?.lastSource).toBe("pem");

    const preferred = preferredSourceForFollowUp({
      question: "What about that one?",
      history: [{ role: "user", content: "Tell me about Carter French's budget" }],
      conversationMetadata: metadata,
    });
    expect(preferred).toBe("pem");
  });
});

describe("adaptQuestionForPemLookup", () => {
  it("rewrites opportunity phrasing into a PEM record_lookup shape", async () => {
    const adapted = adaptQuestionForPemLookup(
      "What's the status of the Robert Vertin opportunity?",
      "Robert Vertin",
    );
    expect(adapted).toMatch(/Robert Vertin/i);
    expect(adapted).toMatch(/PEM/i);
    const { detectPemIntent } = await import("@/lib/baxter-data/pem-neats/intent");
    expect(detectPemIntent(adapted).intent).toBe("record_lookup");
  });
});

describe("GHL↔PEM opportunity collision (registry)", () => {
  it("PEM-only prospect phrased as opportunity resolves to PEM, not GHL not-found", async () => {
    const store = getPemNeatStore();
    const record = await store.create({
      prospectName: "Robert Vertin",
      salespersonUserId: SALES_ID,
      salespersonDisplayName: "Alex Sales",
      meetingDate: "2026-02-01",
      transcript: "Advisor: Purpose today is fit. Prospect: We need an ADU. ".repeat(40),
      createdBy: SALES_ID,
    });
    const mock = buildMockPemNeatResult({
      prospectName: "Robert Vertin",
      advisorName: "Alex Sales",
      meetingDate: "2026-02-01",
    });
    mock.salesIntelligence.meetingOutcome = {
      classification: "YES",
      explanation: "Scheduled follow-up to review plans.",
    };
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
    });

    const ghlMiss: EvidenceSource = {
      key: "ghl",
      canHandle: () => ({ plausible: true, confidence: 0.84 }),
      resolve: async () => ({
        items: [],
        deterministicAnswer: "I couldn’t find a GHL contact matching Robert Vertin.",
        confidence: 0.1,
        softMiss: true,
      }),
    };

    const { pemEvidenceSource } = await import("@/lib/baxter-ai/evidence-registry/sources/pem");
    const { rulebookEvidenceSource } =
      await import("@/lib/baxter-ai/evidence-registry/sources/rulebook");

    const result = await runEvidenceRegistry({
      question: "What's the status of the Robert Vertin opportunity?",
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: true,
      semanticOptions: { skipSemantic: true },
      sources: [ghlMiss, pemEvidenceSource, rulebookEvidenceSource],
    });

    expect(result.earlyAnswer).not.toBeNull();
    expect(result.earlyAnswer?.winningSource).toBe("pem_neat");
    expect(result.earlyAnswer?.answer).not.toMatch(/GHL contact/i);
    expect(result.earlyAnswer?.answer.toLowerCase()).toMatch(/robert vertin|outcome|pem|next/i);
    expect(result.diagnostics.tried.some((t) => t.key === "ghl" && t.outcome === "soft_miss")).toBe(
      true,
    );
  });

  it("real GHL opportunity (no PEM) still resolves to GHL", async () => {
    const ghlHit: EvidenceSource = {
      key: "ghl",
      canHandle: () => ({ plausible: true, confidence: 0.84 }),
      resolve: async () => ({
        items: [
          {
            number: 1,
            id: "ghl-opp-1",
            title: "Ada Lovelace — Opportunity",
            summary: "Stage: Proposal",
            contentExcerpt: "Pipeline Marketing — Proposal",
            category: "GoHighLevel",
            tags: [],
            sourceName: "GoHighLevel",
            sourceUrl: null,
            sourceType: "crm",
            mimeType: null,
            updatedAt: new Date().toISOString(),
            citationLabel: "GoHighLevel",
            relevanceScore: 100,
          },
        ],
        deterministicAnswer:
          "Ada Lovelace’s opportunity is in the Marketing pipeline at stage Proposal.",
        confidence: 0.95,
      }),
    };

    const pemEmpty: EvidenceSource = {
      key: "pem_neat",
      canHandle: () => ({ plausible: true, confidence: 0.7 }),
      resolve: async () => null,
    };

    const result = await runEvidenceRegistry({
      question: "What's the status of the Ada Lovelace opportunity?",
      history: [],
      conversationMetadata: {},
      role: "admin",
      channel: "web",
      ghlConfigured: true,
      semanticOptions: { skipSemantic: true },
      sources: [ghlHit, pemEmpty],
    });

    expect(result.earlyAnswer?.winningSource).toBe("ghl");
    expect(result.earlyAnswer?.answer).toMatch(/Ada Lovelace/i);
    expect(result.earlyAnswer?.answer).toMatch(/Proposal/i);
    expect(result.diagnostics.tried.some((t) => t.key === "pem_neat")).toBe(false);
  });

  it("follow-up arbitration boosts PEM over GHL when PEM was last established", async () => {
    const metadata = writeEntityArbitration(
      {},
      {
        lastSource: "pem",
        label: "Robert Vertin",
        setAt: "2026-08-01T15:00:00.000Z",
      },
    );

    const ghl: EvidenceSource = {
      key: "ghl",
      canHandle: (input) => ({
        plausible: input.preferredSource === "ghl" || true,
        confidence: input.preferredSource === "ghl" ? 0.95 : 0.5,
      }),
      resolve: async () => ({
        items: [],
        deterministicAnswer: "I couldn’t find a GHL contact matching that person.",
        softMiss: true,
        confidence: 0.1,
      }),
    };

    const pem: EvidenceSource = {
      key: "pem_neat",
      canHandle: (input) => ({
        plausible: true,
        confidence: input.preferredSource === "pem" ? 0.96 : 0.4,
      }),
      resolve: async () => ({
        items: [
          {
            number: 1,
            id: "pem-1",
            title: "Robert Vertin PEM",
            summary: "Budget confirmed",
            contentExcerpt: "Budget: $250k",
            category: "PEM NEAT",
            tags: [],
            sourceName: "PEM NEAT",
            sourceUrl: null,
            sourceType: "pem",
            mimeType: null,
            updatedAt: new Date().toISOString(),
            citationLabel: "PEM NEAT",
            relevanceScore: 100,
          },
        ],
        deterministicAnswer: "Robert Vertin’s budget is $250k.",
        confidence: 0.95,
      }),
    };

    const result = await runEvidenceRegistry({
      question: "What about that one?",
      history: [{ role: "user", content: "Tell me about Robert Vertin's PEM" }],
      conversationMetadata: metadata,
      role: "admin",
      channel: "web",
      ghlConfigured: true,
      semanticOptions: { skipSemantic: true },
      sources: [ghl, pem],
    });

    expect(result.diagnostics.preferredSource).toBe("pem");
    expect(result.earlyAnswer?.winningSource).toBe("pem_neat");
    // Preferred PEM is ranked first; GHL may be skipped after PEM short-circuits.
    expect(result.diagnostics.tried[0]?.key).toBe("pem_neat");
    expect(result.diagnostics.tried[0]?.confidence).toBeGreaterThanOrEqual(0.9);
  });
});
