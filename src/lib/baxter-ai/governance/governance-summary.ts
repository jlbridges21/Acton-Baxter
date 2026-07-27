import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BAXTER_CANONICAL_SOURCES, listCanonicalSources } from "./canonical-sources";
import { BAXTER_GOVERNANCE_VERSION, BAXTER_RUNTIME_VERSION } from "./version";

export type GovernanceOpenItem = {
  kind: "placeholder" | "red_flag";
  text: string;
};

export type GovernanceAdminSummary = {
  runtimeVersion: string;
  governanceVersion: string;
  canonicalStandards: Array<{ title: string; path: string; version: string; role: string }>;
  openDecisions: GovernanceOpenItem[];
  unresolvedRisks: GovernanceOpenItem[];
  note: string;
};

function loadGovernanceMarkdown(): string {
  try {
    const path = join(process.cwd(), BAXTER_CANONICAL_SOURCES.governance!.path);
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Parse PLACEHOLDER / RED FLAG lines for admin visibility.
 * These must never be treated as live employee policy.
 */
export function parseGovernanceOpenItems(markdown?: string): {
  placeholders: GovernanceOpenItem[];
  redFlags: GovernanceOpenItem[];
} {
  const text = markdown ?? loadGovernanceMarkdown();
  const placeholders: GovernanceOpenItem[] = [];
  const redFlags: GovernanceOpenItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^PLACEHOLDER:/i.test(trimmed)) {
      placeholders.push({
        kind: "placeholder",
        text: trimmed.replace(/^PLACEHOLDER:\s*/i, "").slice(0, 280),
      });
    } else if (/^RED FLAG:/i.test(trimmed)) {
      redFlags.push({
        kind: "red_flag",
        text: trimmed.replace(/^RED FLAG:\s*/i, "").slice(0, 280),
      });
    }
  }
  return { placeholders, redFlags };
}

export function getGovernanceAdminSummary(): GovernanceAdminSummary {
  const { placeholders, redFlags } = parseGovernanceOpenItems();
  return {
    runtimeVersion: BAXTER_RUNTIME_VERSION,
    governanceVersion: BAXTER_GOVERNANCE_VERSION,
    canonicalStandards: listCanonicalSources().map((s) => ({
      title: s.title,
      path: s.path,
      version: s.version,
      role: s.runtimeRole,
    })),
    openDecisions: placeholders,
    unresolvedRisks: redFlags,
    note: "PLACEHOLDER and RED FLAG items are planning notes — not live Baxter policy or employee Knowledge facts.",
  };
}

/** Titles that must not be treated as authoritative employee policy when unresolved. */
export function isNonAuthoritativeGovernanceContent(text: string): boolean {
  return /\bPLACEHOLDER\b|\bRED FLAG\b/i.test(text);
}
