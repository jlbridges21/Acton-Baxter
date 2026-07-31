import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import { isActiveRulebookKnown } from "@/lib/rulebook/capabilities";
import {
  buildBaxterCapabilityCatalog,
  getCapabilityRuntimeHealth,
} from "@/lib/baxter/capability-registry";

/**
 * Current Baxter capabilities — only claim what is actually connected.
 * Prefer buildCapabilitiesBlock() / the capability registry for live answers.
 */
export const BAXTER_CURRENT_CAPABILITIES = [
  "Answer questions in the Baxter web app (acton-baxter.vercel.app)",
  "Answer questions in Acton ADU Slack (DMs and @Baxter mentions)",
  "Search live Slack conversations the requester is authorized to access (when Slack Search is enabled)",
  "Search approved Knowledge Base and Google Workspace–synced Docs/Sheets",
  "Use structured spreadsheet knowledge for exact facts and aggregates",
  "Cite approved Acton sources for company-specific answers",
  "Generate and review PEM NEATs; answer questions about completed PEMs",
  "Help with Property Research navigation and prior reports",
  "Prepare new-project setup runs (dry-run) from GoHighLevel customer records for human confirmation",
  "Help with general explanations, drafting, and summarization",
  "Draft customer-facing copy only when requested, clearly marked for human review",
] as const;

export const BAXTER_CURRENT_LIMITATIONS = [
  "Not customer-facing as an autonomous actor",
  "Not a decision-maker; important calls stay with responsible teammates",
  "Does not invent official Acton policies, pricing, RACI, or project facts",
  "Does not take autonomous action in external systems",
  "Does not evaluate individuals or speculate about intent",
  "No direct BuilderTrend API — PEM BuilderTrend fields are copy/paste handoff only",
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
  const health = getCapabilityRuntimeHealth({
    monitoringKnown: monitoringCapabilityCached,
  });
  const catalog = buildBaxterCapabilityCatalog(health);
  const capabilities: string[] = [];
  const limitations: string[] = [...BAXTER_CURRENT_LIMITATIONS];

  for (const cap of catalog) {
    if (cap.key === "process_monitoring" && !cap.enabled) continue;
    if (cap.audience.length === 1 && cap.audience[0] === "admin") continue;
    if (cap.key === "gohighlevel" && !cap.enabled) {
      limitations.unshift("GoHighLevel is not currently connected for live CRM lookups");
      continue;
    }
    if (!cap.enabled && cap.status === "disabled") continue;
    capabilities.push(cap.shortDescription);
    for (const limit of cap.limitations.slice(0, 1)) {
      if (limit && !limitations.includes(limit)) limitations.push(limit);
    }
  }

  if (!isGhlConfigured()) {
    // already handled via catalog disconnect note
  }

  if (isActiveRulebookKnown() && !capabilities.some((c) => /rulebook/i.test(c))) {
    capabilities.push(
      "Answer responsibility and required-data questions from Acton's active Process Rulebook",
    );
  }

  return [
    "Current capabilities:",
    ...capabilities.map((c) => `- ${c}`),
    "Current limitations:",
    ...limitations.map((c) => `- ${c}`),
  ].join("\n");
}
