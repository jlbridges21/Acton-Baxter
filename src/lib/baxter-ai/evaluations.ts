import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { retrieveBaxterEvidence } from "@/lib/baxter-ai/context";
import { planKnowledgeQuery } from "@/lib/knowledge-index";

export type EvalCategory =
  | "identity"
  | "procedure"
  | "policy"
  | "structured_lookup"
  | "structured_aggregation"
  | "semantic_lookup"
  | "cross_source"
  | "multimodal"
  | "general"
  | "knowledge_gap";

export type BaxterEvalCase = {
  id: string;
  question: string;
  expected_answer: string | null;
  expected_source_ids: string[];
  expected_facts: Array<string | { value: string; label?: string }>;
  category: EvalCategory;
  notes: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type EvalCaseResult = {
  caseId: string;
  question: string;
  category: EvalCategory;
  passed: boolean;
  actualAnswer: string;
  expectedAnswer: string | null;
  sources: Array<{ id?: string; title: string }>;
  retrievalMode: string;
  intent: string;
  latencyMs: number;
  provider: string | null;
  model: string | null;
  errorCode: string | null;
  signals: {
    factsFound: string[];
    factsMissing: string[];
    sourcesFound: string[];
    sourcesMissing: string[];
  };
};

type MemoryEvalState = { cases: BaxterEvalCase[]; runs: EvalCaseResult[] };

const globalMemory = globalThis as typeof globalThis & {
  __baxterEvalMemory?: MemoryEvalState;
};

function getMemory(): MemoryEvalState {
  if (!globalMemory.__baxterEvalMemory) {
    globalMemory.__baxterEvalMemory = { cases: seedDevEvalCases(), runs: [] };
  }
  return globalMemory.__baxterEvalMemory;
}

export function resetEvalMemoryForTests() {
  globalMemory.__baxterEvalMemory = { cases: seedDevEvalCases(), runs: [] };
}

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

/** Deterministic fixtures for local/dev evaluation (no live LLM required for fact checks). */
export function seedDevEvalCases(): BaxterEvalCase[] {
  const now = new Date().toISOString();
  return [
    {
      id: "eval-lori-agreement",
      question: "How much was the Lori Harris project agreement for?",
      expected_answer: "$352,933",
      expected_source_ids: [],
      expected_facts: ["352933", "$352,933", "352,933"],
      category: "structured_lookup",
      notes: "Sales Performance Report — Lori Harris agreement amount",
      enabled: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: "eval-lori-close",
      question: "When did Lori Harris close?",
      expected_answer: "March 27, 2025",
      expected_source_ids: [],
      expected_facts: ["2025-03-27", "March 27", "3/27/2025"],
      category: "structured_lookup",
      notes: null,
      enabled: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: "eval-lori-cost",
      question: "What was Lori Harris’s estimated internal cost?",
      expected_answer: "$258,241",
      expected_source_ids: [],
      expected_facts: ["258241", "$258,241", "258,241"],
      category: "structured_lookup",
      notes: null,
      enabled: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: "eval-lori-margin",
      question: "What was Lori Harris’s margin?",
      expected_answer: "26.8%",
      expected_source_ids: [],
      expected_facts: ["26.8", "94692", "$94,692"],
      category: "structured_lookup",
      notes: null,
      enabled: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: "eval-project-count",
      question: "How many projects are in the trailing two-year report?",
      expected_answer: "27",
      expected_source_ids: [],
      expected_facts: ["27"],
      category: "structured_aggregation",
      notes: null,
      enabled: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: "eval-semantic-feasibility",
      question: "What happens after someone buys the feasibility package?",
      expected_answer: "site inspection",
      expected_source_ids: [],
      expected_facts: ["site inspection", "inspection"],
      category: "semantic_lookup",
      notes: "Wording differs from source procedure text",
      enabled: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: "eval-multimodal-diagram",
      question: "What happens after Site Inspection according to the diagram?",
      expected_answer: "Project Findings",
      expected_source_ids: [],
      expected_facts: ["Project Findings", "findings"],
      category: "multimodal",
      notes: "Image OCR / diagram fixture",
      enabled: true,
      created_at: now,
      updated_at: now,
    },
  ];
}

export async function listEvalCases(options?: {
  enabledOnly?: boolean;
}): Promise<BaxterEvalCase[]> {
  if (shouldUseMemory()) {
    const cases = getMemory().cases;
    return options?.enabledOnly ? cases.filter((c) => c.enabled) : cases;
  }
  const supabase = createServiceClient();
  let query = supabase
    .from("baxter_eval_cases")
    .select("*")
    .order("created_at", { ascending: true });
  if (options?.enabledOnly) query = query.eq("enabled", true);
  const { data, error } = await query;
  if (error || !data?.length) {
    return options?.enabledOnly ? seedDevEvalCases().filter((c) => c.enabled) : seedDevEvalCases();
  }
  return data as BaxterEvalCase[];
}

function normalizeFact(value: string): string {
  return value
    .toLowerCase()
    .replace(/[$,%\s]/g, "")
    .replace(/,/g, "");
}

export function checkExpectedFacts(
  answer: string,
  expectedFacts: BaxterEvalCase["expected_facts"],
): { found: string[]; missing: string[] } {
  const haystack = normalizeFact(answer);
  const found: string[] = [];
  const missing: string[] = [];
  for (const fact of expectedFacts) {
    const raw = typeof fact === "string" ? fact : fact.value;
    const needle = normalizeFact(raw);
    if (!needle) continue;
    if (haystack.includes(needle) || answer.toLowerCase().includes(raw.toLowerCase())) {
      found.push(raw);
    } else {
      missing.push(raw);
    }
  }
  return { found, missing };
}

/**
 * Run a single evaluation case with deterministic fact/source checks.
 * Uses retrieval + optional full answer path; does not require an LLM judge.
 */
export async function runEvalCase(
  evalCase: BaxterEvalCase,
  options?: { useFullAnswer?: boolean },
): Promise<EvalCaseResult> {
  const started = Date.now();
  let actualAnswer = "";
  let sources: Array<{ id?: string; title: string }> = [];
  let retrievalMode = "";
  let intent = "";
  let provider: string | null = null;
  let model: string | null = null;
  let errorCode: string | null = null;

  try {
    const plan = planKnowledgeQuery(evalCase.question);
    intent = plan.intent;
    retrievalMode = plan.mode;

    const evidence = await retrieveBaxterEvidence(evalCase.question);
    retrievalMode = evidence.queryMode;
    intent = evidence.intent;
    sources = evidence.contextItems.map((c) => ({ id: c.id, title: c.title }));

    if (options?.useFullAnswer) {
      const answered = await answerBaxterQuestion({
        question: evalCase.question,
        userId: null,
        channel: "web",
        userName: "Eval Runner",
      });
      actualAnswer = answered.answer;
      sources = answered.sources.map((s) => ({
        id: s.knowledgeEntryId,
        title: s.title,
      }));
      provider = null;
      model = null;
      errorCode = answered.errorCode ?? null;
    } else {
      // Prefer structured evidence package for deterministic checks
      actualAnswer =
        evidence.evidencePackage ||
        evidence.contextItems.map((c) => c.contentExcerpt).join("\n") ||
        "";
    }
  } catch (error) {
    errorCode = error instanceof Error ? error.message.slice(0, 80) : "EVAL_ERROR";
    actualAnswer = "";
  }

  const facts = checkExpectedFacts(actualAnswer, evalCase.expected_facts);
  const sourcesFound = evalCase.expected_source_ids.filter((id) =>
    sources.some((s) => s.id === id),
  );
  const sourcesMissing = evalCase.expected_source_ids.filter(
    (id) => !sources.some((s) => s.id === id),
  );

  const factsOk =
    evalCase.expected_facts.length === 0 ||
    facts.found.length > 0 ||
    (evalCase.expected_answer
      ? normalizeFact(actualAnswer).includes(normalizeFact(evalCase.expected_answer))
      : false);
  const sourcesOk = evalCase.expected_source_ids.length === 0 || sourcesMissing.length === 0;

  const passed = Boolean(factsOk && sourcesOk && !errorCode);

  const result: EvalCaseResult = {
    caseId: evalCase.id,
    question: evalCase.question,
    category: evalCase.category,
    passed,
    actualAnswer,
    expectedAnswer: evalCase.expected_answer,
    sources,
    retrievalMode,
    intent,
    latencyMs: Date.now() - started,
    provider,
    model,
    errorCode,
    signals: {
      factsFound: facts.found,
      factsMissing: facts.missing,
      sourcesFound,
      sourcesMissing,
    },
  };

  if (shouldUseMemory()) {
    getMemory().runs.unshift(result);
  } else {
    try {
      const supabase = createServiceClient();
      await supabase.from("baxter_eval_runs").insert({
        case_id: evalCase.id,
        passed: result.passed,
        actual_answer: result.actualAnswer,
        sources_json: result.sources,
        retrieval_mode: result.retrievalMode,
        latency_ms: result.latencyMs,
        provider: result.provider,
        model: result.model,
        error_code: result.errorCode,
        signals: result.signals,
      });
    } catch {
      // table may be missing until migration 017
    }
  }

  return result;
}

export async function runEnabledEvalSuite(options?: { useFullAnswer?: boolean }): Promise<{
  total: number;
  passed: number;
  failed: number;
  byCategory: Record<string, { passed: number; failed: number }>;
  results: EvalCaseResult[];
}> {
  const cases = await listEvalCases({ enabledOnly: true });
  const results: EvalCaseResult[] = [];
  for (const evalCase of cases) {
    results.push(await runEvalCase(evalCase, options));
  }
  const byCategory: Record<string, { passed: number; failed: number }> = {};
  for (const r of results) {
    const bucket = byCategory[r.category] ?? { passed: 0, failed: 0 };
    if (r.passed) bucket.passed += 1;
    else bucket.failed += 1;
    byCategory[r.category] = bucket;
  }
  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    byCategory,
    results,
  };
}
