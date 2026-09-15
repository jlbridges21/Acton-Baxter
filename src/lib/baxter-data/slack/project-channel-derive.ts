/**
 * Derive a project Slack channel slug from Master Project Log identity
 * (project number + short name), using the same sanitization as Project Setup.
 *
 * Complements project_setup_runs / dossier resolution — works for all projects
 * in the registry, not only Baxter-created ones.
 */

import "server-only";

import { normalizeEntitySearchName } from "@/lib/baxter-ai/entity-name-normalize";
import { sanitizeSlackChannelSegment } from "@/lib/project-setup/names";
import {
  expectedSlackChannelSlug,
  lookupProjectRow,
  loadMasterProjectLog,
  type LoadProjectRegistryDeps,
  type ProjectLogRow,
} from "@/lib/baxter-data/project-registry";
import {
  extractProjectNameQueries,
  extractProjectNumbers,
} from "@/lib/baxter-data/slack/project-status";

export type DerivedProjectSlackChannel = {
  slug: string;
  projectNumber: string;
  shortName: string;
  customerName: string;
  query: string;
  via: "master_project_log";
};

/**
 * Pull project identity tokens from channel-ask phrasing:
 * "liniger slack channel", "the Liniger project channel", "L01-26019 channel".
 */
export function extractProjectIdentityQueriesForChannel(question: string): string[] {
  const out: string[] = [];
  const q = question.trim();
  if (!q) return out;

  for (const n of extractProjectNumbers(q)) out.push(n);
  for (const n of extractProjectNameQueries(q)) out.push(n);

  // "[Name] slack channel" / "the [Name] channel" when extractProjectNameQueries
  // already ran — also catch "slack channel" with an intervening name.
  for (const m of q.matchAll(
    /\b(?:the\s+)?([A-Za-z][A-Za-z0-9'-]*(?:\s+[A-Za-z][A-Za-z0-9'-]*){0,3})\s+(?:slack\s+)?channel\b/gi,
  )) {
    const raw = (m[1] ?? "").trim();
    const cleaned = raw
      .replace(/\bslack\b/gi, " ")
      .replace(/(^|\s)project(\s|$)/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    // Drop leading filler glued by the regex ("in the liniger", "latest in the liniger")
    const parts = cleaned.split(/\s+/).filter(Boolean);
    const leadJunk = new Set([
      "in",
      "on",
      "at",
      "to",
      "from",
      "latest",
      "update",
      "status",
      "whats",
    ]);
    while (parts.length && leadJunk.has(parts[0]!.toLowerCase())) parts.shift();
    while (parts.length && ["the", "a", "an"].includes(parts[0]!.toLowerCase())) parts.shift();
    const name = normalizeEntitySearchName(parts.join(" ")) || parts.join(" ");
    if (name && name.length >= 2) out.push(name);
  }

  // Dedupe case-insensitively
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of out) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

/**
 * Build the canonical channel slug for a Master Project Log row.
 * Reuses expectedSlackChannelSlug + sanitizeSlackChannelSegment.
 */
export function projectRowToSlackChannelSlug(row: ProjectLogRow): string | null {
  const fromHelper = expectedSlackChannelSlug(row);
  if (fromHelper) {
    return sanitizeSlackChannelSegment(fromHelper);
  }
  const num = row.projectNumber.trim();
  const short = row.shortName.trim();
  if (!num || !short) return null;
  return sanitizeSlackChannelSegment(`${num}-${short}`);
}

/**
 * Resolve a project from the Master Project Log and derive its Slack channel slug.
 */
export async function deriveProjectSlackChannelFromRegistry(
  question: string,
  deps?: LoadProjectRegistryDeps & { rows?: ProjectLogRow[] },
): Promise<DerivedProjectSlackChannel | null> {
  const queries = extractProjectIdentityQueriesForChannel(question);
  if (queries.length === 0) return null;

  const rows = deps?.rows ?? (await loadMasterProjectLog(deps ?? {})).rows;
  if (rows.length === 0) return null;

  for (const query of queries) {
    const hit = lookupProjectRow(rows, query);
    if (hit.kind !== "unique") continue;
    const slug = projectRowToSlackChannelSlug(hit.row);
    if (!slug) continue;
    return {
      slug,
      projectNumber: hit.row.projectNumber,
      shortName: hit.row.shortName,
      customerName: hit.row.customerName,
      query,
      via: "master_project_log",
    };
  }
  return null;
}

/** True when the question is asking about a project's Slack channel activity. */
export function isNamedProjectChannelAsk(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  // Explicit #slug / mrkdwn mention — do not re-derive from Master Project Log.
  if (/#[\w-]{2,}/.test(q) || /<#[CG]/i.test(q)) return false;
  if (!/\b(?:slack\s+)?(?:project\s+)?channel\b/i.test(q)) return false;
  const identities = extractProjectIdentityQueriesForChannel(q).filter(
    (name) => !KNOWN_NON_PROJECT_CHANNELS.has(name.toLowerCase().replace(/\s+/g, "-")),
  );
  return identities.length > 0;
}

const KNOWN_NON_PROJECT_CHANNELS = new Set([
  "baxter",
  "sales",
  "design",
  "general",
  "project-management",
  "project management",
  "pm",
  "random",
]);
