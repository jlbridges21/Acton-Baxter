/**
 * Group registry-derived capability lines for the Slack Home tab.
 * Filtering matches {@link deriveClaimedCapabilitiesFromCatalog} so Home cannot
 * drift from identity / system-prompt claims.
 */

import {
  deriveClaimedCapabilitiesFromCatalog,
  type ClaimedCapabilities,
} from "@/lib/baxter-ai/governance/capabilities";
import type { BaxterCapability } from "@/lib/baxter/capability-registry";
import type { HomeCapabilityGroup } from "./app-home-view";

const CATEGORY_HEADING: Record<BaxterCapability["category"], string> = {
  assistant: "Ask Baxter",
  slack: "Slack",
  knowledge: "Knowledge",
  pem_neat: "PEM NEATs",
  property_research: "Property Research",
  crm: "GoHighLevel",
  process: "Projects & process",
  admin: "Admin",
};

const CATEGORY_ORDER: BaxterCapability["category"][] = [
  "assistant",
  "slack",
  "knowledge",
  "pem_neat",
  "property_research",
  "crm",
  "process",
  "admin",
];

/**
 * Employee-facing capability groups for App Home.
 * Admin-only catalog entries are already excluded by the claims helper.
 */
export function groupHomeCapabilities(
  catalog: BaxterCapability[],
  claims?: ClaimedCapabilities,
): HomeCapabilityGroup[] {
  const claimed = claims ?? deriveClaimedCapabilitiesFromCatalog(catalog);
  const claimedKeys = new Set(claimed.catalogKeys);
  const claimedLines = new Set(claimed.capabilities);

  const buckets = new Map<BaxterCapability["category"], string[]>();
  const usedLines = new Set<string>();

  for (const cap of catalog) {
    if (!claimedKeys.has(cap.key)) continue;
    if (!claimedLines.has(cap.shortDescription)) continue;
    const heading = cap.category;
    const list = buckets.get(heading) ?? [];
    if (!list.includes(cap.shortDescription)) list.push(cap.shortDescription);
    buckets.set(heading, list);
    usedLines.add(cap.shortDescription);
  }

  for (const line of claimed.capabilities) {
    if (usedLines.has(line)) continue;
    const list = buckets.get("process") ?? [];
    list.push(line);
    buckets.set("process", list);
  }

  const groups: HomeCapabilityGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const lines = buckets.get(category);
    if (!lines?.length) continue;
    if (category === "admin") continue;
    groups.push({ heading: CATEGORY_HEADING[category], lines });
  }
  return groups;
}
