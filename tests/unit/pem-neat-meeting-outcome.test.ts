import { describe, expect, it } from "vitest";
import {
  formatMeetingOutcomeLabel,
  formatMeetingOutcomeWithDate,
} from "@/components/pem-neat/pem-neat-formatters";
import { emptyPemNeatShell } from "@/lib/pem-neat/defaults";
import { outcomeDecisionDate } from "@/lib/pem-neat/meeting-outcome";
import {
  buildAssessmentStagePrompt,
  buildSalesIntelligenceStagePrompt,
} from "@/lib/pem-neat/prompts";
import { parsePemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import {
  mapSalesIntelligenceStageToCanonical,
  parseSalesIntelligenceStage,
  SALES_INTELLIGENCE_JSON_SCHEMA,
} from "@/lib/pem-neat/sales-intelligence-stage";
import { ROBERT_STYLE_SI_STAGE } from "../fixtures/pem-neat-robert-style-ledger";

function siWithOutcome(meetingOutcome: Record<string, unknown>) {
  return { ...ROBERT_STYLE_SI_STAGE, meetingOutcome };
}

describe("meeting outcome decision date", () => {
  it("carries a DECISION_DATE date through Stage B into the canonical result", () => {
    const parsed = parseSalesIntelligenceStage(
      siWithOutcome({
        classification: "DECISION_DATE",
        explanation:
          "Homeowners will reconvene Friday at noon to decide on the Feasibility Package.",
        decisionDate: "Fri, Oct 16, 12:00 PM",
        transcriptIncomplete: false,
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const canonical = mapSalesIntelligenceStageToCanonical(parsed.data);
    expect(canonical.meetingOutcome.decisionDate).toBe("Fri, Oct 16, 12:00 PM");
  });

  it("drops a date on outcomes that cannot carry one and blanks to null", () => {
    expect(outcomeDecisionDate("DECISION_DATE_NOT_SECURED", "Fri, Oct 16")).toBeNull();
    expect(outcomeDecisionDate("NO", "Fri, Oct 16")).toBeNull();
    expect(outcomeDecisionDate("DECISION_DATE", "   ")).toBeNull();
    expect(outcomeDecisionDate("YES", "Mon, Oct 19")).toBe("Mon, Oct 19");
  });

  it("strict JSON schema requires decisionDate as nullable string", () => {
    const outcome = SALES_INTELLIGENCE_JSON_SCHEMA.properties.meetingOutcome;
    expect(outcome.required).toContain("decisionDate");
    expect(outcome.properties.decisionDate.type).toEqual(["string", "null"]);
  });

  it("older stored results without decisionDate still parse", () => {
    const shell = emptyPemNeatShell({ prospectName: "Test Prospect", advisorName: "Advisor" });
    const legacy = JSON.parse(JSON.stringify(shell));
    delete legacy.salesIntelligence.meetingOutcome.decisionDate;
    const parsed = parsePemNeatStructuredResult(legacy);
    expect(parsed.salesIntelligence.meetingOutcome.decisionDate).toBeNull();
  });

  it("header labels read as outcomes, with the date appended when known", () => {
    expect(formatMeetingOutcomeLabel("DECISION_DATE")).toBe("DECISION MEETING SCHEDULED");
    expect(formatMeetingOutcomeLabel("DECISION_DATE_NOT_SECURED")).toBe("NO DECISION DATE SET");
    expect(formatMeetingOutcomeWithDate("DECISION_DATE", "Fri, Oct 16, 12:00 PM")).toBe(
      "DECISION MEETING SCHEDULED — Fri, Oct 16, 12:00 PM",
    );
    expect(formatMeetingOutcomeWithDate("DECISION_DATE", null)).toBe("DECISION MEETING SCHEDULED");
  });

  it("both outcome-setting stages carry the code-owned outcome rules", () => {
    for (const prompt of [buildSalesIntelligenceStagePrompt(), buildAssessmentStagePrompt()]) {
      expect(prompt).toMatch(/MEETING OUTCOME RULES/);
      expect(prompt).toMatch(/decisionDate/);
    }
  });
});
