import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  assemblePemNeatSystemPromptFromSections,
  DEFAULT_PEM_NEAT_GRADING_SECTION_CONTENT,
  getOrCreateDraftVersion,
  updateDraftSection,
  approveDraftSection,
  activateGovernanceVersion,
  getActivationGate,
  loadActivePemNeatGradingContent,
  resetGovernanceMemoryForTests,
} from "@/lib/baxter-ai/governance";
import { buildPemNeatSystemPrompt } from "@/lib/pem-neat/prompts";
import { generatePemNeat } from "@/lib/pem-neat/generate";

const SUPER = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-0000000000bb";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetGovernanceMemoryForTests();
});

describe("PEM NEAT grading governance surface", () => {
  it("seeded sections assemble byte-identical to compiled system prompt", async () => {
    const fromDefaults = assemblePemNeatSystemPromptFromSections(
      DEFAULT_PEM_NEAT_GRADING_SECTION_CONTENT,
    );
    const fromBuilder = buildPemNeatSystemPrompt();
    expect(fromBuilder).toBe(fromDefaults);

    const loaded = await loadActivePemNeatGradingContent();
    expect(loaded.usedFallback).toBe(false);
    expect(loaded.versionNumber).toBe(1);
    expect(loaded.surface).toBe("pem_neat_grading");

    const fromStore = assemblePemNeatSystemPromptFromSections(
      loaded.sections as typeof DEFAULT_PEM_NEAT_GRADING_SECTION_CONTENT,
    );
    expect(fromStore).toBe(fromDefaults);
  });

  it("falls back to compiled defaults when no active PEM grading version", async () => {
    resetGovernanceMemoryForTests();
    const state = (
      globalThis as {
        __baxterGovernanceMemory?: { versions: Map<string, { surface: string }> };
      }
    ).__baxterGovernanceMemory;
    if (state) {
      for (const [id, v] of [...state.versions.entries()]) {
        if (v.surface === "pem_neat_grading") state.versions.delete(id);
      }
    }

    const loaded = await loadActivePemNeatGradingContent();
    expect(loaded.usedFallback).toBe(true);
    expect(loaded.versionNumber).toBe(0);
    const assembled = assemblePemNeatSystemPromptFromSections(
      loaded.sections as typeof DEFAULT_PEM_NEAT_GRADING_SECTION_CONTENT,
    );
    expect(assembled).toBe(
      assemblePemNeatSystemPromptFromSections(DEFAULT_PEM_NEAT_GRADING_SECTION_CONTENT),
    );
    expect(assembled.length).toBeGreaterThan(1000);
  });

  it("blocks activation without process_content approval on changed PEM sections", async () => {
    const draft = await getOrCreateDraftVersion(USER, "Tighten Type 1 wording", "pem_neat_grading");
    await updateDraftSection(
      draft.id,
      "pem_type1_pain",
      DEFAULT_PEM_NEAT_GRADING_SECTION_CONTENT.pem_type1_pain + "\n(Extra coaching note.)",
    );
    const blocked = await getActivationGate(draft.id);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.missingApprovals.some((m) => m.sectionKey === "pem_type1_pain")).toBe(true);
      expect(blocked.missingApprovals.every((m) => m.domain === "process_content")).toBe(true);
    }

    await approveDraftSection({
      versionId: draft.id,
      sectionKey: "pem_type1_pain",
      approvedBy: SUPER,
      role: "super_admin",
    });
    const ok = await activateGovernanceVersion(draft.id, SUPER, "super_admin");
    expect(ok.ok).toBe(true);
  });

  it("records grading content version on generated NEAT metadata", async () => {
    const generated = await generatePemNeat({
      prospectName: "Sharon Liu",
      advisorName: "Alex",
      meetingDate: "2026-03-12",
      transcript: "Advisor: hello.\nProspect: we need an ADU for mom. ".repeat(40),
    });
    expect(generated.usedMock).toBe(true);
    expect(generated.gradingContentVersionNumber).toBe(1);
    expect(generated.usedCompiledGradingFallback).toBe(false);
  });
});
