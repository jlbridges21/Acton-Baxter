import { timingSafeEqual } from "node:crypto";
import { jsonError, jsonOk } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { AuthenticationError } from "@/lib/errors";
import { processQueuedJobs } from "@/lib/jobs/process";

function authorizeCron(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization");
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET> when CRON_SECRET is set.
  // We also accept INTERNAL_CRON_SECRET via Bearer or ?secret=.
  const candidates = [secret, process.env.CRON_SECRET].filter((value): value is string =>
    Boolean(value),
  );
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    for (const candidate of candidates) {
      const expected = Buffer.from(candidate, "utf8");
      const actual = Buffer.from(token, "utf8");
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
        return true;
      }
    }
  }
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  if (querySecret) {
    for (const candidate of candidates) {
      const expected = Buffer.from(candidate, "utf8");
      const actual = Buffer.from(querySecret, "utf8");
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
        return true;
      }
    }
  }
  return false;
}

export async function POST(request: Request) {
  try {
    const env = getEnv();
    if (!env.INTERNAL_CRON_SECRET) {
      throw new AuthenticationError("INTERNAL_CRON_SECRET is not configured");
    }
    if (!authorizeCron(request, env.INTERNAL_CRON_SECRET)) {
      throw new AuthenticationError("Invalid cron secret");
    }

    const result = await processQueuedJobs({ limit: 10 });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error, "POST /api/internal/process-jobs");
  }
}

export async function GET(request: Request) {
  return POST(request);
}
