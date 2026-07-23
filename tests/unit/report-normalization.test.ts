import { describe, expect, it } from "vitest";
import { runMockPropertyResearch } from "@/lib/research/mock-research-provider";
import { normalizedResearchResultSchema } from "@/lib/research/schemas";

describe("report normalization", () => {
  it("produces a schema-valid mock research result", async () => {
    const result = await runMockPropertyResearch("655 13th St, San Jose, CA");
    const parsed = normalizedResearchResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.identity.apn).toBe("47222019");
    expect(result.conflicts.length).toBeGreaterThan(0);
  }, 10_000);
});
