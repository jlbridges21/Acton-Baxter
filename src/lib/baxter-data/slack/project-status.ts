/**
 * Project-status routing helpers — Acton job channels / project numbers.
 * Distinct from PEM prospect intelligence and generic Slack topic search.
 */

import { normalizeEntitySearchName } from "@/lib/baxter-ai/entity-name-normalize";

const PROJECT_NUMBER_RE = /\b([A-Za-z]\d{2}-\d{4,6})\b/gi;

const STRUCTURAL_STOP = new Set([
  "project",
  "projects",
  "job",
  "jobs",
  "channel",
  "channels",
  "thread",
  "threads",
  "here",
  "status",
  "update",
  "updates",
  "latest",
  "current",
  "provide",
  "give",
  "tell",
  "show",
  "anything",
  "newer",
  "new",
  "happening",
  "change",
  "changed",
  "week",
  "month",
]);

const PROJECT_NAME_STOP = new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "our",
  "my",
  "your",
  "acton",
  "sales",
  "design",
  "general",
  "baxter",
  "pem",
  "neat",
  "adu",
  "slack",
  "status",
  "update",
  "latest",
  "current",
  "what",
  "who",
  "when",
  "where",
  "why",
  "how",
  "which",
  "whom",
  "whose",
  "has",
  "have",
  "been",
  "said",
  "saying",
  "anything",
  "something",
  "everything",
]);

export type ProjectIdentifiers = {
  projectNumbers: string[];
  projectNames: string[];
  channelMentions: string[];
};

/** Extract Acton-style project numbers (e.g. L01-24027). */
export function extractProjectNumbers(question: string): string[] {
  const out: string[] = [];
  for (const m of question.matchAll(PROJECT_NUMBER_RE)) {
    if (m[1]) out.push(m[1].toUpperCase());
  }
  return [...new Set(out)];
}

/**
 * Extract homeowner / job slug candidates from phrasing like:
 * "the McAdams project", "update on McAdams", "McAdams job", "katie liniger project".
 */
export function extractProjectNameQueries(question: string): string[] {
  const out: string[] = [];
  const q = question.trim();

  for (const m of q.matchAll(
    /\b(?:the\s+)?([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,3})\s+(?:project|job|channel|opportunity|deal|account)\b/gi,
  )) {
    const raw = (m[1] ?? "").trim();
    const name = normalizeEntitySearchName(raw) || raw;
    if (name && !PROJECT_NAME_STOP.has(name.toLowerCase())) out.push(name);
  }

  for (const m of q.matchAll(
    /\b(?:on|about|for|with|regarding)\s+(?:the\s+)?([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,3})\b/gi,
  )) {
    const raw = (m[1] ?? "").trim();
    const name = normalizeEntitySearchName(raw) || raw;
    if (
      name &&
      !PROJECT_NAME_STOP.has(name.toLowerCase()) &&
      !STRUCTURAL_STOP.has(name.toLowerCase())
    ) {
      out.push(name);
    }
  }

  // Strip channel hashes already present — names come from slug after project number
  for (const m of q.matchAll(/#([A-Za-z]\d{2}-\d{4,6})-([A-Za-z][\w-]*)/gi)) {
    if (m[2]) out.push(m[2].replace(/-/g, " "));
  }

  return [
    ...new Set(
      out.map((n) => n.trim()).filter((n) => n.length >= 2 && !/^[CG][A-Z0-9_]+$/i.test(n)),
    ),
  ];
}

export function extractProjectIdentifiers(question: string): ProjectIdentifiers {
  const channelMentions: string[] = [];
  for (const m of question.matchAll(/#([\w-]+)/g)) {
    if (m[1] && !/^[CG][A-Z0-9]+$/i.test(m[1])) channelMentions.push(m[1].toLowerCase());
  }
  for (const m of question.matchAll(/<#([CG][A-Z0-9_]+)(?:\|([^>]*))?>/gi)) {
    if (m[2]) channelMentions.push(m[2].replace(/^#/, "").toLowerCase());
    else if (m[1]) channelMentions.push(m[1].toUpperCase());
  }
  return {
    projectNumbers: extractProjectNumbers(question),
    projectNames: extractProjectNameQueries(question),
    channelMentions: [...new Set(channelMentions)],
  };
}

/** Freshness / status language about a project or job. */
export function isProjectStatusQuestion(question: string): boolean {
  const q = question.trim();
  if (!q) return false;

  // Explicit factual asks that are NOT project status
  if (
    /\b(agreement amount|contract value|type\s*[12]\s*pain|address|phone|email|how much (was|did|is)|what was the (cost|margin|agreement))\b/i.test(
      q,
    )
  ) {
    return false;
  }

  const hasProjectRef =
    extractProjectNumbers(q).length > 0 ||
    /#[\w-]+/.test(q) ||
    /\b[A-Za-z][A-Za-z'-]{1,40}\s+(?:project|job)\b/i.test(q) ||
    /\b(?:update|status|happening|where are we|anything new|anything newer|what's going on|what is going on)\b.+\b(?:on|with|for|in)\b/i.test(
      q,
    );

  const statusLanguage =
    /\b(latest update|latest on|current status|status of|update on|update me|provide .{0,20}update|give .{0,20}update|what('?s| is) happening|where are we (at|on)|anything new|anything newer|what changed|catch me up|what('?s| is) going on)\b/i.test(
      q,
    ) ||
    (/\b(update|status)\b/i.test(q) &&
      (/\b(project|job|#|l\d{2}-)/i.test(q) || extractProjectNumbers(q).length > 0));

  return hasProjectRef && statusLanguage;
}

/**
 * "Give me / find / how do I find information about the X project" —
 * live project lookup (Slack channel first), not a capability FAQ.
 */
export function isProjectInformationQuestion(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (isProjectStatusQuestion(q)) return true;

  const hasProjectRef =
    extractProjectNumbers(q).length > 0 ||
    /#[\w-]+/.test(q) ||
    /\b(?:the\s+)?[A-Za-z][A-Za-z'-]{1,40}(?:\s+[A-Za-z][A-Za-z'-]{1,40}){0,3}\s+(?:project|job)\b/i.test(
      q,
    );

  if (!hasProjectRef) return false;

  return /\b(information|info|details|tell me about|give me .{0,20}(info|information|details)|find .{0,40}(info|information|about)|more (info|information) about|what (do we know|can you tell me) about)\b/i.test(
    q,
  );
}

/**
 * Score a Slack channel name against a project number or homeowner slug.
 * Higher is better. Threshold ~70 for confident match.
 */
export function scoreProjectChannelMatch(channelName: string, query: string): number {
  const name = channelName
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
  const q = query
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  if (!name || !q) return 0;
  if (name === q) return 100;
  // Project number prefix: l01-24027 → l01-24027-mcadams
  if (name.startsWith(`${q}-`) || name.startsWith(q)) return 92;
  // Slug suffix: mcadams → l01-24027-mcadams
  if (name.endsWith(`-${q}`) || name.includes(`-${q}-`)) return 85;
  if (name.includes(q) && q.length >= 4) return 70;
  return 0;
}

export function pickBestProjectChannelMatch<T extends { name: string; id: string }>(
  directory: T[],
  query: string,
): { match: T; score: number } | null {
  let best: { match: T; score: number } | null = null;
  for (const channel of directory) {
    const score = scoreProjectChannelMatch(channel.name, query);
    if (score < 70) continue;
    if (!best || score > best.score) best = { match: channel, score };
  }
  return best;
}

/** Keywords that must never hard-gate exact-channel project history. */
export function isStructuralProjectKeyword(token: string): boolean {
  return STRUCTURAL_STOP.has(token.toLowerCase());
}
