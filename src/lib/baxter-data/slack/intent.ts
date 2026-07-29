import type { SlackSearchIntent, SlackSearchSort } from "./types";

const DECISION_LANGUAGE = [
  "decided",
  "agreed",
  "going with",
  "we'll do",
  "we will",
  "final",
  "approved",
  "let's",
  "lets",
  "moving forward",
  "changing",
  "change to",
  "ship",
  "locked in",
] as const;

export function getDecisionLanguageTerms(): string[] {
  return [...DECISION_LANGUAGE];
}

export function detectSlackSearchIntent(question: string): SlackSearchIntent {
  const q = question.toLowerCase().trim();

  if (/\blast message\b|\blast thing\b|\bmost recent message\b/.test(q)) {
    return "latest_message";
  }
  // "What did Jess say last in #project-management?" / "what did James say last in the baxter channel"
  if (
    /\bwhat did .+ say last\b|\bsay last in\b|\bsaid last in\b|\blast in (the )?#[\w-]+|\blast in (the )?[\w-]+ channel\b/.test(
      q,
    )
  ) {
    return "latest_message";
  }
  if (/\bwho (mentioned|said|talked about|discussed)\b|\bwho mentioned\b/.test(q)) {
    return "mention_search";
  }
  if (/\bwhen did we (decide|agree|approve|choose)\b|\bwhen (was|did).*(decid|agre)\b/.test(q)) {
    return "decision_search";
  }
  if (/\bwhat did .+ say\b|\bwhat has .+ said\b|\bwhat .+ said about\b/.test(q)) {
    return "person_statement";
  }
  if (/\bwhat (is|was) the latest\b|\blatest on\b|\blatest update\b/.test(q)) {
    return "latest_update";
  }
  // Current-status timing questions ("When will the RACI matrix be ready?")
  if (
    /\bwhen will\b|\bwhen is\b.*\bready\b|\bbe ready\b|\bready (by|for|on|friday|monday|tomorrow)\b/.test(
      q,
    )
  ) {
    return "latest_update";
  }
  if (/\bwhat happened\b|\bwhat (conversations|discussions) have there been\b/.test(q)) {
    return "time_window_summary";
  }
  if (/\bshow me (the )?(recent )?conversation\b|\brecent conversation about\b/.test(q)) {
    return "conversation_recall";
  }
  if (
    /\bin (the )?#?[\w-]+( channel)?\b|\bin #\w+/.test(q) &&
    /\b(said|message|discuss|talk)/.test(q)
  ) {
    return "channel_search";
  }
  if (/\bthread\b/.test(q)) {
    return "thread_context";
  }
  return "topic_search";
}

export function defaultSortForIntent(intent: SlackSearchIntent): SlackSearchSort {
  switch (intent) {
    case "latest_message":
    case "latest_update":
    case "time_window_summary":
      return "newest";
    case "decision_search":
    case "person_statement":
    case "mention_search":
    case "topic_search":
    case "channel_search":
    case "conversation_recall":
    case "thread_context":
      return "relevance";
    default:
      return "relevance";
  }
}

export function defaultLimitForIntent(intent: SlackSearchIntent): number {
  switch (intent) {
    case "latest_message":
      return 1;
    case "latest_update":
      return 8;
    case "person_statement":
    case "decision_search":
      return 12;
    case "mention_search":
      return 15;
    case "time_window_summary":
    case "conversation_recall":
      return 20;
    default:
      return 15;
  }
}

/** Extract quoted phrases from the question. */
export function extractPhrases(question: string): string[] {
  const phrases: string[] = [];
  const re = /"([^"]{2,80})"|'([^']{2,80})'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(question))) {
    const phrase = (match[1] ?? match[2] ?? "").trim();
    if (phrase) phrases.push(phrase);
  }
  return phrases;
}

const STOP = new Set([
  "a",
  "an",
  "the",
  "what",
  "when",
  "who",
  "where",
  "how",
  "did",
  "does",
  "do",
  "is",
  "are",
  "was",
  "were",
  "we",
  "our",
  "us",
  "me",
  "my",
  "i",
  "you",
  "your",
  "about",
  "on",
  "in",
  "of",
  "to",
  "for",
  "with",
  "from",
  "last",
  "week",
  "yesterday",
  "today",
  "this",
  "morning",
  "recently",
  "latest",
  "message",
  "messages",
  "said",
  "say",
  "mentioned",
  "mention",
  "talk",
  "talked",
  "discuss",
  "discussed",
  "conversation",
  "conversations",
  "channel",
  "update",
  "happened",
  "anyone",
  "someone",
  "there",
  "been",
  "have",
  "has",
  "will",
  "would",
  "should",
  "could",
  "please",
  "show",
  "tell",
  "me",
  "and",
  "or",
  "new",
]);

export function extractKeywords(question: string, extraDrop: string[] = []): string[] {
  const drop = new Set(extraDrop.map((s) => s.toLowerCase()));
  const cleaned = question
    .replace(/#[\w-]+/g, " ")
    .replace(/"[^"]*"|'[^']*'/g, " ")
    .replace(/[?!.,;:()]/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2 && !STOP.has(t) && !drop.has(t) && !/^\d+$/.test(t));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, 12);
}

export function extractChannelMentions(question: string): string[] {
  const names: string[] = [];
  const hash = question.matchAll(/#([\w-]+)/g);
  for (const m of hash) {
    if (m[1]) names.push(m[1]);
  }
  const named = question.match(/\bin (?:the )?([\w-]+(?:\s+[\w-]+){0,3}) channel\b/i);
  if (named?.[1]) names.push(named[1].replace(/\s+/g, "-").toLowerCase());
  const pm = question.match(/\b(?:the )?pm channel\b/i);
  if (pm) names.push("project-management");
  return [...new Set(names.map((n) => n.replace(/^#/, "").toLowerCase()))];
}

/**
 * Extract likely person name tokens for resolution.
 * Deterministic heuristics — not LLM.
 */
export function extractPersonQueries(question: string): string[] {
  const q = question.trim();
  const out: string[] = [];

  const whatDid = q.match(/\bwhat did ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?) say\b/i);
  if (whatDid?.[1]) out.push(whatDid[1]);

  const whatHas = q.match(/\bwhat has ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?) said\b/i);
  if (whatHas?.[1]) out.push(whatHas[1]);

  const after = q.match(/\bafter ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?) asked\b/i);
  if (after?.[1]) out.push(after[1]);

  const lastMsg = q.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:'s)? last message\b/i);
  if (lastMsg?.[1]) out.push(lastMsg[1]);

  const from = q.match(/\bfrom ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
  if (from?.[1]) out.push(from[1]);

  // Lowercase first-name patterns common in the prompt examples
  const lowerNames = q.match(
    /\b(?:what did|what has|from|after)\s+(jess|jessica|maxx|max|kevin|jackson|milan|jesse|james|gwen)\b/i,
  );
  if (lowerNames?.[1]) out.push(lowerNames[1]);

  const lastLower = q.match(
    /\b(jess|jessica|maxx|max|kevin|jackson|milan|jesse|james|gwen)(?:'s)? last message\b/i,
  );
  if (lastLower?.[1]) out.push(lastLower[1]);

  return [...new Set(out.map((n) => n.trim()).filter(Boolean))];
}
