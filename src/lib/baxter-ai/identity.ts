/**
 * Built-in Baxter identity — version-controlled minimum profile.
 * Permanent behavior lives in governance/runtime; this supports fast identity answers.
 * Detailed "what can you do" answers come from the live capability registry in answer.ts.
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
    "Completed PEM NEAT structured sales intelligence (when authorized)",
    "Live GoHighLevel CRM evidence when connected (contacts, addresses, owners, tags, custom fields, opportunities, conversations — not Knowledge Base policy)",
    "Process Rulebook evidence (when an active rulebook is loaded)",
    "Built-in Baxter capability registry for explaining Baxter itself",
  ],
  runtimeVersion: BAXTER_RUNTIME_VERSION,
} as const;

export function buildBaxterIdentityContext(): string {
  return [
    `Name: ${BAXTER_IDENTITY.name}`,
    `Company: ${BAXTER_IDENTITY.company}`,
    `Runtime version: ${BAXTER_IDENTITY.runtimeVersion}`,
    `Summary: ${BAXTER_IDENTITY.summary}`,
    "Capabilities (summary — prefer the live capability registry for current tool status):",
    ...BAXTER_IDENTITY.capabilities.map((item) => `- ${item}`),
    "Limitations:",
    ...BAXTER_IDENTITY.limitations.map((item) => `- ${item}`),
    "Current sources Baxter can use:",
    ...BAXTER_IDENTITY.sources.map((item) => `- ${item}`),
    "Hard limits: no direct BuilderTrend API (PEM handoff fields are copy/paste only); CRM writes require confirmation when enabled.",
  ].join("\n");
}

export function answerFromBaxterIdentity(question: string): string {
  const q = question.toLowerCase();
  if (/what version|which version|runtime version/.test(q)) {
    return `I’m running Baxter runtime v${BAXTER_RUNTIME_VERSION}.`;
  }
  if (/what can you (do|help)|what do you (do|help)|capabilities|how (can|do) you help/.test(q)) {
    // Prefer answerCapabilityHelp in answer.ts; this remains a safe fallback.
    return [
      "I’m Baxter, Acton ADU’s internal AI teammate.",
      "",
      "I can help with Acton knowledge, PEM NEATs (including questions about completed meetings), Property Research, connected CRM lookups when GoHighLevel is available, Process Rulebook questions when loaded, and general writing/analysis — here and in Slack.",
      "",
      "I don’t have a direct BuilderTrend API connection (I can prepare PEM handoff fields for copy/paste), and I won’t change CRM records without confirmation.",
    ].join("\n");
  }
  if (
    /what (information|sources|systems)|what can you access|what do you (have|know)\??$/.test(q)
  ) {
    return [
      "Here’s what I can currently use when available:",
      ...BAXTER_IDENTITY.sources.map((item) => `• ${item}`),
      "",
      "Ask “what can you do?” for a role-aware overview of current tools and limits.",
    ].join("\n");
  }
  return [
    BAXTER_IDENTITY.summary,
    "",
    "I use approved Acton knowledge, completed PEM NEATs, connected systems like GoHighLevel when configured, and the Process Rulebook when loaded — and I cite sources when I use them.",
    "I’m not customer-facing and I’m not a decision-maker — verify important decisions with the responsible teammate.",
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
