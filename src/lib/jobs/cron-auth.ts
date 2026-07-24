import "server-only";

import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

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
  note: string;
};

export function getCronConfigDiagnostics(): CronDiagnostics {
  return {
    cronSecretConfigured: isCronSecretConfigured(),
    canonicalVariable: getCanonicalCronSecretName(),
    routeRegistered: true,
    schedule: "0 12 * * *",
    note: "Vercel Cron calls /api/internal/process-jobs with Authorization: Bearer. Opening the URL in a browser returns 401 — that is expected. Use admin Run sync now for manual syncs. Hobby plans support at most one cron per day; Pro may use a more frequent schedule while GOOGLE_SYNC_INTERVAL_MINUTES controls due Google syncs.",
  };
}
