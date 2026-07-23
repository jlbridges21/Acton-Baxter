import { describe, expect, it } from "vitest";
import { addressRequestSchema } from "@/lib/research/schemas";

describe("addressRequestSchema", () => {
  it("accepts a normal California street address", () => {
    const result = addressRequestSchema.safeParse({
      address: "655 13th St, San Jose, CA",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an address without a street number", () => {
    const result = addressRequestSchema.safeParse({
      address: "Thirteenth Street, San Jose, CA",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an address that is too short", () => {
    const result = addressRequestSchema.safeParse({
      address: "12 A",
    });
    expect(result.success).toBe(false);
  });
});
