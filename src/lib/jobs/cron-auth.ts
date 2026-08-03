import "server-only";

import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import vercelConfig from "../../../vercel.json";

/**
 * Canonical cron secret: CRON_SECRET (Vercel) with INTERNAL_CRON_SECRET as legacy alias.
 */
export function getCronSecretCandidates(): string[] {
  const candidates: string[] = [];
  const cronSecret = (process.env.CRON_SECRET ?? "").trim();
  let internal = "";
  try {
    internal = (getEnv().INTERNAL_CRON_SECRET ?? "").trim();
  } catch {
    internal = (process.env.INTERNAL_CRON_SECRET ?? "").trim();
  }
  if (cronSecret) candidates.push(cronSecret);
  if (internal && internal !== cronSecret) candidates.push(internal);
  return candidates;
}

export function getCanonicalCronSecretName(): "CRON_SECRET" | "INTERNAL_CRON_SECRET" | null {
  if ((process.env.CRON_SECRET ?? "").trim()) return "CRON_SECRET";
  try {
    if ((getEnv().INTERNAL_CRON_SECRET ?? "").trim()) return "INTERNAL_CRON_SECRET";
  } catch {
    if ((process.env.INTERNAL_CRON_SECRET ?? "").trim()) return "INTERNAL_CRON_SECRET";
  }
  return null;
}

export function isCronSecretConfigured(): boolean {
  return getCronSecretCandidates().length > 0;
}

/**
 * Authorize Vercel Cron / internal job processor.
 * Accepts only Authorization: Bearer <secret>. Query-string secrets are rejected.
 */
export function authorizeCronBearer(request: Request): {
  ok: boolean;
  code: "BAXTER_CRON_SECRET_MISSING" | "BAXTER_CRON_UNAUTHORIZED" | null;
} {
  const candidates = getCronSecretCandidates();
  if (candidates.length === 0) {
    return { ok: false, code: "BAXTER_CRON_SECRET_MISSING" };
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return { ok: false, code: "BAXTER_CRON_UNAUTHORIZED" };
  }

  const token = header.slice("Bearer ".length).trim();
  const actual = Buffer.from(token, "utf8");
  for (const candidate of candidates) {
    const expected = Buffer.from(candidate, "utf8");
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
      return { ok: true, code: null };
    }
  }
  return { ok: false, code: "BAXTER_CRON_UNAUTHORIZED" };
}

export type CronDiagnostics = {
  cronSecretConfigured: boolean;
  canonicalVariable: "CRON_SECRET" | "INTERNAL_CRON_SECRET" | null;
  routeRegistered: boolean;
  schedule: string | null;
  /** Human-readable interval derived from the real vercel.json cron expression. */
  scheduleInterval: string | null;
  note: string;
};

type VercelCronEntry = { path?: string; schedule?: string };

/**
 * Read the process-jobs cron schedule from vercel.json (source of truth).
 */
export function getConfiguredCronSchedule(): {
  schedule: string | null;
  scheduleInterval: string | null;
} {
  const crons = (vercelConfig as { crons?: VercelCronEntry[] }).crons ?? [];
  const entry = crons.find((c) => c.path === "/api/internal/process-jobs") ?? crons[0] ?? null;
  const schedule = entry?.schedule?.trim() || null;
  return {
    schedule,
    scheduleInterval: schedule ? describeCronInterval(schedule) : null,
  };
}

/**
 * Best-effort human-readable interval for common Vercel cron expressions.
 */
export function describeCronInterval(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return expression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const everyNMinutes = minute?.match(/^\*\/(\d+)$/);
  if (everyNMinutes && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const n = Number(everyNMinutes[1]);
    return n === 1 ? "every minute" : `every ${n} minutes`;
  }

  if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "every minute";
  }

  const everyNHours = hour?.match(/^\*\/(\d+)$/);
  if (minute === "0" && everyNHours && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const n = Number(everyNHours[1]);
    return n === 1 ? "every hour" : `every ${n} hours`;
  }

  if (
    /^\d+$/.test(minute ?? "") &&
    /^\d+$/.test(hour ?? "") &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return `daily at ${hour!.padStart(2, "0")}:${minute!.padStart(2, "0")} UTC`;
  }

  return expression;
}

export function getCronConfigDiagnostics(): CronDiagnostics {
  const { schedule, scheduleInterval } = getConfiguredCronSchedule();
  return {
    cronSecretConfigured: isCronSecretConfigured(),
    canonicalVariable: getCanonicalCronSecretName(),
    routeRegistered: true,
    schedule,
    scheduleInterval,
    note: `Vercel Cron calls /api/internal/process-jobs on schedule "${schedule ?? "unset"}" (${scheduleInterval ?? "unknown interval"}) with Authorization: Bearer. Opening the URL in a browser returns 401 — that is expected. Use admin Run sync now for manual syncs. Monitoring sweeps and Google syncs apply their own interval/due checks inside each cron tick.`,
  };
}
