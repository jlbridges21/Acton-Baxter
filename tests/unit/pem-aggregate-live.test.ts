/**
 * Live PEM aggregate against real Supabase — skipped when credentials/memory mode.
 * Verifies Kevin Lee August counts from actual rows.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  formatPemAggregateAnswer,
  resolveAndAggregatePemNeats,
} from "@/lib/baxter-data/pem-neats/aggregate";
import { writeFileSync } from "node:fs";

const hasLive =
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  !String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes("127.0.0.1") &&
  !String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").startsWith("test-") &&
  process.env.E2E_TEST_AUTH_BYPASS !== "true" &&
  process.env.RUN_PEM_AGGREGATE_LIVE === "1";

describe.runIf(hasLive)("live PEM aggregate — Kevin Lee August", () => {
  beforeAll(() => {
    resetEnvCacheForTests();
  });
  afterAll(() => resetEnvCacheForTests());

  it("returns real counts for Kevin Lee in August with YES highlight", async () => {
    const resolved = await resolveAndAggregatePemNeats({
      params: {
        intent: "count",
        salespersonName: "Kevin Lee",
        datePreset: null,
        customStart: null,
        customEnd: null,
        calendarMonth: 8,
        calendarYear: null,
        outcome: null,
        qualification: null,
        includeOutcomeBreakdown: true,
        highlightOutcomes: ["YES"],
      },
      now: new Date("2026-08-10T17:00:00.000Z"),
    });

    writeFileSync("/tmp/baxter-pem-aggregate-kevin.json", JSON.stringify(resolved, null, 2));
    expect(resolved.kind).toBe("ok");
    if (resolved.kind !== "ok") return;

    const answer = formatPemAggregateAnswer({ resolved });
    writeFileSync("/tmp/baxter-pem-aggregate-kevin-answer.txt", answer);
    expect(answer).toMatch(/Kevin Lee ran \d+ completed PEM/);
    expect(answer).toMatch(/\d+ resulted in YES/);
    expect(resolved.result.total).toBeGreaterThanOrEqual(0);
    expect(resolved.result.byOutcome.YES).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
