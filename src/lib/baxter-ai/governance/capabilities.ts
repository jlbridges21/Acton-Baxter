import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import { isActiveRulebookKnown } from "@/lib/rulebook/capabilities";
import {
  buildBaxterCapabilityCatalog,
  getCapabilityRuntimeHealth,
  type BaxterCapability,
} from "@/lib/baxter/capability-registry";

/**
 * Baseline hard limits — always claimed, independent of connector health.
 * Feature/capability lines come ONLY from the live capability registry via
 * {@link getClaimedCapabilitiesAndLimitations}.
 */
export const BAXTER_BASELINE_LIMITATIONS = [
  "Not customer-facing as an autonomous actor",
  "Not a decision-maker; important calls stay with responsible teammates",
  "Does not invent official Acton policies, pricing, RACI, or project facts",
  "Does not take autonomous action in external systems",
  "Does not evaluate individuals or speculate about intent",
  "No direct BuilderTrend API — PEM BuilderTrend fields are copy/paste handoff only",
] as const;

/** @deprecated Alias of {@link BAXTER_BASELINE_LIMITATIONS}. Prefer getClaimedCapabilitiesAndLimitations(). */
export const BAXTER_CURRENT_LIMITATIONS = BAXTER_BASELINE_LIMITATIONS;

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

/** Test helper */
export function resetMonitoringCapabilityCacheForTests(): void {
  monitoringCapabilityCached = false;
}

export type ClaimedCapabilities = {
  capabilities: string[];
  limitations: string[];
  /** Enabled catalog entries that contributed (non-admin-only). */
  catalogKeys: string[];
};

/**
 * Single source of truth for capability / limitation claim lines.
 * Used by the system-prompt block, identity context, and identity fast-path.
 */
export function getClaimedCapabilitiesAndLimitations(
  healthOverrides?: Partial<ReturnType<typeof getCapabilityRuntimeHealth>>,
): ClaimedCapabilities {
  const health = getCapabilityRuntimeHealth({
    monitoringKnown: monitoringCapabilityCached,
    ...healthOverrides,
  });
  const catalog = buildBaxterCapabilityCatalog(health);
  return deriveClaimedCapabilitiesFromCatalog(catalog);
}

/**
 * Pure derivation from a catalog (testable without env/connectors).
 * Mirrors the filtering previously inlined in buildCapabilitiesBlock().
 */
export function deriveClaimedCapabilitiesFromCatalog(
  catalog: BaxterCapability[],
): ClaimedCapabilities {
  const capabilities: string[] = [];
  const limitations: string[] = [...BAXTER_BASELINE_LIMITATIONS];
  const catalogKeys: string[] = [];

  for (const cap of catalog) {
    if (cap.key === "process_monitoring" && !cap.enabled) continue;
    if (cap.audience.length === 1 && cap.audience[0] === "admin") continue;
    if (cap.key === "gohighlevel" && !cap.enabled) {
      limitations.unshift("GoHighLevel is not currently connected for live CRM lookups");
      continue;
    }
    if (!cap.enabled && cap.status === "disabled") continue;
    capabilities.push(cap.shortDescription);
    catalogKeys.push(cap.key);
    for (const limit of cap.limitations.slice(0, 1)) {
      if (limit && !limitations.includes(limit)) limitations.push(limit);
    }
  }

  if (isActiveRulebookKnown() && !capabilities.some((c) => /rulebook/i.test(c))) {
    capabilities.push(
      "Answer responsibility and required-data questions from Acton's active Process Rulebook",
    );
    if (!catalogKeys.includes("process_rulebook")) catalogKeys.push("process_rulebook");
  }

  // Touch config helper so tree-shaking keeps the import (GHL disconnect already in catalog).
  void isGhlConfigured;

  return { capabilities, limitations, catalogKeys };
}

export function buildCapabilitiesBlock(): string {
  const { capabilities, limitations } = getClaimedCapabilitiesAndLimitations();
  return [
    "Current capabilities:",
    ...capabilities.map((c) => `- ${c}`),
    "Current limitations:",
    ...limitations.map((c) => `- ${c}`),
  ].join("\n");
}
