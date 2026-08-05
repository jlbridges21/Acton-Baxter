import { beforeEach, describe, expect, it } from "vitest";
import {
  JURISDICTION_RULE_KEYS,
  createJurisdictionRule,
  detectJurisdictionKeyFromText,
  formatJurisdictionRuleValue,
  looksLikeBuildingCodeQuestion,
  resetJurisdictionRulesMemoryForTests,
  resolveJurisdictionKey,
  resolveJurisdictionKeyFromReport,
  selectRulesForZoning,
  jurisdictionRuleWriteSchema,
} from "@/lib/jurisdictions";
import { filterAndRankApprovedKnowledge } from "@/lib/knowledge/retrieval";
import type { KnowledgeEntry } from "@/lib/knowledge/types";

describe("jurisdiction key resolution", () => {
  it("reuses connector selection for San Jose vs Santa Clara County", () => {
    expect(resolveJurisdictionKey({ city: "San Jose", county: "Santa Clara", state: "CA" })).toBe(
      "ca-san-jose",
    );
    expect(resolveJurisdictionKey({ city: "Los Altos", county: "Santa Clara", state: "CA" })).toBe(
      "ca-santa-clara-county",
    );
  });

  it("maps report identity fields the same way", () => {
    expect(
      resolveJurisdictionKeyFromReport({
        jurisdiction_name: "San Jose",
        county: "Santa Clara",
        state: "CA",
      }),
    ).toBe("ca-san-jose");
  });

  it("detects jurisdiction from free text", () => {
    expect(detectJurisdictionKeyFromText("What is the San Jose ADU setback?")).toBe("ca-san-jose");
    expect(detectJurisdictionKeyFromText("unincorporated Santa Clara County sprinklers")).toBe(
      "ca-santa-clara-county",
    );
  });
});

describe("jurisdiction rule keys and citations", () => {
  beforeEach(() => {
    resetJurisdictionRulesMemoryForTests();
  });

  it("exposes the initial vocabulary for downstream prompts", () => {
    expect(JURISDICTION_RULE_KEYS).toContain("fire_sprinkler_hydrant_distance_max_ft");
    expect(JURISDICTION_RULE_KEYS).toContain("adu_setback_front_ft");
    expect(JURISDICTION_RULE_KEYS).toContain("adu_setback_side_ft");
    expect(JURISDICTION_RULE_KEYS).toContain("adu_setback_rear_ft");
    expect(JURISDICTION_RULE_KEYS).toContain("adu_max_height_ft");
    expect(JURISDICTION_RULE_KEYS).toContain("adu_max_size_sqft");
  });

  it("refuses rules without a source citation", () => {
    const parsed = jurisdictionRuleWriteSchema.safeParse({
      jurisdiction_key: "ca-san-jose",
      rule_key: "adu_setback_rear_ft",
      value_json: { kind: "quantity", value: 4, unit: "ft" },
      source_citation: "   ",
    });
    expect(parsed.success).toBe(false);
  });

  it("creates citation-required rules in the memory store", async () => {
    const rule = await createJurisdictionRule(
      {
        jurisdiction_key: "ca-san-jose",
        rule_key: "fire_sprinkler_hydrant_distance_max_ft",
        value_json: { kind: "quantity", value: 150, unit: "ft" },
        source_citation: "SJMC 20.30.150(b)",
      },
      "user-1",
    );
    expect(rule.source_citation).toBe("SJMC 20.30.150(b)");
    expect(formatJurisdictionRuleValue(rule.value_json)).toBe("150 ft");
  });

  it("selects zone-specific rules when zoning matches, otherwise general", () => {
    const rules = [
      {
        id: "1",
        jurisdiction_key: "ca-san-jose",
        rule_key: "adu_setback_rear_ft",
        zone_key: null,
        value_json: { kind: "quantity" as const, value: 4, unit: "ft" },
        source_citation: "SJMC general",
        source_knowledge_entry_id: null,
        notes: null,
        created_by: null,
        updated_by: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "2",
        jurisdiction_key: "ca-san-jose",
        rule_key: "adu_setback_rear_ft",
        zone_key: "R-1-8",
        value_json: { kind: "quantity" as const, value: 3, unit: "ft" },
        source_citation: "SJMC R-1-8",
        source_knowledge_entry_id: null,
        notes: null,
        created_by: null,
        updated_by: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];

    const zoneHit = selectRulesForZoning(rules, "R-1-8");
    expect(zoneHit.usedZoneSpecificRules).toBe(true);
    expect(zoneHit.selected[0]?.id).toBe("2");

    const fallback = selectRulesForZoning(rules, "R-2");
    expect(fallback.fellBackToGeneralRules).toBe(true);
    expect(fallback.selected[0]?.id).toBe("1");
  });
});

describe("knowledge jurisdiction retrieval filter", () => {
  const base = (overrides: Partial<KnowledgeEntry>): KnowledgeEntry => ({
    id: "e1",
    title: "San Jose ADU Code",
    content: "Accessory dwelling unit setbacks and sprinklers",
    summary: null,
    category: "Other",
    tags: ["adu"],
    source_name: "SJMC",
    source_type: "uploaded_document",
    source_url: null,
    source_external_id: null,
    status: "approved",
    visibility: "internal",
    jurisdiction_key: "ca-san-jose",
    doc_kind: "building_code",
    version: 1,
    created_by: null,
    updated_by: null,
    approved_by: null,
    approved_at: null,
    archived_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    metadata: {},
    ...overrides,
  });

  it("excludes other jurisdictions' code documents", () => {
    const entries = [
      base({ id: "sj", jurisdiction_key: "ca-san-jose" }),
      base({
        id: "scc",
        title: "Santa Clara County ADU Code",
        jurisdiction_key: "ca-santa-clara-county",
      }),
      base({
        id: "process",
        title: "PEM Preparation checklist",
        content: "Internal Acton PEM process",
        jurisdiction_key: null,
        doc_kind: null,
      }),
    ];

    const results = filterAndRankApprovedKnowledge(entries, {
      query: "ADU setbacks",
      jurisdictionKey: "ca-san-jose",
    });
    const ids = results.map((row) => row.id);
    expect(ids).toContain("sj");
    expect(ids).toContain("process");
    expect(ids).not.toContain("scc");
  });

  it("detects building-code questions for chat wiring", () => {
    expect(looksLikeBuildingCodeQuestion("What is the San Jose ADU rear setback?")).toBe(true);
    expect(looksLikeBuildingCodeQuestion("Who owns the GHL pipeline?")).toBe(false);
  });
});
