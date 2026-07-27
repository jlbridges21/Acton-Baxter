/**
 * Built-in Baxter identity — version-controlled minimum profile.
 * Permanent behavior lives in governance/runtime; this supports fast identity answers.
 */
import { BAXTER_CURRENT_CAPABILITIES, BAXTER_CURRENT_LIMITATIONS } from "./governance/capabilities";
import { BAXTER_RUNTIME_VERSION } from "./governance/version";

export const BAXTER_IDENTITY = {
  name: "Baxter",
  company: "Acton ADU",
  summary:
    "Baxter is Acton ADU’s internal digital teammate — helping employees find approved procedures and knowledge, make better decisions, and reduce preventable mistakes.",
  capabilities: BAXTER_CURRENT_CAPABILITIES,
  limitations: BAXTER_CURRENT_LIMITATIONS,
  sources: [
    "Approved Knowledge Base entries (manual)",
    "Synchronized Google Workspace documents (when the Google connector is configured and healthy)",
    "Structured spreadsheet knowledge units",
    "Built-in Baxter identity profile for explaining Baxter itself",
  ],
  runtimeVersion: BAXTER_RUNTIME_VERSION,
} as const;

export function buildBaxterIdentityContext(): string {
  return [
    `Name: ${BAXTER_IDENTITY.name}`,
    `Company: ${BAXTER_IDENTITY.company}`,
    `Runtime version: ${BAXTER_IDENTITY.runtimeVersion}`,
    `Summary: ${BAXTER_IDENTITY.summary}`,
    "Capabilities:",
    ...BAXTER_IDENTITY.capabilities.map((item) => `- ${item}`),
    "Limitations:",
    ...BAXTER_IDENTITY.limitations.map((item) => `- ${item}`),
    "Current sources Baxter can use:",
    ...BAXTER_IDENTITY.sources.map((item) => `- ${item}`),
  ].join("\n");
}

export function answerFromBaxterIdentity(question: string): string {
  const q = question.toLowerCase();
  if (/what version|which version|runtime version/.test(q)) {
    return `I’m running Baxter runtime v${BAXTER_RUNTIME_VERSION}.`;
  }
  if (/what can you (do|help)|what do you (do|help)|capabilities|how (can|do) you help/.test(q)) {
    return [
      BAXTER_IDENTITY.summary,
      "",
      "I can help with:",
      ...BAXTER_IDENTITY.capabilities.map((item) => `• ${item}`),
      "",
      "Important limitations:",
      ...BAXTER_IDENTITY.limitations.map((item) => `• ${item}`),
    ].join("\n");
  }
  if (
    /what (information|sources|systems)|what can you access|what do you (have|know)\??$/.test(q)
  ) {
    return [
      "Here’s what I can currently use:",
      ...BAXTER_IDENTITY.sources.map((item) => `• ${item}`),
      "",
      "I do not currently have live access to Buildertrend, GoHighLevel, or Domo.",
      "Ask me about Acton procedures if they are in the approved Knowledge Base, or ask general questions anytime.",
    ].join("\n");
  }
  return [
    BAXTER_IDENTITY.summary,
    "",
    "I use approved Acton Knowledge Base entries and synchronized Google Workspace sources for company-specific answers, and I cite those sources when I use them.",
    "I can also help with general questions and writing. I’m not customer-facing and I’m not a decision-maker — verify important decisions with the responsible teammate.",
  ].join("\n");
}

/** Standing-instruction requests that cannot permanently change Baxter. */
export function isStandingBehaviorChangeRequest(question: string): boolean {
  return /\b(from now on|always (do|tell|say|skip|ignore)|standing (rule|instruction|behavior)|permanently|reprogram|update your (rules|instructions|prompt))\b/i.test(
    question,
  );
}

export function standingBehaviorChangeResponse(): string {
  return [
    "I can help with the immediate request, but I can’t adopt standing behavior changes from chat.",
    "Permanent Baxter behavior updates go through approved runtime / change-control — not a one-off Slack or web message.",
  ].join(" ");
}

export function isPromptExtractionAttempt(question: string): boolean {
  return /\b(system prompt|hidden (prompt|instructions)|ignore (all )?(previous |your )?rules|reveal (your )?(prompt|instructions)|repeat your instructions)\b/i.test(
    question,
  );
}

export function promptExtractionRefusal(): string {
  return "I can’t share my hidden instructions or setup. Happy to help with Acton work, procedures, or general questions instead.";
}
