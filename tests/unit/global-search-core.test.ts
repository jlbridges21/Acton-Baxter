/**
 * Global Search pure logic: normalization, ranking tiers, typo tolerance, highlighting,
 * output safety, address grouping, and client section building. Synthetic data only.
 */

import { describe, expect, it } from "vitest";
import {
  addressKey,
  addressMatches,
  looksLikeAddress,
  normalizeAddress,
  normalizeIdentifier,
  normalizePhone,
  normalizeText,
} from "@/lib/search/normalize";
import {
  combinedScore,
  compareRanked,
  contextBoost,
  editDistance,
  highlightRanges,
  matchDocument,
  type MatchDoc,
} from "@/lib/search/rank";
import { safeText, validateResultUrl } from "@/lib/search/safety";
import { buildSections, countLabel, formatRelative, sourceLine } from "@/lib/search/client";
import type { ProviderOutcome, SearchResult } from "@/lib/search/types";

describe("normalization", () => {
  it("normalizes text, identifiers, and phones", () => {
    expect(normalizeText("  Café   O’Brien—ADU ")).toBe("cafe obrien adu");
    expect(normalizeIdentifier("#JT-1003")).toBe("jt1003");
    expect(normalizePhone("+1 (555) 010-0199")).toBe("5550100199");
    expect(normalizePhone("555.010.0199")).toBe("5550100199");
  });

  it("normalizes street suffixes, directionals, units, case, whitespace, and ZIP+4", () => {
    expect(normalizeAddress("123 North Main Street, Apt #4, Fresno, California 93701-1234")).toBe(
      "123 n main st unit 4 fresno ca 93701",
    );
    expect(normalizeAddress("123 N. MAIN ST.  Suite 4")).toBe("123 n main st unit 4");
    expect(normalizeAddress("45 Oak Avenue")).toBe(normalizeAddress("45 oak ave"));
    expect(normalizeAddress("9 Elm Rd")).toBe(normalizeAddress("9 Elm Road"));
    expect(normalizeAddress("1 W Pine Dr")).toBe(normalizeAddress("1 West Pine Drive"));
  });

  it("matches partial addresses in any order and spots address-like queries", () => {
    expect(addressMatches("123 main", "123 N Main Street, Fresno CA")).toBe(true);
    expect(addressMatches("123 main street", "123 Main St")).toBe(true);
    expect(addressMatches("main st 123", "123 Main St")).toBe(true);
    expect(addressMatches("124 main", "123 Main St")).toBe(false);
    expect(looksLikeAddress("123 Main")).toBe(true);
    expect(looksLikeAddress("Main")).toBe(false);
    expect(looksLikeAddress("1003")).toBe(false);
  });

  it("builds an address key that keeps city and ZIP apart", () => {
    const a = addressKey({ line1: "123 Main Street", city: "Fresno", postalCode: "93701-1111" });
    const b = addressKey({ line1: "123 MAIN ST", city: "fresno", postalCode: "93701" });
    expect(a?.key).toBe(b?.key);
    expect(a?.zip).toBe("93701");
    expect(addressKey({ line1: "Main Street" })).toBeNull();
  });
});

describe("ranking", () => {
  const docs: Record<string, MatchDoc> = {
    exact: { title: "Permit Tracker" },
    identifier: { title: "Unrelated name", identifiers: ["Permit Tracker"] },
    prefix: { title: "Permit Tracker Archive" },
    field: { title: "Alpha", fields: ["permit tracker notes"] },
    description: { title: "Beta", description: "A permit tracker for cities" },
  };

  it("orders exact > identifier > prefix > field > description", () => {
    const ranked = Object.entries(docs)
      .map(([k, d]) => ({ k, m: matchDocument("permit tracker", d)! }))
      .map(({ k, m }) => ({ k, tier: m.tier, score: combinedScore(m), title: k }))
      .sort(compareRanked);
    expect(ranked.map((r) => r.k)).toEqual([
      "exact",
      "identifier",
      "prefix",
      "field",
      "description",
    ]);
  });

  it("matches exact identifiers ignoring separators", () => {
    expect(matchDocument("#1003", { title: "Test Project 3", identifiers: ["1003"] })?.tier).toBe(
      "identifier",
    );
    expect(matchDocument("JT-1003", { title: "x", identifiers: ["jt 1003"] })?.tier).toBe(
      "identifier",
    );
  });

  it("ranks email and phone matches", () => {
    const doc = {
      title: "Jordan Sample",
      emails: ["jordan@example.test"],
      phones: ["(555) 010-0199"],
    };
    expect(matchDocument("jordan@example.test", doc)?.tier).toBe("identifier");
    expect(matchDocument("example.test", doc)?.tier).toBe("contact");
    expect(matchDocument("0100199", doc)?.tier).toBe("contact");
  });

  it("matches partial and normalized addresses", () => {
    const doc = { title: "Sample ADU", addresses: ["123 North Main Street, Fresno, CA 93701"] };
    expect(matchDocument("123 main st", doc)?.tier).toBe("address");
    expect(matchDocument("123 n main", doc)?.tier).toBe("address");
    expect(matchDocument("999 main st", doc)).toBeNull();
  });

  it("tolerates typos without matching unrelated words", () => {
    expect(matchDocument("reprots", { title: "Reports" })?.tier).toBe("fuzzy");
    expect(matchDocument("invnetory", { title: "Inventory" })?.tier).toBe("fuzzy");
    expect(matchDocument("knowlege center", { title: "Knowledge Center" })?.tier).toBe("fuzzy");
    expect(matchDocument("surveys", { title: "Receipts" })).toBeNull();
    expect(editDistance("teh", "the")).toBe(1);
    expect(editDistance("kitten", "sitting", 3)).toBe(3);
    // Numbers are identifiers: no typo tolerance.
    expect(matchDocument("1004", { title: "Test Project 3", identifiers: ["1003"] })).toBeNull();
    expect(matchDocument("10042", { title: "Job 10043" })).toBeNull();
  });

  it("never lets contextual boosts outrank a better tier", () => {
    const exact = matchDocument("tours", { title: "Tours" })!;
    const fuzzy = matchDocument("tours", { title: "Tour Builder Workspace", keywords: [] })!;
    const boosted = combinedScore(fuzzy, contextBoost({ pinned: true, recent: true, uses: 50 }));
    expect(combinedScore(exact)).toBeGreaterThan(boosted);
    expect(contextBoost({ pinned: true, recent: true, uses: 1000 })).toBeLessThan(100);
  });

  it("uses synonyms only when the literal query misses, capped at field tier", () => {
    const synonyms = new Map([["hr", ["bamboohr"]]]);
    const doc = { title: "BambooHR settings" };
    expect(matchDocument("hr", doc)).toBeNull();
    const hit = matchDocument("hr", doc, { synonyms });
    expect(hit?.tier).toBe("field");
    expect(matchDocument("bamboohr", doc)?.tier).toBe("prefix");
  });

  it("highlights word prefixes, address synonyms, and typos", () => {
    expect(highlightRanges("Test Project 3", "test proj")).toEqual([[0, 9]]);
    const text = "123 Main Street";
    const ranges = highlightRanges(text, "123 main st");
    expect(ranges.map(([s, e]) => text.slice(s, e))).toEqual(["123 Main Street"]);
    expect(highlightRanges("Inventory", "invnetory")).toEqual([[0, 9]]);
    expect(highlightRanges("Nothing here", "zzz")).toEqual([]);
  });
});

describe("output safety", () => {
  it("allows same-origin paths and allow-listed https hosts only", () => {
    expect(validateResultUrl("/reports/abc?x=1")).toEqual({
      url: "/reports/abc?x=1",
      external: false,
    });
    expect(validateResultUrl("https://app.jobtread.com/jobs/job1")?.external).toBe(true);
    expect(validateResultUrl("//evil.example/x")).toBeNull();
    expect(validateResultUrl("javascript:alert(1)")).toBeNull();
    expect(validateResultUrl("https://evil.example/x")).toBeNull();
    expect(validateResultUrl("http://app.jobtread.com/jobs/1")).toBeNull();
    expect(validateResultUrl("https://user:pw@app.jobtread.com/")).toBeNull();
    expect(validateResultUrl("/a\\b")).toBeNull();
  });

  it("strips markup and caps snippets", () => {
    expect(safeText("<b>Hi</b> <script>x</script>there")).toBe("Hi x there");
    expect(safeText("a".repeat(300), 20)).toHaveLength(20);
    expect(safeText("   ")).toBeNull();
    expect(safeText({ not: "text" })).toBeNull();
  });
});

function result(
  partial: Partial<SearchResult> & { id: string; category: SearchResult["category"] },
): SearchResult {
  return {
    provider: "p",
    title: partial.id,
    subtitle: null,
    description: null,
    breadcrumb: [],
    highlight: { title: [], subtitle: [] },
    url: "/",
    external: false,
    icon: "search",
    avatarUrl: null,
    sourceSystem: "baxter",
    sourceLabel: "Baxter",
    recordId: partial.id,
    updatedAt: null,
    freshness: { kind: "live" },
    preview: [],
    auth: "internal",
    actions: [],
    tier: "field",
    score: 0,
    addressKey: null,
    addressDisplay: null,
    ...partial,
  };
}

describe("client sections and labels", () => {
  it("puts the section with the best match first, then fixed category order", () => {
    const outcomes: ProviderOutcome[] = [];
    const sections = buildSections(
      [
        result({ id: "tool", category: "tools", tier: "fuzzy" }),
        result({ id: "cust", category: "customers", tier: "exact" }),
        result({ id: "set", category: "settings", tier: "fuzzy" }),
      ],
      outcomes,
      5,
    );
    expect(sections.map((s) => s.category)).toEqual(["customers", "tools", "settings"]);
  });

  it("counts only what was returned and marks more", () => {
    const outcomes: ProviderOutcome[] = [
      {
        provider: "ghl-contacts",
        name: "x",
        category: "customers",
        status: "ok",
        message: null,
        count: 12,
        hasMore: true,
        latencyMs: 3,
        freshness: { kind: "live" },
      },
    ];
    const s = buildSections([result({ id: "a", category: "customers" })], outcomes, 5)[0]!;
    expect(s.count).toBe(12);
    expect(s.hasMore).toBe(true);
    expect(countLabel(12, false)).toBe("12 results");
    expect(countLabel(1, false)).toBe("1 result");
    expect(countLabel(5, true)).toBe("5+ results");
  });

  it("labels cached data with its sync time and never calls it live", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    const r = result({
      id: "j",
      category: "jobs",
      sourceLabel: "JobTread",
      freshness: { kind: "cached", syncedAt: "2026-10-23T11:48:00Z", label: "Last synced" },
    });
    expect(sourceLine(r, now)).toBe("JobTread · Last synced 12 min ago");
    expect(
      sourceLine(result({ id: "g", category: "customers", sourceLabel: "GoHighLevel" }), now),
    ).toBe("GoHighLevel");
    expect(formatRelative(null)).toBeNull();
  });
});
