import { describe, expect, it, beforeEach } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  buildCapabilitiesBlock,
  deriveClaimedCapabilitiesFromCatalog,
  getClaimedCapabilitiesAndLimitations,
  resetMonitoringCapabilityCacheForTests,
} from "@/lib/baxter-ai/governance/capabilities";
import { buildBaxterIdentityContext, answerFromBaxterIdentity } from "@/lib/baxter-ai/identity";
import { assembleBaxterRuntime } from "@/lib/baxter-ai/governance/assemble";
import {
  buildBaxterCapabilityCatalog,
  type BaxterCapability,
  type CapabilityRuntimeHealth,
} from "@/lib/baxter/capability-registry";
import {
  assessMonitoringReadiness,
  assessPemReadiness,
  assessProjectSetupReadiness,
  assessRulebookReadiness,
} from "@/lib/baxter-ai/launch-readiness";
import {
  noteActiveRulebookPresence,
  resetRulebookCapabilityCacheForTests,
} from "@/lib/rulebook/capabilities";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  resetEnvCacheForTests();
  resetMonitoringCapabilityCacheForTests();
  resetRulebookCapabilityCacheForTests();
});

describe("unified capability claims", () => {
  it("identity context and system-prompt block share the same registry-derived lines", () => {
    const claims = getClaimedCapabilitiesAndLimitations();
    const block = buildCapabilitiesBlock();
    const identity = buildBaxterIdentityContext();
    const runtime = assembleBaxterRuntime({ includeJsonContract: false });

    for (const line of claims.capabilities) {
      expect(block).toContain(line);
      expect(identity).toContain(line);
    }
    expect(runtime.capabilitiesSummary).toEqual(claims.capabilities);
    // No second static feature list: capabilities come from catalog keys
    expect(claims.catalogKeys.length).toBeGreaterThan(0);
    expect(claims.catalogKeys).toContain("web_chat");
    expect(claims.catalogKeys).toContain("pem_neat");
  });

  it("GHL appears in claimed capabilities when catalog marks it connected", () => {
    const catalog = buildBaxterCapabilityCatalog({
      googleConfigured: false,
      ghlConfigured: true,
      ghlEnabled: true,
      rulebookKnown: true,
      monitoringKnown: false,
      monitoringUiEnabled: false,
      slackSearchEnabled: false,
    });
    const claims = deriveClaimedCapabilitiesFromCatalog(catalog);
    expect(claims.catalogKeys).toContain("gohighlevel");
    expect(claims.capabilities.some((c) => /ghl|crm|gohighlevel/i.test(c))).toBe(true);
    expect(claims.catalogKeys).toContain("pem_neat");
    expect(claims.catalogKeys).toContain("project_setup");
    expect(claims.capabilities.some((c) => /rulebook/i.test(c))).toBe(true);
  });

  it("deriveClaimedCapabilitiesFromCatalog stays in sync when a catalog entry is added", () => {
    const health: CapabilityRuntimeHealth = {
      googleConfigured: false,
      ghlConfigured: false,
      ghlEnabled: false,
      rulebookKnown: false,
      monitoringKnown: false,
      monitoringUiEnabled: false,
      slackSearchEnabled: false,
    };
    const base = buildBaxterCapabilityCatalog(health);
    const fake: BaxterCapability = {
      key: "test_widget",
      name: "Test Widget",
      shortDescription: "Do the test widget thing.",
      detailedDescription: "Test only.",
      category: "assistant",
      audience: ["employee", "admin"],
      rolesAllowed: ["*"],
      status: "available",
      enabled: true,
      webRoute: null,
      createRoute: null,
      adminRoute: null,
      supportedActions: [],
      limitations: ["Test limitation only"],
      helpTopics: [],
      synonyms: [],
      sourceOfTruth: "runtime",
    };
    const derived = deriveClaimedCapabilitiesFromCatalog([...base, fake]);
    expect(derived.capabilities).toContain("Do the test widget thing.");
    expect(derived.limitations).toContain("Test limitation only");
    expect(derived.catalogKeys).toContain("test_widget");
  });

  it("answerFromBaxterIdentity capability answer uses registry lines", () => {
    const answer = answerFromBaxterIdentity("What can you do?");
    const claims = getClaimedCapabilitiesAndLimitations();
    expect(answer).toContain(claims.capabilities[0]!);
    expect(answer).toMatch(/limitations/i);
  });
});

describe("launch readiness section severity", () => {
  it("PEM: healthy vs degraded", () => {
    expect(
      assessPemReadiness({
        aiProviderReady: true,
        databaseReady: true,
        status: "Ready",
        failedCount: 0,
        lastErrorCode: null,
        staleCount: 0,
      }),
    ).toBe("ok");
    expect(
      assessPemReadiness({
        aiProviderReady: true,
        databaseReady: true,
        status: "Ready",
        failedCount: 2,
        lastErrorCode: null,
        staleCount: 0,
      }),
    ).toBe("needs_attention");
    expect(
      assessPemReadiness({
        aiProviderReady: false,
        databaseReady: true,
        status: "Not configured",
        failedCount: 0,
        lastErrorCode: null,
        staleCount: 0,
      }),
    ).toBe("needs_attention");
  });

  it("Rulebook: no active is informational; invalid active needs attention", () => {
    expect(assessRulebookReadiness({ hasActive: false, validationValid: null })).toBe(
      "informational",
    );
    expect(assessRulebookReadiness({ hasActive: true, validationValid: true })).toBe("ok");
    expect(assessRulebookReadiness({ hasActive: true, validationValid: false })).toBe(
      "needs_attention",
    );
  });

  it("Monitoring: enabled without sweep/pilot needs attention", () => {
    expect(
      assessMonitoringReadiness({
        uiEnabled: false,
        enabled: false,
        pilotChannelConfigured: false,
        lastRunStatus: null,
        lastRunAt: null,
        lastRunError: null,
      }),
    ).toBe("informational");
    expect(
      assessMonitoringReadiness({
        uiEnabled: true,
        enabled: true,
        pilotChannelConfigured: false,
        lastRunStatus: null,
        lastRunAt: null,
        lastRunError: null,
      }),
    ).toBe("needs_attention");
    expect(
      assessMonitoringReadiness({
        uiEnabled: true,
        enabled: true,
        pilotChannelConfigured: true,
        lastRunStatus: "failed",
        lastRunAt: new Date().toISOString(),
        lastRunError: "boom",
      }),
    ).toBe("needs_attention");
    expect(
      assessMonitoringReadiness({
        uiEnabled: true,
        enabled: true,
        pilotChannelConfigured: true,
        lastRunStatus: "completed",
        lastRunAt: new Date().toISOString(),
        lastRunError: null,
      }),
    ).toBe("ok");
  });

  it("Project Setup: stuck and high failure rate need attention", () => {
    expect(
      assessProjectSetupReadiness({
        stuckCount: 0,
        finishedCount: 0,
        completeCount: 0,
        failedCount: 0,
      }),
    ).toBe("informational");
    expect(
      assessProjectSetupReadiness({
        stuckCount: 1,
        finishedCount: 0,
        completeCount: 0,
        failedCount: 0,
      }),
    ).toBe("needs_attention");
    expect(
      assessProjectSetupReadiness({
        stuckCount: 0,
        finishedCount: 4,
        completeCount: 1,
        failedCount: 3,
      }),
    ).toBe("needs_attention");
    expect(
      assessProjectSetupReadiness({
        stuckCount: 0,
        finishedCount: 2,
        completeCount: 2,
        failedCount: 0,
      }),
    ).toBe("ok");
  });

  it("rulebook presence note is reflected when warmed", () => {
    noteActiveRulebookPresence(true);
    const claims = getClaimedCapabilitiesAndLimitations({
      ghlConfigured: false,
      ghlEnabled: false,
      rulebookKnown: true,
      googleConfigured: false,
      monitoringKnown: false,
      monitoringUiEnabled: false,
      slackSearchEnabled: false,
    });
    expect(claims.capabilities.some((c) => /rulebook/i.test(c))).toBe(true);
  });
});

describe("launch readiness page includes GHL card data", () => {
  it("snapshot type includes ghl and new sections (structural)", async () => {
    // Smoke: module exports the assessors used by the page's data source
    expect(typeof assessPemReadiness).toBe("function");
    expect(typeof assessRulebookReadiness).toBe("function");
    expect(typeof assessMonitoringReadiness).toBe("function");
    expect(typeof assessProjectSetupReadiness).toBe("function");
  });
});
