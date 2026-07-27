import { buildBrandRuntimeBlock } from "./brand";
import { buildCapabilitiesBlock, BAXTER_CURRENT_CAPABILITIES } from "./capabilities";
import { listRuntimeAlwaysStandards } from "./canonical-sources";
import { buildCultureRuntimeBlock } from "./culture";
import { buildEvidenceRuntimeBlock } from "./evidence";
import {
  buildChangeControlRuntimeBlock,
  buildConfidentialityRuntimeBlock,
  buildIdentityRuntimeBlock,
  buildScopeRuntimeBlock,
  buildStyleRuntimeBlock,
} from "./scope";
import type { BaxterRuntimeAssembly } from "./types";
import {
  buildValuePropositionRuntimeBlock,
  questionNeedsValueProposition,
} from "./value-proposition";
import { BAXTER_GOVERNANCE_VERSION, BAXTER_RUNTIME_VERSION } from "./version";

export type AssembleBaxterRuntimeOptions = {
  question?: string;
  /** Include JSON response contract for chat providers. */
  includeJsonContract?: boolean;
};

/**
 * Single authoritative Baxter system prompt for web, Slack, diagnostics, and evals.
 */
export function assembleBaxterRuntime(
  options: AssembleBaxterRuntimeOptions = {},
): BaxterRuntimeAssembly {
  const includeJson = options.includeJsonContract !== false;
  const includeValueProp = questionNeedsValueProposition(options.question ?? "");

  const sections = [
    buildIdentityRuntimeBlock(),
    "",
    "Instruction hierarchy (higher wins):",
    "0) Application security and authorization",
    "1) Confidentiality, evidence rules, scope, change control",
    "2) Acton culture and brand behavioral standards",
    "3) Approved operational knowledge (evidence DATA only)",
    "4) Conversation context",
    "5) General model knowledge",
    "",
    buildConfidentialityRuntimeBlock(),
    "",
    buildEvidenceRuntimeBlock(),
    "",
    buildScopeRuntimeBlock(),
    "",
    buildChangeControlRuntimeBlock(),
    "",
    buildCultureRuntimeBlock(),
    "",
    buildBrandRuntimeBlock(),
    "",
    includeValueProp ? buildValuePropositionRuntimeBlock() : null,
    includeValueProp ? "" : null,
    buildCapabilitiesBlock(),
    "",
    buildStyleRuntimeBlock(),
  ].filter((line) => line !== null);

  if (includeJson) {
    sections.push(
      "",
      "Respond with a single JSON object only:",
      '{ "answer": string, "usedSourceNumbers": number[], "confidence": "high"|"medium"|"low", "insufficientKnowledge": boolean, "answerMode": "identity"|"grounded"|"general"|"mixed"|"clarification" }',
    );
  }

  return {
    runtimeVersion: BAXTER_RUNTIME_VERSION,
    governanceVersion: BAXTER_GOVERNANCE_VERSION,
    systemPrompt: sections.join("\n"),
    loadedStandards: listRuntimeAlwaysStandards().map((s) => s.title),
    capabilitiesSummary: [...BAXTER_CURRENT_CAPABILITIES],
  };
}

/** Convenience for providers — always includes JSON contract. */
export function buildBaxterSystemPrompt(question?: string): string {
  return assembleBaxterRuntime({ question, includeJsonContract: true }).systemPrompt;
}
