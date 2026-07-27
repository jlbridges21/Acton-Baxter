import { isGhlConfigured } from "@/lib/connectors/ghl/config";

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

export function buildCapabilitiesBlock(): string {
  const capabilities: string[] = [...BAXTER_CURRENT_CAPABILITIES];
  const limitations: string[] = [...BAXTER_CURRENT_LIMITATIONS];

  const ghlConfigured = isGhlConfigured();
  if (ghlConfigured) {
    capabilities.push(
      "Read/search GoHighLevel CRM data (contacts, opportunities, pipelines, calendars, conversations, users)",
    );
    limitations.push(
      "Cannot update GoHighLevel contacts or opportunities (read-only until Prompt 2 write tools are enabled)",
    );
    limitations.unshift("No live Buildertrend or Domo access yet");
  } else {
    limitations.unshift("No live Buildertrend, GoHighLevel, or Domo access yet");
  }

  return [
    "Current capabilities:",
    ...capabilities.map((c) => `- ${c}`),
    "Current limitations:",
    ...limitations.map((c) => `- ${c}`),
  ].join("\n");
}
