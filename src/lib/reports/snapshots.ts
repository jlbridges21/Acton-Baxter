/**
 * Weekly financial snapshots: settings, the scheduled capture (from the existing 2-minute job
 * sweep), and week-over-week comparison. Each period is captured at most once per calculation
 * version (a unique run row claims it), rows are insert-only (the table rejects updates and
 * deletes), and nothing is ever backfilled.
 */

import "server-only";

import { agentDb, eq, isUniqueViolation, StoreError } from "@/lib/agents/store";
import { ValidationError } from "@/lib/errors";
import { isMissingSchema, MIGRATION_084 } from "./financial-data";
import { financialState } from "./financial-overview";
import {
  addDays,
  computeSnapshotValues,
  DEFAULT_SNAPSHOT_SETTINGS,
  diffSnapshots,
  fromEpochDay,
  isValidTimezone,
  SNAPSHOT_CALC_VERSION,
  snapshotPeriod,
  type SnapshotRow,
  type SnapshotSettings,
} from "./snapshot-core";

type SettingsRow = {
  id: "default";
  enabled: boolean;
  weekday: number;
  hour_local: number;
  timezone: string;
  enabled_at: string | null;
  updated_by: string | null;
  updated_at: string;
};

export async function getSnapshotSettings(): Promise<
  SnapshotSettings & { migrated: boolean; updatedAt: string | null }
> {
  try {
    const [row] = await agentDb().select<SettingsRow>("bi_snapshot_settings", {
      filters: [eq("id", "default")],
      limit: 1,
    });
    if (!row) return { ...DEFAULT_SNAPSHOT_SETTINGS, migrated: true, updatedAt: null };
    return {
      enabled: row.enabled,
      weekday: row.weekday,
      hourLocal: row.hour_local,
      timezone: row.timezone,
      enabledAt: row.enabled_at,
      migrated: true,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    if (!isMissingSchema(error)) throw error;
    return { ...DEFAULT_SNAPSHOT_SETTINGS, migrated: false, updatedAt: null };
  }
}

export async function saveSnapshotSettings(
  patch: Partial<Omit<SnapshotSettings, "enabledAt">>,
  actor: string,
) {
  const current = await getSnapshotSettings();
  if (!current.migrated)
    throw new StoreError(`Snapshots need migration ${MIGRATION_084}.`, "MIGRATION_REQUIRED");
  const next = { ...current, ...patch };
  if (!isValidTimezone(next.timezone))
    throw new ValidationError(`"${next.timezone}" isn't a valid timezone.`);
  if (!Number.isInteger(next.weekday) || next.weekday < 0 || next.weekday > 6)
    throw new ValidationError("Weekday must be 0 (Sunday) to 6 (Saturday).");
  if (!Number.isInteger(next.hourLocal) || next.hourLocal < 0 || next.hourLocal > 23)
    throw new ValidationError("Hour must be 0–23.");
  const now = new Date().toISOString();
  await agentDb().upsert(
    "bi_snapshot_settings",
    {
      id: "default",
      enabled: next.enabled,
      weekday: next.weekday,
      hour_local: next.hourLocal,
      timezone: next.timezone,
      // Turning snapshots on (again) restarts prospective collection from this moment.
      enabled_at:
        next.enabled && !current.enabled ? now : (current.enabledAt ?? (next.enabled ? now : null)),
      updated_by: actor,
      updated_at: now,
    },
    ["id"],
  );
  return getSnapshotSettings();
}

type RunRow = {
  id: string;
  period_start: string;
  period_end: string;
  calc_version: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  triggered_by: string;
  metrics_written: number;
  source_synced_at: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

/** Capture the current period's snapshot now (idempotent per period + calc version). */
export async function captureSnapshot(input: {
  now?: Date;
  triggeredBy: string;
  settings?: SnapshotSettings;
}) {
  const now = input.now ?? new Date();
  const settings = input.settings ?? (await getSnapshotSettings());
  const period = snapshotPeriod(now, settings);
  const db = agentDb();
  let run: RunRow;
  try {
    [run] = (await db.insert<RunRow>("bi_snapshot_runs", {
      period_start: period.start,
      period_end: period.end,
      calc_version: SNAPSHOT_CALC_VERSION,
      status: "running",
      triggered_by: input.triggeredBy,
      started_at: now.toISOString(),
    })) as [RunRow];
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "exists" as const, period };
    if (isMissingSchema(error))
      throw new StoreError(`Snapshots need migration ${MIGRATION_084}.`, "MIGRATION_REQUIRED");
    throw error;
  }
  try {
    const state = await financialState();
    const ctx = state.ctx;
    const syncedAt =
      [...ctx.entities.values()]
        .filter((e) => ["documents", "payments", "tasks", "jobs"].includes(e.entity))
        .map((e) => e.last_success_at)
        .filter((x): x is string => Boolean(x))
        .sort()[0] ?? null;
    const tasksSynced = Boolean(ctx.entities.get("tasks")?.last_success_at);
    const values = computeSnapshotValues({
      totals: state.totals,
      outstandingByPm: state.outstandingByPm,
      jobs: [...ctx.jobs.values()].map((j) => ({
        id: j.id,
        name: j.name,
        scheduleEnd: j.task_end,
        open: !j.closed_on,
      })),
      milestones: tasksSynced
        ? ctx.tasks.map((t) => ({
            endDate: t.end_date,
            complete: Number(t.completed ?? 0) >= 1,
            isGroup: t.is_group === true,
          }))
        : null,
      today: ctx.today,
    });
    const rows = values.map((v) => ({
      run_id: run.id,
      period_start: period.start,
      period_end: period.end,
      metric: v.metric,
      dimension_key: v.dimensionKey,
      dimensions: v.dimensions,
      value: v.value,
      completeness: v.completeness,
      completeness_detail: v.detail,
      source_synced_at: syncedAt,
      calc_version: SNAPSHOT_CALC_VERSION,
      captured_at: now.toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 200)
      await db.insert("bi_snapshots", rows.slice(i, i + 200));
    await db.update("bi_snapshot_runs", [eq("id", run.id)], {
      status: "succeeded",
      metrics_written: rows.length,
      source_synced_at: syncedAt,
      finished_at: new Date().toISOString(),
    });
    return { status: "captured" as const, period, metrics: rows.length };
  } catch (error) {
    await db
      .update("bi_snapshot_runs", [eq("id", run.id)], {
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 300) : "Snapshot failed",
        finished_at: new Date().toISOString(),
      })
      .catch(() => undefined);
    throw error;
  }
}

/** From the job sweep: capture this week's snapshot once it's due. Never throws. */
export async function maybeCaptureScheduledSnapshot(now = new Date()) {
  try {
    if ((process.env.BAXTER_SNAPSHOTS ?? "").toLowerCase() === "off")
      return { captured: false, reason: "BAXTER_SNAPSHOTS=off" };
    const settings = await getSnapshotSettings();
    if (!settings.migrated)
      return { captured: false, reason: `Migration ${MIGRATION_084} not applied` };
    if (!settings.enabled) return { captured: false, reason: "Snapshots are off" };
    const period = snapshotPeriod(now, settings);
    if (!period.due)
      return {
        captured: false,
        reason: period.prospective ? "Not due yet" : "Started after this period (prospective only)",
      };
    const result = await captureSnapshot({ now, triggeredBy: "schedule:weekly", settings });
    return { captured: result.status === "captured", reason: result.status };
  } catch (error) {
    return {
      captured: false,
      reason: error instanceof Error ? error.message.slice(0, 120) : "failed",
    };
  }
}

export async function listSnapshotRuns(limit = 20): Promise<RunRow[]> {
  return agentDb()
    .select<RunRow>("bi_snapshot_runs", { order: { col: "period_start", ascending: false }, limit })
    .catch(() => []);
}

async function periodRows(periodStart: string): Promise<SnapshotRow[]> {
  return agentDb().select<SnapshotRow>("bi_snapshots", {
    filters: [eq("period_start", periodStart)],
    limit: 20_000,
  });
}

/**
 * Compare the latest captured week with the one before ("what changed since last Monday").
 * Explains when there's no history yet instead of inventing a baseline.
 */
export async function compareLatestWeeks(input?: { periodStart?: string }) {
  const runs = (await listSnapshotRuns(60)).filter(
    (r) => r.status === "succeeded" && r.calc_version === SNAPSHOT_CALC_VERSION,
  );
  const current = input?.periodStart
    ? runs.find((r) => r.period_start === input.periodStart)
    : runs[0];
  if (!current)
    return {
      ok: false as const,
      reason:
        "No weekly snapshots have been captured yet. Snapshots start from the first scheduled day after they're turned on (Reports → Data settings → Financial data → Snapshots); past weeks can't be reconstructed.",
    };
  const previous = runs.find((r) => r.period_start < current.period_start);
  if (!previous)
    return {
      ok: false as const,
      reason: `Only one snapshot exists (week of ${current.period_start}), so there's no earlier week to compare with yet.`,
      current: current.period_start,
    };
  const gap = Math.round(
    (Date.parse(current.period_start) - Date.parse(previous.period_start)) / 86_400_000,
  );
  const changes = diffSnapshots(
    await periodRows(previous.period_start),
    await periodRows(current.period_start),
  ).map((c) =>
    c.unit === "date"
      ? {
          ...c,
          previousDate: c.previous === null ? null : fromEpochDay(c.previous),
          currentDate: c.current === null ? null : fromEpochDay(c.current),
        }
      : c,
  );
  return {
    ok: true as const,
    current: current.period_start,
    previous: previous.period_start,
    gapDays: gap,
    note:
      gap > 7
        ? `The previous snapshot is ${gap} days earlier (week of ${previous.period_start}); weeks in between weren't captured.`
        : null,
    changes,
    capturedFrom: { current: current.source_synced_at, previous: previous.source_synced_at },
  };
}

/** Forecast changes (job schedule end) between the last two snapshots, for alerts. */
export async function forecastChanges() {
  const cmp = await compareLatestWeeks().catch(() => null);
  if (!cmp?.ok) return [];
  return cmp.changes
    .filter((c) => c.metric === "job_forecast_end" && c.kind === "changed")
    .map((c) => ({
      jobId: c.dimensions.job_id ?? c.dimensionKey.replace(/^job:/, ""),
      jobName: c.dimensions.job ?? null,
      previous: c.previous === null ? null : fromEpochDay(c.previous),
      current: c.current === null ? null : fromEpochDay(c.current),
      deltaDays: c.delta,
      caveat: c.caveat,
    }));
}

export const nextPeriodStart = (s: SnapshotSettings, now = new Date()) => {
  const p = snapshotPeriod(now, s);
  return !p.due && p.prospective ? p.start : addDays(p.start, 7);
};
