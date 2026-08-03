import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MonitoringContext, MonitoringSettings } from "@/lib/monitoring/types";

const getUnownedOpportunities = vi.fn();
const getStaleOpportunities = vi.fn();
const isGhlConfigured = vi.fn();
const evaluateGhlHealth = vi.fn();
const listCustomFields = vi.fn();
const getRequiredData = vi.fn();
const searchOpportunitiesPaginated = vi.fn();
const getContactById = vi.fn();
const getOpportunityById = vi.fn();

vi.mock("@/lib/connectors/ghl/insights", () => ({
  getUnownedOpportunities: (...args: unknown[]) => getUnownedOpportunities(...args),
  getStaleOpportunities: (...args: unknown[]) => getStaleOpportunities(...args),
}));

vi.mock("@/lib/connectors/ghl/config", () => ({
  isGhlConfigured: (...args: unknown[]) => isGhlConfigured(...args),
}));

vi.mock("@/lib/connectors/ghl/health", () => ({
  evaluateGhlHealth: (...args: unknown[]) => evaluateGhlHealth(...args),
}));

vi.mock("@/lib/connectors/ghl/resources/custom-fields", () => ({
  listCustomFields: (...args: unknown[]) => listCustomFields(...args),
}));

vi.mock("@/lib/rulebook/api", () => ({
  getRequiredData: (...args: unknown[]) => getRequiredData(...args),
}));

vi.mock("@/lib/connectors/ghl/resources/opportunities", () => ({
  searchOpportunitiesPaginated: (...args: unknown[]) => searchOpportunitiesPaginated(...args),
  getOpportunityById: (...args: unknown[]) => getOpportunityById(...args),
}));

vi.mock("@/lib/connectors/ghl/resources/contacts", () => ({
  getContactById: (...args: unknown[]) => getContactById(...args),
}));

function baseSettings(overrides: Partial<MonitoringSettings> = {}): MonitoringSettings {
  return {
    id: "default",
    enabled: true,
    pilot_slack_channel_id: "C123",
    pilot_slack_channel_name: "monitoring",
    timezone: "America/Los_Angeles",
    quiet_hours_start: null,
    quiet_hours_end: null,
    delivery_mode: "digest",
    escalation_window_minutes: 240,
    sweep_interval_minutes: 15,
    default_stale_days: 3,
    monitored_pipeline_ids: ["pipe-1"],
    check_configs: {
      "unowned-opportunity": { enabled: true },
      "stale-opportunity": { enabled: true },
      "required-ghl-data": { enabled: true },
    },
    stage_stale_overrides: {},
    updated_by: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function baseCtx(overrides: Partial<MonitoringContext> = {}): MonitoringContext {
  return {
    settings: baseSettings(),
    activeRulebook: { id: "rb-1", version_number: 1 },
    mappings: [
      {
        id: "map-1",
        ghl_pipeline_id: "pipe-1",
        ghl_pipeline_name: "Sales",
        ghl_stage_id: "stage-1",
        ghl_stage_name: "Qualified",
        rulebook_stage_key: "stage_a",
        rulebook_step_key: "step_a",
        enabled: true,
        created_by: null,
        updated_by: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    ],
    ghlConfigured: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  getUnownedOpportunities.mockResolvedValue({
    rows: [],
    scannedCount: 0,
    truncated: false,
    incomplete: false,
  });
  getStaleOpportunities.mockResolvedValue({
    rows: [],
    scannedCount: 0,
    truncated: false,
    incomplete: false,
  });
  isGhlConfigured.mockReturnValue(true);
  evaluateGhlHealth.mockResolvedValue({
    overall: "healthy",
    details: {},
    checks: [{ check: "token", ok: true }],
  });
  listCustomFields.mockResolvedValue([]);
  getRequiredData.mockResolvedValue([]);
  searchOpportunitiesPaginated.mockResolvedValue({
    opportunities: [],
    incomplete: false,
    truncated: false,
  });
});

describe("unowned-opportunity check", () => {
  it("produces a finding when an open opportunity has no owner", async () => {
    getUnownedOpportunities.mockResolvedValue({
      rows: [
        {
          opportunityId: "opp-unowned",
          opportunityName: "No Owner Deal",
          contactId: "c1",
          contactName: "Ada",
          pipelineName: "Sales",
          stageName: "New",
          monetaryValue: 1000,
        },
      ],
      scannedCount: 1,
      truncated: false,
      incomplete: false,
    });

    const { unownedOpportunityCheck } = await import("@/lib/monitoring/checks/unowned-opportunity");
    const result = await unownedOpportunityCheck.run(baseCtx());
    const findings = result.candidates.filter((c) => c.checkKey === "unowned-opportunity");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.dedupeKey).toBe("ghl_unowned_opportunity:opp-unowned");
    expect(findings[0]?.severity).toBe("warning");
  });

  it("produces no finding when every opportunity has an owner", async () => {
    getUnownedOpportunities.mockResolvedValue({
      rows: [],
      scannedCount: 5,
      truncated: false,
      incomplete: false,
    });

    const { unownedOpportunityCheck } = await import("@/lib/monitoring/checks/unowned-opportunity");
    const result = await unownedOpportunityCheck.run(baseCtx());
    expect(result.candidates.filter((c) => c.checkKey === "unowned-opportunity")).toHaveLength(0);
  });

  it("produces no findings when no pipelines are monitored", async () => {
    const { unownedOpportunityCheck } = await import("@/lib/monitoring/checks/unowned-opportunity");
    const result = await unownedOpportunityCheck.run(
      baseCtx({ settings: baseSettings({ monitored_pipeline_ids: [] }) }),
    );
    expect(result.candidates).toHaveLength(0);
    expect(getUnownedOpportunities).not.toHaveBeenCalled();
  });
});

describe("stale-opportunity check", () => {
  it("produces a warning finding when daysStale equals the threshold", async () => {
    getStaleOpportunities.mockResolvedValue({
      rows: [
        {
          opportunityId: "opp-stale",
          opportunityName: "At Cutoff",
          contactId: null,
          contactName: null,
          pipelineName: "Sales",
          stageName: "Qualified",
          ownerName: "Bob",
          lastUpdated: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          daysStale: 3,
        },
      ],
      scannedCount: 1,
      truncated: false,
      incomplete: false,
    });

    const { staleOpportunityCheck } = await import("@/lib/monitoring/checks/stale-opportunity");
    const result = await staleOpportunityCheck.run(baseCtx());
    const findings = result.candidates.filter((c) => c.checkKey === "stale-opportunity");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.evidence.daysStale).toBe(3);
    expect(findings[0]?.evidence.staleDaysThreshold).toBe(3);
  });

  it("marks severity critical when daysStale is at least 2x the threshold", async () => {
    getStaleOpportunities.mockResolvedValue({
      rows: [
        {
          opportunityId: "opp-very-stale",
          opportunityName: "Very Stale",
          contactId: null,
          contactName: null,
          pipelineName: "Sales",
          stageName: "Qualified",
          ownerName: "Bob",
          lastUpdated: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
          daysStale: 6,
        },
      ],
      scannedCount: 1,
      truncated: false,
      incomplete: false,
    });

    const { staleOpportunityCheck } = await import("@/lib/monitoring/checks/stale-opportunity");
    const result = await staleOpportunityCheck.run(baseCtx());
    const finding = result.candidates.find((c) => c.checkKey === "stale-opportunity");
    expect(finding?.severity).toBe("critical");
  });

  it("produces no finding when the insights query returns no stale rows", async () => {
    getStaleOpportunities.mockResolvedValue({
      rows: [],
      scannedCount: 10,
      truncated: false,
      incomplete: false,
    });

    const { staleOpportunityCheck } = await import("@/lib/monitoring/checks/stale-opportunity");
    const result = await staleOpportunityCheck.run(baseCtx());
    expect(result.candidates.filter((c) => c.checkKey === "stale-opportunity")).toHaveLength(0);
  });

  it("passes the configured stale threshold into getStaleOpportunities", async () => {
    const { staleOpportunityCheck } = await import("@/lib/monitoring/checks/stale-opportunity");
    await staleOpportunityCheck.run(baseCtx({ settings: baseSettings({ default_stale_days: 5 }) }));
    expect(getStaleOpportunities).toHaveBeenCalledWith(
      expect.objectContaining({
        daysSinceUpdate: 5,
        pipelineId: "pipe-1",
        pipelineStageId: "stage-1",
        status: "open",
      }),
    );
  });
});

describe("stale-opportunity threshold edge", () => {
  it("treats daysStale exactly at threshold as warning (not critical)", async () => {
    getStaleOpportunities.mockResolvedValue({
      rows: [
        {
          opportunityId: "opp-edge",
          opportunityName: "Edge",
          contactId: null,
          contactName: null,
          pipelineName: "Sales",
          stageName: "Qualified",
          ownerName: "Bob",
          lastUpdated: new Date().toISOString(),
          daysStale: 3,
        },
      ],
      scannedCount: 1,
      truncated: false,
      incomplete: false,
    });

    const { staleOpportunityCheck } = await import("@/lib/monitoring/checks/stale-opportunity");
    const result = await staleOpportunityCheck.run(
      baseCtx({ settings: baseSettings({ default_stale_days: 3 }) }),
    );
    const finding = result.candidates.find((c) => c.checkKey === "stale-opportunity");
    expect(finding?.severity).toBe("warning");
    // critical kicks in at 2x threshold (6 for default 3)
    expect(finding?.severity).not.toBe("critical");
  });

  it("escalates to critical at exactly 2x the threshold", async () => {
    getStaleOpportunities.mockResolvedValue({
      rows: [
        {
          opportunityId: "opp-2x",
          opportunityName: "2x",
          contactId: null,
          contactName: null,
          pipelineName: "Sales",
          stageName: "Qualified",
          ownerName: "Bob",
          lastUpdated: new Date().toISOString(),
          daysStale: 6,
        },
      ],
      scannedCount: 1,
      truncated: false,
      incomplete: false,
    });

    const { staleOpportunityCheck } = await import("@/lib/monitoring/checks/stale-opportunity");
    const result = await staleOpportunityCheck.run(
      baseCtx({ settings: baseSettings({ default_stale_days: 3 }) }),
    );
    expect(result.candidates.find((c) => c.checkKey === "stale-opportunity")?.severity).toBe(
      "critical",
    );
  });
});

describe("feed-health check", () => {
  it("produces a critical finding when GHL is not configured", async () => {
    isGhlConfigured.mockReturnValue(false);
    const { feedHealthCheck } = await import("@/lib/monitoring/checks/feed-health");
    const result = await feedHealthCheck.run(baseCtx());
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.dedupeKey).toBe("feed_health:ghl:not_configured");
    expect(result.candidates[0]?.severity).toBe("critical");
  });

  it("produces no finding when GHL health is healthy", async () => {
    isGhlConfigured.mockReturnValue(true);
    evaluateGhlHealth.mockResolvedValue({
      overall: "healthy",
      details: {},
      checks: [{ check: "token", ok: true }],
    });
    const { feedHealthCheck } = await import("@/lib/monitoring/checks/feed-health");
    const result = await feedHealthCheck.run(baseCtx());
    expect(result.candidates).toHaveLength(0);
  });

  it("produces a finding when GHL is unhealthy", async () => {
    isGhlConfigured.mockReturnValue(true);
    evaluateGhlHealth.mockResolvedValue({
      overall: "offline",
      details: { reason: "timeout" },
      checks: [{ check: "token", ok: false }],
    });
    const { feedHealthCheck } = await import("@/lib/monitoring/checks/feed-health");
    const result = await feedHealthCheck.run(baseCtx());
    expect(result.candidates[0]?.dedupeKey).toBe("feed_health:ghl:unhealthy");
  });
});

describe("rulebook-health check", () => {
  it("produces a critical finding when there is no active rulebook", async () => {
    const { rulebookHealthCheck } = await import("@/lib/monitoring/checks/rulebook-health");
    const result = await rulebookHealthCheck.run(baseCtx({ activeRulebook: null }));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.dedupeKey).toBe("rulebook_health:no_active_rulebook");
  });

  it("produces a finding when a monitored pipeline has no mappings", async () => {
    listCustomFields.mockResolvedValue([]);
    const { rulebookHealthCheck } = await import("@/lib/monitoring/checks/rulebook-health");
    const result = await rulebookHealthCheck.run(baseCtx({ mappings: [] }));
    expect(
      result.candidates.some((c) => c.dedupeKey === "rulebook_health:no_mappings:pipe-1"),
    ).toBe(true);
  });

  it("produces no config findings when rulebook and mappings are healthy", async () => {
    listCustomFields.mockResolvedValue([
      { model: "contact", fieldKey: "parcel_id" },
      { model: "opportunity", fieldKey: "lot_size" },
    ]);
    getRequiredData.mockResolvedValue([
      {
        source_system: "ghl",
        source_field_path: "contact.parcel_id",
        field_key: "parcel",
        display_name: "Parcel",
      },
    ]);
    const { rulebookHealthCheck } = await import("@/lib/monitoring/checks/rulebook-health");
    const result = await rulebookHealthCheck.run(baseCtx());
    expect(result.candidates).toHaveLength(0);
  });

  it("flags invalid GHL field paths from the rulebook", async () => {
    listCustomFields.mockResolvedValue([{ model: "contact", fieldKey: "real_field" }]);
    getRequiredData.mockResolvedValue([
      {
        source_system: "ghl",
        source_field_path: "contact.missing_field",
        field_key: "missing",
        display_name: "Missing",
      },
    ]);
    const { rulebookHealthCheck } = await import("@/lib/monitoring/checks/rulebook-health");
    const result = await rulebookHealthCheck.run(baseCtx());
    expect(
      result.candidates.some((c) => c.dedupeKey.startsWith("rulebook_health:invalid_field_path:")),
    ).toBe(true);
  });
});

describe("required-ghl-data check", () => {
  it("produces a finding when a required GHL field is missing", async () => {
    listCustomFields.mockResolvedValue([{ model: "contact", fieldKey: "parcel_id" }]);
    getRequiredData.mockResolvedValue([
      {
        source_system: "ghl",
        source_field_path: "contact.parcel_id",
        field_key: "parcel",
        display_name: "Parcel ID",
      },
    ]);
    searchOpportunitiesPaginated.mockResolvedValue({
      opportunities: [{ id: "opp-1", name: "Deal", contactId: "c1" }],
      incomplete: false,
      truncated: false,
    });
    getContactById.mockResolvedValue({
      id: "c1",
      customFields: { parcel_id: "" },
    });

    const { requiredGhlDataCheck } = await import("@/lib/monitoring/checks/required-ghl-data");
    const result = await requiredGhlDataCheck.run(baseCtx());
    const findings = result.candidates.filter((c) => c.checkKey === "required-ghl-data");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence.missingFields).toEqual(["Parcel ID"]);
  });

  it("produces no finding when required fields are present", async () => {
    listCustomFields.mockResolvedValue([{ model: "contact", fieldKey: "parcel_id" }]);
    getRequiredData.mockResolvedValue([
      {
        source_system: "ghl",
        source_field_path: "contact.parcel_id",
        field_key: "parcel",
        display_name: "Parcel ID",
      },
    ]);
    searchOpportunitiesPaginated.mockResolvedValue({
      opportunities: [{ id: "opp-1", name: "Deal", contactId: "c1" }],
      incomplete: false,
      truncated: false,
    });
    getContactById.mockResolvedValue({
      id: "c1",
      customFields: { parcel_id: "APN-123" },
    });

    const { requiredGhlDataCheck } = await import("@/lib/monitoring/checks/required-ghl-data");
    const result = await requiredGhlDataCheck.run(baseCtx());
    expect(result.candidates.filter((c) => c.checkKey === "required-ghl-data")).toHaveLength(0);
  });

  it("produces no findings when there is no active rulebook", async () => {
    const { requiredGhlDataCheck } = await import("@/lib/monitoring/checks/required-ghl-data");
    const result = await requiredGhlDataCheck.run(baseCtx({ activeRulebook: null }));
    expect(result.candidates).toHaveLength(0);
  });
});
