/**
 * Entity name noise-word normalization — defense-in-depth for GHL / PEM / Slack search.
 */
import { describe, expect, it } from "vitest";
import {
  ENTITY_DESCRIPTOR_NOISE_WORDS,
  normalizeEntitySearchName,
} from "@/lib/baxter-ai/entity-name-normalize";

describe("normalizeEntitySearchName", () => {
  it("strips trailing descriptor noise words", () => {
    expect(normalizeEntitySearchName("katie liniger project")).toBe("katie liniger");
    expect(normalizeEntitySearchName("Robert Vertin's opportunity")).toBe("Robert Vertin");
    expect(normalizeEntitySearchName("the Denis Kornilov deal")).toBe("Denis Kornilov");
  });

  it("strips leading descriptor noise words", () => {
    expect(normalizeEntitySearchName("customer Katie Liniger")).toBe("Katie Liniger");
    expect(normalizeEntitySearchName("contact Robert Vertin")).toBe("Robert Vertin");
    expect(normalizeEntitySearchName("the account Maple Street")).toBe("Maple Street");
  });

  it("strips instructional lead phrases glued onto names", () => {
    expect(normalizeEntitySearchName("give me information about the katie liniger")).toBe(
      "katie liniger",
    );
    expect(normalizeEntitySearchName("information about Denis Kornilov")).toBe("Denis Kornilov");
  });

  it("covers the documented noise-word set", () => {
    for (const word of ENTITY_DESCRIPTOR_NOISE_WORDS) {
      expect(normalizeEntitySearchName(`Alex Rivera ${word}`)?.toLowerCase()).toBe("alex rivera");
      expect(normalizeEntitySearchName(`${word} Alex Rivera`)?.toLowerCase()).toBe("alex rivera");
    }
  });
});
