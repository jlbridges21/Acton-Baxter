/**
 * Live GPT-5.4 assessment + downstream stages (skips without OPENAI_API_KEY).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2] ?? "";
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();
const hasKey = Boolean(process.env.OPENAI_API_KEY?.trim());

describe.runIf(hasKey)("Live GPT-5.4 Assessment + downstream", () => {
  it("assessment → email → handoff → quality review validate", async () => {
    const { callPemOpenAiJsonWithRetries, resolvePemNeatModelName } =
      await import("@/lib/pem-neat/openai-client");
    const {
      buildAssessmentStagePrompt,
      buildEmailStagePrompt,
      buildHandoffStagePrompt,
      buildQualityReviewStagePrompt,
    } = await import("@/lib/pem-neat/prompts");
    const { ASSESSMENT_JSON_SCHEMA, mapAssessmentStageToCanonical, parseAssessmentStage } =
      await import("@/lib/pem-neat/assessment-stage");
    const {
      EMAIL_JSON_SCHEMA,
      HANDOFF_JSON_SCHEMA,
      QUALITY_REVIEW_JSON_SCHEMA,
      parseEmailStage,
      parseHandoffStage,
      parseQualityReviewStage,
      applyHandoffStageToShell,
    } = await import("@/lib/pem-neat/downstream-stages");
    const { emptyPemNeatShell } = await import("@/lib/pem-neat/defaults");
    const { mapSalesIntelligenceStageToCanonical } =
      await import("@/lib/pem-neat/sales-intelligence-stage");
    const { parsePemNeatStructuredResult } = await import("@/lib/pem-neat/schemas");
    const { ROBERT_STYLE_FACT_LEDGER, ROBERT_STYLE_SI_STAGE } =
      await import("../fixtures/pem-neat-robert-style-ledger");
    const { ROBERT_STYLE_PEM_TRANSCRIPT } = await import("../fixtures/pem-neat-robert-style");

    const model = resolvePemNeatModelName();
    const shell = emptyPemNeatShell({ prospectName: "Homeowner", advisorName: "Jesse" });
    shell.salesIntelligence = {
      ...shell.salesIntelligence,
      ...mapSalesIntelligenceStageToCanonical(ROBERT_STYLE_SI_STAGE),
    };

    const assessRes = await callPemOpenAiJsonWithRetries({
      model,
      messages: [
        { role: "system", content: buildAssessmentStagePrompt() },
        {
          role: "user",
          content: `Prospect: Homeowner
Advisor: Jesse
TranscriptIncompleteHint: false

Fact Ledger:
${JSON.stringify(ROBERT_STYLE_FACT_LEDGER).slice(0, 60_000)}

Sales Intelligence:
${JSON.stringify(shell.salesIntelligence).slice(0, 30_000)}

FULL TRANSCRIPT:
${ROBERT_STYLE_PEM_TRANSCRIPT.slice(0, 80_000)}`,
        },
      ],
      maxOutputTokens: 10_000,
      temperature: 0.25,
      reasoningEffort: "high",
      timeoutMs: 300_000,
      jsonSchema: {
        name: "pem_assessment",
        schema: ASSESSMENT_JSON_SCHEMA as unknown as Record<string, unknown>,
        strict: true,
      },
    });

    const assessParsed = parseAssessmentStage(JSON.parse(assessRes.content));
    expect(assessParsed.ok, assessParsed.ok ? "" : assessParsed.issues.join("\n")).toBe(true);
    if (!assessParsed.ok) return;
    shell.assessment = mapAssessmentStageToCanonical(assessParsed.data).assessment;
    const scored = shell.assessment.categories.filter((c) => c.score != null).length;
    expect(scored).toBeGreaterThan(5);

    const emailRes = await callPemOpenAiJsonWithRetries({
      model,
      messages: [
        { role: "system", content: buildEmailStagePrompt() },
        {
          role: "user",
          content: `Prospect: Homeowner\nAdvisor: Jesse\n${JSON.stringify({
            customerStory: shell.salesIntelligence.customerStory,
            customerPain: shell.salesIntelligence.customerPain,
            nextSteps: shell.salesIntelligence.nextSteps,
          })}`,
        },
      ],
      maxOutputTokens: 4_000,
      temperature: 0.3,
      reasoningEffort: "medium",
      timeoutMs: 180_000,
      jsonSchema: {
        name: "pem_follow_up_email",
        schema: EMAIL_JSON_SCHEMA as unknown as Record<string, unknown>,
        strict: true,
      },
    });
    const emailParsed = parseEmailStage(JSON.parse(emailRes.content));
    expect(emailParsed.ok).toBe(true);
    if (!emailParsed.ok) return;
    shell.followUpEmail = emailParsed.data;

    const handoffRes = await callPemOpenAiJsonWithRetries({
      model,
      messages: [
        { role: "system", content: buildHandoffStagePrompt() },
        {
          role: "user",
          content: `Prospect: Homeowner\nAdvisor: Jesse\nFact Ledger:\n${JSON.stringify(ROBERT_STYLE_FACT_LEDGER).slice(0, 50_000)}\nSI:\n${JSON.stringify(shell.salesIntelligence).slice(0, 30_000)}`,
        },
      ],
      maxOutputTokens: 10_000,
      temperature: 0.25,
      reasoningEffort: "high",
      timeoutMs: 300_000,
      jsonSchema: {
        name: "pem_handoff",
        schema: HANDOFF_JSON_SCHEMA as unknown as Record<string, unknown>,
        strict: true,
      },
    });
    const handoffParsed = parseHandoffStage(JSON.parse(handoffRes.content));
    expect(handoffParsed.ok, handoffParsed.ok ? "" : handoffParsed.issues.join("\n")).toBe(true);
    if (!handoffParsed.ok) return;
    applyHandoffStageToShell(shell, handoffParsed.data);

    const reviewRes = await callPemOpenAiJsonWithRetries({
      model,
      messages: [
        { role: "system", content: buildQualityReviewStagePrompt() },
        {
          role: "user",
          content: `Fact Ledger:\n${JSON.stringify(ROBERT_STYLE_FACT_LEDGER).slice(0, 40_000)}\nNEAT preview:\n${JSON.stringify(
            {
              salesIntelligence: shell.salesIntelligence,
              assessment: shell.assessment.categories.map((c) => ({
                key: c.key,
                score: c.score,
                status: c.status,
              })),
              followUpEmail: shell.followUpEmail,
            },
          ).slice(0, 40_000)}`,
        },
      ],
      maxOutputTokens: 4_000,
      temperature: 0.2,
      reasoningEffort: "medium",
      timeoutMs: 180_000,
      jsonSchema: {
        name: "pem_quality_review",
        schema: QUALITY_REVIEW_JSON_SCHEMA as unknown as Record<string, unknown>,
        strict: true,
      },
    });
    const reviewParsed = parseQualityReviewStage(JSON.parse(reviewRes.content));
    expect(reviewParsed.ok).toBe(true);

    expect(() => parsePemNeatStructuredResult(shell)).not.toThrow();
  }, 900_000);
});

describe.runIf(!hasKey)("Live GPT-5.4 Assessment (skipped)", () => {
  it("skips when OPENAI_API_KEY is unset", () => {
    expect(hasKey).toBe(false);
  });
});
