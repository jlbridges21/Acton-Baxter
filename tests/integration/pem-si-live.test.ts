/**
 * Live GPT-5.4 Sales Intelligence probe.
 * Skips when OPENAI_API_KEY is unset. Not part of default `npm test`.
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

describe.runIf(hasKey)("Live GPT-5.4 Sales Intelligence", () => {
  it("returns schema-valid substantive SI from robert-style fact ledger", async () => {
    const { callPemOpenAiJsonWithRetries, resolvePemNeatModelName } =
      await import("@/lib/pem-neat/openai-client");
    const { buildSalesIntelligenceStagePrompt } = await import("@/lib/pem-neat/prompts");
    const {
      extractBudgetCandidatesFromLedger,
      parseSalesIntelligenceStage,
      SALES_INTELLIGENCE_JSON_SCHEMA,
    } = await import("@/lib/pem-neat/sales-intelligence-stage");
    const { ROBERT_STYLE_FACT_LEDGER } = await import("../fixtures/pem-neat-robert-style-ledger");

    const model = resolvePemNeatModelName();
    const budgetCandidates = extractBudgetCandidatesFromLedger(ROBERT_STYLE_FACT_LEDGER);
    const res = await callPemOpenAiJsonWithRetries({
      model,
      messages: [
        { role: "system", content: buildSalesIntelligenceStagePrompt() },
        {
          role: "user",
          content: `Prospect: Homeowner
Advisor: Jesse

Budget candidates:
${budgetCandidates.map((b) => `- ${b}`).join("\n")}

Fact Ledger:
${JSON.stringify(ROBERT_STYLE_FACT_LEDGER).slice(0, 80_000)}`,
        },
      ],
      maxOutputTokens: 8_000,
      temperature: 0.25,
      reasoningEffort: "high",
      timeoutMs: 240_000,
      jsonSchema: {
        name: "pem_sales_intelligence",
        schema: SALES_INTELLIGENCE_JSON_SCHEMA as unknown as Record<string, unknown>,
        strict: true,
      },
    });

    const raw = JSON.parse(res.content) as unknown;
    const parsed = parseSalesIntelligenceStage(raw);
    expect(parsed.ok, parsed.ok ? "" : parsed.issues.join("\n")).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.data.customerStory.length).toBeGreaterThan(80);
    expect(parsed.data.type1Pain.drivers.length).toBeGreaterThan(0);
    expect(parsed.data.type2Pain.drivers.length).toBeGreaterThan(0);
    expect(parsed.data.budget.availableFunds ?? parsed.data.budget.statedTarget).toBeTruthy();
    expect(parsed.data.decisionProcess.alternatives.length).toBeGreaterThan(0);
    expect(parsed.data.actonRecommendation.summary.length).toBeGreaterThan(20);
  }, 300_000);
});

describe.runIf(!hasKey)("Live GPT-5.4 Sales Intelligence (skipped)", () => {
  it("skips when OPENAI_API_KEY is unset", () => {
    expect(hasKey).toBe(false);
  });
});
