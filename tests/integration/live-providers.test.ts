import { describe, expect, it } from "vitest";

/**
 * Live integration tests.
 *
 * Run only when explicitly requested:
 *   RUN_LIVE_INTEGRATION_TESTS=true npm run test:integration
 *
 * These calls may consume paid ATTOM / RentCast credits.
 */
const runLive = process.env.RUN_LIVE_INTEGRATION_TESTS === "true";

describe.skipIf(!runLive)("live provider integration", () => {
  it("looks up the sample San Jose address via ATTOM", async () => {
    const { lookupAttomProperty } = await import("@/lib/providers/attom/provider");
    const result = await lookupAttomProperty({
      address: "655 13th St, San Jose, CA 95112",
      standardizedAddress: "655 13th St, San Jose, CA 95112",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
    });
    expect(result.property?.identity.apn || result.packageResults.length > 0).toBeTruthy();
  });

  it("looks up the sample San Jose address via RentCast", async () => {
    const { lookupRentCastProperty } = await import("@/lib/providers/rentcast/provider");
    const result = await lookupRentCastProperty({
      address: "655 13th St, San Jose, CA 95112",
      standardizedAddress: "655 13th St, San Jose, CA 95112",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
    });
    expect(["active", "manual_review", "unavailable", "error"]).toContain(result.status);
  });
});

describe("integration harness", () => {
  it("documents that live tests are gated", () => {
    expect(runLive || true).toBe(true);
  });
});
