import { describe, expect, it } from "vitest";
import { normalizeCustomJobLabel, shouldOfferCreateCustomJob } from "@/lib/receipts/job-select";

describe("normalizeCustomJobLabel", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeCustomJobLabel("  John  ")).toBe("John");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeCustomJobLabel("   \t  ")).toBe("");
  });
});

describe("shouldOfferCreateCustomJob", () => {
  const labels = ["Johnson", "Smith Residence"];

  it("offers create from the first non-whitespace character even when jobs partially match", () => {
    expect(shouldOfferCreateCustomJob("J", labels)).toBe(true);
    expect(shouldOfferCreateCustomJob("John", labels)).toBe(true);
    expect(shouldOfferCreateCustomJob("Johns", labels)).toBe(true);
  });

  it("hides create on exact case-insensitive label match", () => {
    expect(shouldOfferCreateCustomJob("Johnson", labels)).toBe(false);
    expect(shouldOfferCreateCustomJob("johnson", labels)).toBe(false);
    expect(shouldOfferCreateCustomJob("JOHNSON", labels)).toBe(false);
    expect(shouldOfferCreateCustomJob("  Johnson  ", labels)).toBe(false);
  });

  it("offers create when nothing matches", () => {
    expect(shouldOfferCreateCustomJob("Trailer repair", labels)).toBe(true);
  });

  it("does not offer create for empty or whitespace-only query", () => {
    expect(shouldOfferCreateCustomJob("", labels)).toBe(false);
    expect(shouldOfferCreateCustomJob("   ", labels)).toBe(false);
  });
});
