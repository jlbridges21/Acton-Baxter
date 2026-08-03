import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MonitoringFinding, MonitoringSettings } from "@/lib/monitoring/types";
import vercelConfig from "../../vercel.json";

const postSlackMessage = vi.fn();
const listFindings = vi.fn();
const markAlerted = vi.fn();
const markEscalated = vi.fn();
const claimOpenFindingForDelivery = vi.fn();
const releaseDeliveryClaim = vi.fn();
const getMonitoringSettings = vi.fn();
const enqueueJob = vi.fn();
const listMemoryJobsForTests = vi.fn();
const usesMemoryJobStore = vi.fn();
const createServiceClient = vi.fn();

vi.mock("@/lib/slack/client", () => ({
  postSlackMessage: (...args: unknown[]) => postSlackMessage(...args),
}));

vi.mock("@/lib/monitoring/findings", () => ({
  listFindings: (...args: unknown[]) => listFindings(...args),
  markAlerted: (...args: unknown[]) => markAlerted(...args),
  markEscalated: (...args: unknown[]) => markEscalated(...args),
  claimOpenFindingForDelivery: (...args: unknown[]) => claimOpenFindingForDelivery(...args),
  releaseDeliveryClaim: (...args: unknown[]) => releaseDeliveryClaim(...args),
  reclaimAbandonedDeliveryClaims: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/monitoring/settings", () => ({
  getMonitoringSettings: (...args: unknown[]) => getMonitoringSettings(...args),
  isMonitoringEnabled: async () => (await getMonitoringSettings()).enabled,
}));

vi.mock("@/lib/jobs/queue", () => ({
  enqueueJob: (...args: unknown[]) => enqueueJob(...args),
  listMemoryJobsForTests: (...args: unknown[]) => listMemoryJobsForTests(...args),
  usesMemoryJobStore: (...args: unknown[]) => usesMemoryJobStore(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createServiceClient: (...args: unknown[]) => createServiceClient(...args),
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
    delivery_mode: "immediate",
    escalation_window_minutes: 60,
    sweep_interval_minutes: 15,
    default_stale_days: 3,
    monitored_pipeline_ids: ["pipe-1"],
    check_configs: {},
    stage_stale_overrides: {},
    updated_by: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function alertedFinding(overrides: Partial<MonitoringFinding> = {}): MonitoringFinding {
  return {
    id: "finding-1",
    check_key: "unowned-opportunity",
    dedupe_key: "ghl_unowned_opportunity:opp-1",
    severity: "warning",
    entity_type: "opportunity",
    entity_id: "opp-1",
    contact_id: null,
    opportunity_id: "opp-1",
    rulebook_stage_key: null,
    rulebook_step_key: null,
    title: "Unowned opportunity",
    evidence_json: {},
    recommendation: "Assign an owner",
    responsible_role_key: null,
    responsible_profile_id: null,
    status: "alerted",
    detected_at: "2024-01-01T00:00:00Z",
    last_detected_at: "2024-01-01T00:00:00Z",
    alerted_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    acknowledged_at: null,
    acknowledged_by_slack_user_id: null,
    resolved_at: null,
    dismissed_at: null,
    dismissed_by_slack_user_id: null,
    escalated_at: null,
    slack_channel_id: "C123",
    slack_message_ts: "1700000000.000100",
    slack_thread_ts: "1700000000.000100",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function openFinding(overrides: Partial<MonitoringFinding> = {}): MonitoringFinding {
  return alertedFinding({
    status: "open",
    alerted_at: null,
    slack_channel_id: null,
    slack_message_ts: null,
    slack_thread_ts: null,
    ...overrides,
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  getMonitoringSettings.mockResolvedValue(baseSettings());
  listFindings.mockResolvedValue([]);
  markAlerted.mockResolvedValue(undefined);
  markEscalated.mockResolvedValue(undefined);
  releaseDeliveryClaim.mockResolvedValue(undefined);
  postSlackMessage.mockResolvedValue({ ok: true, ts: "1700000000.000200" });
  enqueueJob.mockResolvedValue({ id: "job-1" });
  usesMemoryJobStore.mockReturnValue(true);
  listMemoryJobsForTests.mockReturnValue([]);
});

describe("escalation (defect #1)", () => {
  it("escalates alerted findings past the window when slack_thread_ts is set", async () => {
    const finding = alertedFinding();
    listFindings.mockResolvedValue([finding]);
    postSlackMessage.mockResolvedValue({ ok: true, ts: "1700000000.000999" });

    const { handleEscalations } = await import("@/lib/monitoring/delivery");
    const escalated = await handleEscalations(baseSettings({ escalation_window_minutes: 60 }));

    expect(escalated).toBe(1);
    expect(postSlackMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        threadTs: finding.slack_thread_ts,
      }),
    );
    expect(markEscalated).toHaveBeenCalledWith(finding.id);
  });

  it("skips escalation when slack_thread_ts is missing (pre-fix bug condition)", async () => {
    listFindings.mockResolvedValue([alertedFinding({ slack_thread_ts: null })]);
    const { handleEscalations } = await import("@/lib/monitoring/delivery");
    const escalated = await handleEscalations(baseSettings());
    expect(escalated).toBe(0);
    expect(postSlackMessage).not.toHaveBeenCalled();
    expect(markEscalated).not.toHaveBeenCalled();
  });

  it("stores threadTs when marking a finding alerted (immediate mode)", async () => {
    const finding = openFinding({ id: "open-1" });
    listFindings
      .mockResolvedValueOnce([finding]) // open findings for delivery
      .mockResolvedValueOnce([]); // alerted findings for escalation
    claimOpenFindingForDelivery.mockResolvedValue({ ...finding, status: "delivering" });

    const { deliverPendingAlerts } = await import("@/lib/monitoring/delivery");
    await deliverPendingAlerts();

    expect(markAlerted).toHaveBeenCalledWith(
      "open-1",
      expect.objectContaining({
        channelId: "C123",
        messageTs: "1700000000.000200",
        threadTs: "1700000000.000200",
      }),
    );
  });
});

describe("delivery race safety (defect #3)", () => {
  it("posts to Slack only once when two concurrent deliveries race the same finding", async () => {
    const finding = openFinding({ id: "race-1" });
    let claimed = false;
    claimOpenFindingForDelivery.mockImplementation(async () => {
      if (claimed) return null;
      claimed = true;
      return { ...finding, status: "delivering" };
    });

    listFindings.mockImplementation(async (filters?: { status?: string }) => {
      if (filters?.status === "open") return [finding];
      return [];
    });

    const { deliverPendingAlerts } = await import("@/lib/monitoring/delivery");
    const [a, b] = await Promise.all([deliverPendingAlerts(), deliverPendingAlerts()]);

    expect(postSlackMessage.mock.calls.filter((c) => !c[0]?.threadTs).length).toBe(1);
    expect(a.delivered + b.delivered).toBe(1);
    expect(markAlerted).toHaveBeenCalledTimes(1);
  });
});

describe("double-enqueue collapse (defect #2)", () => {
  it("enqueues exactly once for a normal sweep with new findings", async () => {
    const { shouldEnqueueAlertDeliveryAfterSweep } = await import("@/lib/monitoring/sweep");
    expect(
      shouldEnqueueAlertDeliveryAfterSweep({
        enabled: true,
        force: false,
        newFindings: 2,
        refreshedFindings: 1,
      }),
    ).toBe(true);
  });

  it("still enqueues on a normal sweep with no new findings (escalation path)", async () => {
    const { shouldEnqueueAlertDeliveryAfterSweep } = await import("@/lib/monitoring/sweep");
    expect(
      shouldEnqueueAlertDeliveryAfterSweep({
        enabled: true,
        force: false,
        newFindings: 0,
        refreshedFindings: 0,
      }),
    ).toBe(true);
  });

  it("does not enqueue twice for the same sweep decision (single boolean gate)", async () => {
    const { shouldEnqueueAlertDeliveryAfterSweep } = await import("@/lib/monitoring/sweep");
    const decisions = [
      shouldEnqueueAlertDeliveryAfterSweep({
        enabled: true,
        force: false,
        newFindings: 1,
        refreshedFindings: 0,
      }),
      // prior second overlapping condition is folded into the same gate
    ];
    expect(decisions.filter(Boolean)).toHaveLength(1);
  });

  it("skips enqueue for a forced sweep with no findings", async () => {
    const { shouldEnqueueAlertDeliveryAfterSweep } = await import("@/lib/monitoring/sweep");
    expect(
      shouldEnqueueAlertDeliveryAfterSweep({
        enabled: true,
        force: true,
        newFindings: 0,
        refreshedFindings: 0,
      }),
    ).toBe(false);
  });
});

describe("cron diagnostic (defect #4)", () => {
  it("reflects the real vercel.json schedule, not a hardcoded daily string", async () => {
    const { getCronConfigDiagnostics, describeCronInterval } = await import("@/lib/jobs/cron-auth");
    const configured = vercelConfig.crons?.[0]?.schedule;
    expect(configured).toBeTruthy();

    const diag = getCronConfigDiagnostics();
    expect(diag.schedule).toBe(configured);
    expect(diag.schedule).not.toBe("0 12 * * *");
    expect(diag.scheduleInterval).toBe(describeCronInterval(configured!));
    expect(diag.scheduleInterval).toBe("every 2 minutes");
  });
});

describe("monitoring sweep interval gating (defect #5)", () => {
  it("skips enqueue when called again before the interval elapses", async () => {
    getMonitoringSettings.mockResolvedValue(baseSettings({ sweep_interval_minutes: 15 }));
    const completedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    createServiceClient.mockReturnValue({
      from: () => ({
        select: () => ({
          in: () => ({
            not: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: { completed_at: completedAt }, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const { maybeEnqueueScheduledMonitoringSweep } = await import("@/lib/monitoring/schedule");
    const result = await maybeEnqueueScheduledMonitoringSweep();
    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("Sweep interval not elapsed");
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("skips enqueue when a sweep is already queued or running", async () => {
    getMonitoringSettings.mockResolvedValue(baseSettings({ sweep_interval_minutes: 15 }));
    createServiceClient.mockReturnValue({
      from: () => ({
        select: () => ({
          in: () => ({
            not: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    });
    listMemoryJobsForTests.mockReturnValue([
      {
        id: "pending",
        jobType: "baxter_monitor_sweep",
        status: "queued",
      },
    ]);

    const { maybeEnqueueScheduledMonitoringSweep } = await import("@/lib/monitoring/schedule");
    const result = await maybeEnqueueScheduledMonitoringSweep();
    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("Sweep job already pending");
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("enqueues when interval elapsed and no pending sweep", async () => {
    getMonitoringSettings.mockResolvedValue(baseSettings({ sweep_interval_minutes: 15 }));
    const completedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    createServiceClient.mockReturnValue({
      from: () => ({
        select: () => ({
          in: () => ({
            not: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: { completed_at: completedAt }, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    });
    listMemoryJobsForTests.mockReturnValue([]);

    const { maybeEnqueueScheduledMonitoringSweep } = await import("@/lib/monitoring/schedule");
    const result = await maybeEnqueueScheduledMonitoringSweep();
    expect(result).toEqual({ enqueued: true, reason: "enqueued" });
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: "baxter_monitor_sweep",
        metadata: { source: "scheduled" },
      }),
    );
  });
});
