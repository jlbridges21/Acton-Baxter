import type { SlackSearchIntent, SlackSearchSort } from "./types";
import {
  isProjectInformationQuestion,
  isProjectStatusQuestion,
  isStructuralProjectKeyword,
} from "./project-status";

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
  if (
    /\bwhat did [a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)? say\b/i.test(q) ||
    /\bwhat has [a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)? said\b/i.test(q) ||
    /\bwhat [a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)? said about\b/i.test(q)
  ) {
    // Require a person-like token — not "what has been said"
    if (!/\bwhat has been said\b|\bwhat'?s been said\b|\bwhat has been discussed\b/i.test(q)) {
      return "person_statement";
    }
  }

  // Project-status / project-information before generic latest_update so "#channel project" uses history.
  if (isProjectStatusQuestion(question) || isProjectInformationQuestion(question)) {
    return "project_status";
  }

  if (
    /\bwhat (is|was) the latest\b|\bwhat'?s the latest\b|\blatest on\b|\blatest update\b/.test(q)
  ) {
    return "latest_update";
  }
  // "latest in the liniger slack channel" — keep before broader channel_search.
  if (/\blatest\b.+\b(?:slack\s+)?channel\b/.test(q)) {
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
  // Channel summary / "what's been said in #X" / "tell me anything about the X channel"
  if (
    /\b(summarize|summary of|what('?s| is) going on in|what has been said|what'?s been said|tell me anything|catch me up|what happened in)\b/.test(
      q,
    ) &&
    (/\b#[\w-]+\b/.test(q) || /\bchannel\b/.test(q) || /\bin (the )?[\w-]+/.test(q))
  ) {
    return "channel_search";
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
    case "project_status":
    case "time_window_summary":
    case "channel_search":
      return "newest";
    case "decision_search":
    case "person_statement":
    case "mention_search":
    case "topic_search":
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
    case "project_status":
      return 20;
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
  "anything",
  "going",
  "on",
  "summarize",
  "summary",
  "project",
  "projects",
  "job",
  "jobs",
  "status",
  "provide",
  "give",
]);

export function extractKeywords(question: string, extraDrop: string[] = []): string[] {
  const drop = new Set(extraDrop.map((s) => s.toLowerCase()));
  const cleaned = question
    .replace(/#[\w-]+/g, " ")
    .replace(/<[#@][^>]+>/g, " ")
    .replace(/\b[A-Za-z]\d{2}-\d{4,6}\b/gi, " ")
    .replace(/"[^"]*"|'[^']*'/g, " ")
    .replace(/[?!.,;:()]/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter(
      (t) =>
        t.length >= 2 &&
        !STOP.has(t) &&
        !drop.has(t) &&
        !isStructuralProjectKeyword(t) &&
        !/^\d+$/.test(t),
    );
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

  // Slack mrkdwn channel mentions: <#C123> or <#C123|name>
  for (const m of question.matchAll(/<#([CG][A-Z0-9_]+)(?:\|([^>]*))?>/gi)) {
    if (m[1]) names.push(m[1].toUpperCase());
  }

  // Bare Slack channel IDs when clearly referenced
  for (const m of question.matchAll(/\b(?:channel\s+|in\s+|from\s+|#)?([CG][A-Z0-9_]{8,})\b/gi)) {
    if (m[1] && /^[CG][A-Z0-9_]+$/i.test(m[1])) names.push(m[1].toUpperCase());
  }

  const hash = question.matchAll(/#([\w-]+)/g);
  for (const m of hash) {
    if (m[1]) {
      // Skip if this was already captured as a Slack ID (C… / G…)
      if (/^[CG][A-Z0-9]+$/i.test(m[1])) names.push(m[1].toUpperCase());
      else names.push(m[1]);
    }
  }

  // Relational / possessive project-channel phrasing is NOT a literal channel name
  // ("his project channel", "Kornilov's project channel" → do not emit "s-project").
  const relationalProjectChannel =
    /\b(?:his|her|their|its|my|your|our)\s+(?:slack\s+)?project\s+channel\b/i.test(question) ||
    /\b[A-Za-z][A-Za-z'-]*'s\s+(?:slack\s+)?project\s+channel\b/i.test(question) ||
    /\bthe\s+(?:slack\s+)?project\s+channel\b/i.test(question);

  // "in the baxter channel" / "about the project-management channel" / "from the sales channel"
  if (!relationalProjectChannel) {
    const namedPatterns = [
      /\b(?:in|about|from|regarding|for)\s+(?:the\s+)?([\w-]+(?:\s+[\w-]+){0,3})\s+channel\b/gi,
      /\b(?:the\s+)?([\w-]+(?:\s+[\w-]+){0,2})\s+channel\b/gi,
    ];
    for (const re of namedPatterns) {
      for (const m of question.matchAll(re)) {
        if (m[1]) {
          const raw = m[1].trim();
          // Ignore mrkdwn leftovers
          if (raw.includes("<") || raw.includes(">")) continue;
          // Possessive remnant: "Kornilov's project channel" → capture "s project"
          if (/^[a-z]\s+/i.test(raw)) continue;
          if (/\b(his|her|their|its|my|your|our)\b/i.test(raw)) continue;
          if (/^project$/i.test(raw)) continue;
          // "liniger slack channel" / "liniger project channel" → "liniger".
          // Do not strip hyphenated names like "project-management".
          const withoutNoise = raw
            .replace(/\bslack\b/gi, " ")
            .replace(/(^|\s)project(\s|$)/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (!withoutNoise || /^project$/i.test(withoutNoise)) continue;
          names.push(withoutNoise.replace(/\s+/g, "-").toLowerCase());
        }
      }
    }
  }

  const pm = question.match(/\b(?:the )?pm channel\b/i);
  if (pm) names.push("project-management");

  // "in #foo" already covered by hash; also "in baxter" without "channel" when clear
  const inBare = question.match(
    /\bin\s+(?:the\s+)?(baxter|sales|design|general|project-management|project management)\b/i,
  );
  if (inBare?.[1]) names.push(inBare[1].replace(/\s+/g, "-").toLowerCase());

  return [
    ...new Set(
      names
        .map((n) => {
          const trimmed = n.trim();
          if (/^[CG][A-Z0-9_]+$/i.test(trimmed)) return trimmed.toUpperCase();
          return trimmed
            .replace(/^#/, "")
            .toLowerCase()
            .replace(/\bchannels?\b/g, "")
            .replace(/\bslack\b/g, "")
            .replace(/^(the|a|an)-?/, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/-slack$/g, "")
            .replace(/^-|-$/g, "");
        })
        .filter((n) => n.length >= 2)
        .filter((n) => !isRelationalOrMangledChannelSlug(n)),
    ),
  ];
}

/** Possessive / relational / apostrophe-mangled channel slugs that must never literal-match. */
export function isRelationalOrMangledChannelSlug(slug: string): boolean {
  const n = slug.replace(/^#/, "").toLowerCase();
  if (
    n === "project" ||
    n === "slack-project" ||
    n === "the-project" ||
    n === "s-project" ||
    n === "s" ||
    n === "his" ||
    n === "her" ||
    n === "their" ||
    n === "its" ||
    n === "my" ||
    n === "your" ||
    n === "our"
  ) {
    return true;
  }
  if (/^(his|her|their|its|my|your|our)-/.test(n)) return true;
  // Single-letter possessive remnant: "s-project", "s-foo"
  if (/^[a-z]-/.test(n)) return true;
  // "liniger-slack" mangled from "liniger slack channel" (not a real channel pattern).
  if (/-slack$/.test(n) && !/^[a-z]\d{2}-\d{4,6}-/.test(n)) return true;
  return false;
}

/** True when the ask points at an entity's linked project channel without an explicit #name. */
export function isRelationalProjectChannelAsk(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (/#[\w-]{2,}/.test(q) || /<#[CG]/i.test(q)) return false;
  return (
    /\b(?:his|her|their|its|my|your|our)\s+(?:slack\s+)?project\s+channel\b/i.test(q) ||
    /\b[A-Za-z][A-Za-z'-]*'s\s+(?:slack\s+)?project\s+channel\b/i.test(q) ||
    /\bthe\s+(?:slack\s+)?project\s+channel\b/i.test(q) ||
    /\b(?:latest|update|activity|happening).{0,40}\b(?:his|her|their)\s+(?:slack\s+)?(?:project\s+)?channel\b/i.test(
      q,
    )
  );
}

/**
 * Extract likely person name tokens for resolution.
 * Deterministic heuristics — not LLM.
 */
export function extractPersonQueries(question: string): string[] {
  const q = question.trim();
  const out: string[] = [];

  // Slack mrkdwn user mentions: <@U123> or <@U123|name>
  for (const m of q.matchAll(/<@([UW][A-Z0-9_]+)(?:\|([^>]*))?>/gi)) {
    if (m[1]) out.push(m[1].toUpperCase());
  }

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
    /\b(?:what did|what has|from|after|about)\s+(jess|jessica|maxx|max|kevin|jackson|milan|jesse|james|gwen)\b/i,
  );
  if (lowerNames?.[1]) out.push(lowerNames[1]);

  const lastLower = q.match(
    /\b(jess|jessica|maxx|max|kevin|jackson|milan|jesse|james|gwen)(?:'s)? last message\b/i,
  );
  if (lastLower?.[1]) out.push(lastLower[1]);

  // "what has James said in #baxter"
  const hasSaid = q.match(/\bwhat has ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?) said\b/i);
  if (hasSaid?.[1]) out.push(hasSaid[1]);

  return [...new Set(out.map((n) => n.trim()).filter(Boolean))];
}
