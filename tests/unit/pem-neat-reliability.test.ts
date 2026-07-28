import { describe, expect, it } from "vitest";
import {
  coerceEvidencedValue,
  coercePainList,
  coerceSalesIntelligencePartial,
} from "@/lib/pem-neat/coerce";
import {
  countFactLedgerItems,
  emptyFactLedger,
  mergeFactLedgers,
  tryParseFactLedger,
} from "@/lib/pem-neat/fact-ledger";
import { employeeFacingPemError, normalizePemErrorCode } from "@/lib/pem-neat/trace";
import { parsePemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import { emptyPemNeatShell } from "@/lib/pem-neat/defaults";

describe("PEM coerce layer", () => {
  it("coerces string budget targets into evidenced values", () => {
    const coerced = coerceSalesIntelligencePartial({
      customerStory: "Mom needs nearby care.",
      budget: {
        target: "$300k ideal",
        hardCeiling: { value: "$400k", evidenceType: "prospect_fact" },
      },
      decisionProcess: {
        decisionMakers: ["Alex", { value: "Spouse" }],
      },
      type1Pain: ["Aging parent living alone"],
    });
    expect(coerceEvidencedValue("$300k")).toMatchObject({ value: "$300k" });
    expect((coerced.budget as { target: { value: string } }).target.value).toContain("300");
    expect(
      (coerced.decisionProcess as { decisionMakers: Array<{ value: string }> }).decisionMakers,
    ).toHaveLength(2);
    expect(coercePainList(["Aging parent"])[0]?.statement).toContain("Aging");
  });

  it("does not turn malformed top-level into empty sales intelligence after coerce+parse", () => {
    const shell = emptyPemNeatShell({ prospectName: "Alex", advisorName: "Jesse" });
    const coerced = coerceSalesIntelligencePartial({
      customerStory: "Prospect wants ADU for parents.",
      budget: { target: "around 350k", summary: "Flexible working budget" },
      type1Pain: [{ statement: "Independence for mom" }],
    });
    shell.salesIntelligence = {
      ...shell.salesIntelligence,
      ...(coerced as typeof shell.salesIntelligence),
      budget: {
        ...shell.salesIntelligence.budget,
        ...((coerced.budget as object) ?? {}),
      },
      decisionProcess: shell.salesIntelligence.decisionProcess,
      schedule: shell.salesIntelligence.schedule,
      nextSteps: shell.salesIntelligence.nextSteps,
      actonRecommendation: shell.salesIntelligence.actonRecommendation,
      meetingOutcome: shell.salesIntelligence.meetingOutcome,
      qualification: shell.salesIntelligence.qualification,
      type1Pain: (coerced.type1Pain as typeof shell.salesIntelligence.type1Pain) ?? [],
      type2Pain: [],
    };
    const parsed = parsePemNeatStructuredResult(shell);
    expect(parsed.salesIntelligence.customerStory).toContain("ADU");
    expect(
      parsed.salesIntelligence.budget.target?.value ?? parsed.salesIntelligence.budget.summary,
    ).toBeTruthy();
  });
});

describe("Fact ledger", () => {
  it("parses string items and merges fragments without losing budget nuance", () => {
    const a = tryParseFactLedger({
      budget: ["Ideal target around $300k"],
      motivation: ["Mom aging and living alone"],
    });
    const b = tryParseFactLedger({
      budget: [{ summary: "Could stretch to $400k for the right solution", amount: "$400k" }],
      decision: ["Couple decides together"],
    });
    expect(a.ok).toBe(true);
    const merged = mergeFactLedgers([a.ledger, b.ledger]);
    expect(merged.budget.length).toBeGreaterThanOrEqual(2);
    expect(countFactLedgerItems(merged)).toBeGreaterThan(2);
    expect(emptyFactLedger().budget).toEqual([]);
  });
});

describe("PEM error mapping", () => {
  it("normalizes legacy incomplete codes and keeps stage-specific codes", () => {
    expect(normalizePemErrorCode("PEM_NEAT_SCHEMA_INVALID")).toBe("PEM_FINAL_MERGE_INVALID");
    expect(normalizePemErrorCode("PEM_ASSESSMENT_SCHEMA_INVALID")).toBe(
      "PEM_ASSESSMENT_SCHEMA_INVALID",
    );
    expect(normalizePemErrorCode("PEM_FACT_SCHEMA_INVALID", "sales_intelligence")).toBe(
      "PEM_SALES_INTELLIGENCE_SCHEMA_INVALID",
    );
    expect(employeeFacingPemError("PEM_SALES_INTELLIGENCE_SCHEMA_INVALID")).toMatch(
      /sales intelligence/i,
    );
    expect(employeeFacingPemError("PEM_LOW_EVIDENCE_COVERAGE")).toMatch(/enough information/i);
  });
});
