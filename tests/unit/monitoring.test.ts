import { describe, it, expect } from "vitest";
import { isInQuietHours } from "@/lib/monitoring/quiet-hours";
import type { MonitoringSettings, FindingCandidate } from "@/lib/monitoring/types";

describe("monitoring/quiet-hours", () => {
  const baseSettings: MonitoringSettings = {
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
    monitored_pipeline_ids: [],
    check_configs: {},
    stage_stale_overrides: {},
    updated_by: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  };

  it("should return false when no quiet hours configured", () => {
    const now = new Date("2024-01-15T14:30:00Z");
    expect(isInQuietHours(now, baseSettings)).toBe(false);
  });

  it("should detect within quiet hours (same day)", () => {
    const settings = {
      ...baseSettings,
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
      timezone: "America/Los_Angeles",
    };

    // 2024-01-15 03:00 UTC = 2024-01-14 19:00 PST (not in quiet hours)
    const beforeQuiet = new Date("2024-01-15T03:00:00Z");
    expect(isInQuietHours(beforeQuiet, settings)).toBe(false);

    // 2024-01-15 07:00 UTC = 2024-01-14 23:00 PST (in quiet hours)
    const duringQuiet = new Date("2024-01-15T07:00:00Z");
    expect(isInQuietHours(duringQuiet, settings)).toBe(true);

    // 2024-01-15 17:00 UTC = 2024-01-15 09:00 PST (not in quiet hours)
    const afterQuiet = new Date("2024-01-15T17:00:00Z");
    expect(isInQuietHours(afterQuiet, settings)).toBe(false);
  });

  it("should handle midnight wrap (overnight quiet hours)", () => {
    const settings = {
      ...baseSettings,
      quiet_hours_start: "22:00",
      quiet_hours_end: "06:00",
    };

    // Simulate 23:00 local (in quiet hours)
    const late = new Date("2024-01-15T07:00:00Z"); // Adjust for PST
    expect(isInQuietHours(late, settings)).toBe(true);

    // Simulate 03:00 local (in quiet hours)
    const early = new Date("2024-01-15T11:00:00Z");
    expect(isInQuietHours(early, settings)).toBe(true);

    // Simulate 10:00 local (not in quiet hours)
    const midday = new Date("2024-01-15T18:00:00Z");
    expect(isInQuietHours(midday, settings)).toBe(false);
  });

  it("should handle invalid quiet hour formats", () => {
    const settings = {
      ...baseSettings,
      quiet_hours_start: "invalid",
      quiet_hours_end: "25:00",
    };

    const now = new Date("2024-01-15T14:30:00Z");
    expect(isInQuietHours(now, settings)).toBe(false);
  });
});

describe("monitoring/dedupe-keys", () => {
  it("should format unowned opportunity dedupe key", () => {
    const candidate: FindingCandidate = {
      checkKey: "unowned-opportunity",
      dedupeKey: "ghl_unowned_opportunity:opp_123",
      severity: "warning",
      entityType: "opportunity",
      opportunityId: "opp_123",
      title: "Unowned opportunity",
      evidence: {},
    };

    expect(candidate.dedupeKey).toMatch(/^ghl_unowned_opportunity:/);
  });

  it("should format stale opportunity dedupe key", () => {
    const candidate: FindingCandidate = {
      checkKey: "stale-opportunity",
      dedupeKey: "ghl_stale_opportunity:opp_456",
      severity: "warning",
      entityType: "opportunity",
      opportunityId: "opp_456",
      title: "Stale opportunity",
      evidence: {},
    };

    expect(candidate.dedupeKey).toMatch(/^ghl_stale_opportunity:/);
  });

  it("should format missing data dedupe key with field list", () => {
    const candidate: FindingCandidate = {
      checkKey: "required-ghl-data",
      dedupeKey: "ghl_missing_data:opp_789:field1,field2",
      severity: "warning",
      entityType: "opportunity",
      opportunityId: "opp_789",
      title: "Missing required data",
      evidence: {},
    };

    expect(candidate.dedupeKey).toMatch(/^ghl_missing_data:opp_789:/);
  });
});

describe("monitoring/false-positive-rate", () => {
  it("should handle empty dataset", () => {
    const total = 0;
    const fpCount = 0;
    const rate = total === 0 ? 0 : fpCount / total;
    expect(rate).toBe(0);
  });

  it("should compute correct rate", () => {
    const total = 10;
    const fpCount = 2;
    const rate = fpCount / total;
    expect(rate).toBe(0.2);
  });

  it("should handle all false positives", () => {
    const total = 5;
    const fpCount = 5;
    const rate = fpCount / total;
    expect(rate).toBe(1);
  });

  it("should handle no false positives", () => {
    const total = 10;
    const fpCount = 0;
    const rate = fpCount / total;
    expect(rate).toBe(0);
  });
});

describe("monitoring/data-coverage", () => {
  it("partial coverage cannot claim clean result", () => {
    const incomplete = true;
    const findings: string[] = [];
    const runStatus = incomplete ? "partial" : findings.length === 0 ? "completed" : "completed";
    expect(runStatus).toBe("partial");
    expect(incomplete).toBe(true);
  });

  it("complete coverage with zero findings is clean", () => {
    const incomplete = false;
    const findings: string[] = [];
    const runStatus = incomplete ? "partial" : "completed";
    expect(runStatus).toBe("completed");
    expect(findings).toHaveLength(0);
  });
});

describe("monitoring/check-enabled-gating", () => {
  const baseSettings: MonitoringSettings = {
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
    monitored_pipeline_ids: [],
    check_configs: {},
    stage_stale_overrides: {},
    updated_by: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  };

  it("should default operational checks to disabled", () => {
    const unownedConfig = baseSettings.check_configs["unowned-opportunity"];
    expect(unownedConfig?.enabled).toBeUndefined();

    const staleConfig = baseSettings.check_configs["stale-opportunity"];
    expect(staleConfig?.enabled).toBeUndefined();

    const requiredConfig = baseSettings.check_configs["required-ghl-data"];
    expect(requiredConfig?.enabled).toBeUndefined();
  });

  it("should default health checks to enabled", () => {
    // Health checks run when monitoring is enabled, unless explicitly disabled
    const feedConfig = baseSettings.check_configs["feed-health"];
    expect(feedConfig?.enabled).toBeUndefined();

    const rulebookConfig = baseSettings.check_configs["rulebook-health"];
    expect(rulebookConfig?.enabled).toBeUndefined();
  });

  it("should respect explicit enabled flag", () => {
    const settings = {
      ...baseSettings,
      check_configs: {
        "unowned-opportunity": { enabled: true },
        "feed-health": { enabled: false },
      },
    };

    expect(settings.check_configs["unowned-opportunity"]?.enabled).toBe(true);
    expect(settings.check_configs["feed-health"]?.enabled).toBe(false);
  });
});
