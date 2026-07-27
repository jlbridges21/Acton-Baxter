import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import { isActiveRulebookKnown } from "@/lib/rulebook/capabilities";

/**
 * Current Baxter capabilities — only claim what is actually connected.
 */
export const BAXTER_CURRENT_CAPABILITIES = [
  "Answer questions in the Baxter web app (acton-baxter.vercel.app)",
  "Answer questions in Acton ADU Slack (DMs and @Baxter mentions)",
  "Search approved Knowledge Base and Google Workspace–synced Docs/Sheets",
  "Use structured spreadsheet knowledge for exact facts and aggregates",
  "Cite approved Acton sources for company-specific answers",
  "Help with general explanations, drafting, and summarization",
  "Draft customer-facing copy only when requested, clearly marked for human review",
] as const;

export const BAXTER_CURRENT_LIMITATIONS = [
  "Not customer-facing as an autonomous actor",
  "Not a decision-maker; important calls stay with responsible teammates",
  "Does not invent official Acton policies, pricing, RACI, or project facts",
  "Does not take autonomous action in external systems",
  "Does not evaluate individuals or speculate about intent",
] as const;

let monitoringCapabilityCached: boolean = false;

/**
 * Note that proactive monitoring is enabled.
 * Called when admin enables monitoring. Uses sync cache pattern like rulebook.
 */
export function noteMonitoringCapability(enabled: boolean): void {
  monitoringCapabilityCached = enabled;
}

/**
 * Check if monitoring capability should be claimed (sync for prompt assembly).
 */
export function isMonitoringCapabilityKnown(): boolean {
  return monitoringCapabilityCached;
}

export function buildCapabilitiesBlock(): string {
  const capabilities: string[] = [...BAXTER_CURRENT_CAPABILITIES];
  const limitations: string[] = [...BAXTER_CURRENT_LIMITATIONS];

  const ghlConfigured = isGhlConfigured();
  if (ghlConfigured) {
    capabilities.push(
      "Read/search live GoHighLevel CRM data (contacts, opportunities, pipelines, calendars, conversations)",
    );
    limitations.push(
      "GoHighLevel CRM updates require an authorized user and explicit confirmation before any write",
    );
    limitations.unshift("No live Buildertrend or Domo access yet");
  } else {
    limitations.unshift("No live Buildertrend, GoHighLevel, or Domo access yet");
  }

  // Claim only when evidence path (or admin) has confirmed an active rulebook exists.
  // Avoid async DB inside system-prompt assembly (breaks OpenAI retry tests that stub fetch).
  if (isActiveRulebookKnown()) {
    capabilities.push(
      "Answer responsibility and required-data questions from Acton's active Process Rulebook",
    );
  }

  // Claim proactive monitoring when enabled
  if (isMonitoringCapabilityKnown()) {
    capabilities.push(
      "Proactive monitoring: detect unowned opportunities, stale deals, missing required data, and config health issues (GHL only)",
    );
  }

  return [
    "Current capabilities:",
    ...capabilities.map((c) => `- ${c}`),
    "Current limitations:",
    ...limitations.map((c) => `- ${c}`),
  ].join("\n");
}
