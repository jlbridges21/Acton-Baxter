/**
 * Slack-oriented temporal windows. Reuses Knowledge temporal parsing and
 * extends it for conversational phrases (yesterday, last week, recently, …).
 */

import { parseTimeRangeFromQuestion, type TimeRangeFilter } from "@/lib/knowledge-index/temporal";
import type { SlackTimeRange } from "./types";

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function toSlackRange(from: Date, to: Date, label: string): SlackTimeRange {
  return {
    from,
    to,
    fromUnix: Math.floor(from.getTime() / 1000),
    toUnix: Math.floor(to.getTime() / 1000),
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    label,
  };
}

function fromKnowledgeRange(range: TimeRangeFilter): SlackTimeRange {
  const from = new Date(range.fromIso);
  const to = new Date(range.toIso);
  return toSlackRange(from, to, range.label);
}

function startOfUtcWeekMonday(d: Date): Date {
  const day = d.getUTCDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? 6 : day - 1;
  const monday = startOfUtcDay(d);
  monday.setUTCDate(monday.getUTCDate() - diff);
  return monday;
}

/**
 * Parse a Slack search time window from natural language.
 * Prefer specific conversational phrases, then fall back to shared temporal parser.
 */
export function parseSlackTimeRange(
  question: string,
  now: Date = new Date(),
): SlackTimeRange | null {
  const q = question.toLowerCase();

  if (/\btoday\b/.test(q)) {
    return toSlackRange(startOfUtcDay(now), endOfUtcDay(now), "today");
  }

  if (/\byesterday\b/.test(q)) {
    const y = new Date(now);
    y.setUTCDate(y.getUTCDate() - 1);
    return toSlackRange(startOfUtcDay(y), endOfUtcDay(y), "yesterday");
  }

  if (/\bthis morning\b/.test(q)) {
    const from = startOfUtcDay(now);
    const noon = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0),
    );
    const to = now < noon ? now : noon;
    return toSlackRange(from, to, "this morning");
  }

  if (/\bthis week\b/.test(q)) {
    const from = startOfUtcWeekMonday(now);
    return toSlackRange(from, endOfUtcDay(now), "this week");
  }

  if (/\blast week\b/.test(q)) {
    const thisMonday = startOfUtcWeekMonday(now);
    const lastMonday = new Date(thisMonday);
    lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setUTCDate(lastSunday.getUTCDate() - 1);
    return toSlackRange(lastMonday, endOfUtcDay(lastSunday), "last week");
  }

  if (/\blast\s+7\s+days\b|\bpast\s+7\s+days\b/.test(q)) {
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 7);
    return toSlackRange(from, now, "last 7 days");
  }

  if (/\brecently\b|\brecent\b|\blately\b/.test(q)) {
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 14);
    return toSlackRange(from, now, "recently (14 days)");
  }

  if (/\bsince monday\b/.test(q)) {
    const from = startOfUtcWeekMonday(now);
    return toSlackRange(from, endOfUtcDay(now), "since Monday");
  }

  // "since the PEM" without a resolved date → soft recent window; use
  // parseSlackTimeRangeAfterDate when PEM date is known from another source.
  if (/\bsince the (pem|partnership evaluation meeting)\b/.test(q)) {
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 45);
    return toSlackRange(from, endOfUtcDay(now), "since the PEM (approx 45 days)");
  }

  const beforeMatch = q.match(
    /\bbefore\s+(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/,
  );
  if (beforeMatch) {
    const day = Number(beforeMatch[1]);
    const monthNames = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    const month = monthNames.indexOf(beforeMatch[2]!);
    if (month >= 0) {
      const year = now.getUTCFullYear();
      const to = new Date(Date.UTC(year, month, day, 0, 0, 0) - 1);
      const from = new Date(to);
      from.setUTCDate(from.getUTCDate() - 90);
      return toSlackRange(from, to, `before ${beforeMatch[1]} ${beforeMatch[2]}`);
    }
  }

  const afterMatch = q.match(
    /\bafter\s+(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/,
  );
  if (afterMatch) {
    const day = Number(afterMatch[1]);
    const monthNames = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    const month = monthNames.indexOf(afterMatch[2]!);
    if (month >= 0) {
      const year = now.getUTCFullYear();
      const from = new Date(Date.UTC(year, month, day, 0, 0, 0));
      return toSlackRange(from, endOfUtcDay(now), `after ${afterMatch[1]} ${afterMatch[2]}`);
    }
  }

  const shared = parseTimeRangeFromQuestion(question, now, "timestamp");
  if (shared) return fromKnowledgeRange(shared);

  // Default bounded window for open-ended Slack recall (do not search all history).
  if (/\blast\b|\blatest\b|\bupdate\b|\bhappened\b|\bdiscussed\b|\bmentioned\b/.test(q)) {
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 30);
    return toSlackRange(from, now, "last 30 days (default)");
  }

  return null;
}

/** When a related source (e.g. PEM meeting date) is known, tighten "since …" windows. */
export function parseSlackTimeRangeAfterDate(
  after: Date,
  label: string,
  now: Date = new Date(),
): SlackTimeRange {
  return toSlackRange(startOfUtcDay(after), endOfUtcDay(now), label);
}

/** Format YYYY-MM-DD for Slack query modifiers. */
export function formatSlackDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
