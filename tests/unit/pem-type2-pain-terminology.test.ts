import { describe, expect, it } from "vitest";
import { ASSESSMENT_CATEGORY_LABELS } from "@/lib/pem-neat/constants";
import { BUILDERTREND_FIELD_DEFS } from "@/lib/pem-neat/buildertrend-display";
import {
  buildPemNeatSystemPrompt,
  buildSalesIntelligenceStagePrompt,
} from "@/lib/pem-neat/prompts";
import { getPemField } from "@/lib/baxter-data/pem-neats/fields";

describe("PEM Type 1 / Type 2 Pain terminology", () => {
  it("assessment scorecard uses Type 1 / Type 2 labels (not Customer Pain)", () => {
    expect(ASSESSMENT_CATEGORY_LABELS.type1_pain).toMatch(/Type 1 Pain/i);
    expect(ASSESSMENT_CATEGORY_LABELS.type1_pain).toMatch(/Why Build an ADU/i);
    expect(ASSESSMENT_CATEGORY_LABELS.type2_pain).toMatch(/Type 2 Pain/i);
    expect(ASSESSMENT_CATEGORY_LABELS.type2_pain).toMatch(/Why Acton|Right Partner/i);
    expect(ASSESSMENT_CATEGORY_LABELS.type2_pain).not.toMatch(/^Customer Pain$/i);
  });

  it("BuilderTrend keeps copy field names and clarifies Type 1 / Type 2 via hints", () => {
    const pain1 = BUILDERTREND_FIELD_DEFS.find((d) => d.key === "customerPain1");
    const pain2 = BUILDERTREND_FIELD_DEFS.find((d) => d.key === "customerPain");
    expect(pain1?.label).toBe("Customer Pain 1");
    expect(pain1?.hint).toMatch(/Type 1 Pain/i);
    expect(pain2?.label).toBe("Customer Pain");
    expect(pain2?.hint).toMatch(/Type 2 Pain/i);
    expect(pain2?.hint).toMatch(/Acton|Right Partner/i);
  });

  it("generation prompts distinguish Type 1 (why build) from Type 2 (why partner)", () => {
    const system = buildPemNeatSystemPrompt();
    expect(system).toMatch(/TYPE 1 PAIN/i);
    expect(system).toMatch(/Why build an ADU/i);
    expect(system).toMatch(/TYPE 2 PAIN/i);
    expect(system).toMatch(/right partner|Acton/i);
    expect(system).toMatch(/Do NOT merge Type 1/i);

    const stageB = buildSalesIntelligenceStagePrompt();
    expect(stageB).toMatch(/type1Pain/);
    expect(stageB).toMatch(/type2Pain/);
    expect(stageB).toMatch(/Why build an ADU/i);
    expect(stageB).toMatch(/Why Acton \/ the right partner/i);
  });

  it("getPemField labels Type 2 distinctly from generic Customer Pain", () => {
    const t2 = getPemField(
      {
        salesIntelligence: {
          type2Pain: [{ statement: "Wants turnkey delivery after a bad remodel." }],
        },
      } as never,
      "type_2_pain",
    );
    expect(t2.label).toMatch(/Type 2 Pain/i);
    expect(t2.label).not.toBe("Customer Pain");
  });
});

describe("PEM pain classification fixtures (prompt contract)", () => {
  it("Type 2 fixture themes are called out in the system prompt", () => {
    const system = buildPemNeatSystemPrompt().toLowerCase();
    expect(system).toContain("contractor");
    expect(system).toContain("turnkey");
    expect(system).toContain("communication");
    expect(system).toContain("transparency");
    expect(system).toContain("trust");
  });

  it("Type 1 fixture themes (family / ADU motivation) are called out separately", () => {
    const system = buildPemNeatSystemPrompt();
    expect(system.toLowerCase()).toMatch(/adult child|multigenerational|aging|rental income/);
    expect(system).toMatch(/Do NOT put contractor\/partner concerns here/i);
  });
});
