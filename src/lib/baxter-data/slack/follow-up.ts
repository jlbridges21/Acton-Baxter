/**
 * Follow-up topic continuity + reset heuristics for Slack conversation state.
 */

import type { SlackConversationContext } from "./conversation-state";
import { detectSlackSearchIntent, extractPersonQueries, extractChannelMentions } from "./intent";
import { parseSlackTimeRange } from "./temporal";

/**
 * True when the new question introduces a distinct Slack topic and should not
 * inherit prior people/channels/time from the previous Slack context.
 */
export function shouldResetSlackFollowUpContext(
  question: string,
  prior: SlackConversationContext | null,
): boolean {
  if (!prior) return false;
  const q = question.trim();

  // Explicit new person + new topic signals
  const people = extractPersonQueries(q);
  const channels = extractChannelMentions(q);
  const intent = detectSlackSearchIntent(q);

  const priorPeople = new Set(prior.people.map((p) => p.toLowerCase()));
  const newPerson = people.some((p) => !priorPeople.has(p.toLowerCase()));

  // New channel that differs from prior
  const priorChannels = new Set(prior.channels.map((c) => c.replace(/^#/, "").toLowerCase()));
  const newChannel = channels.some((c) => !priorChannels.has(c.replace(/^#/, "").toLowerCase()));

  // Short pronoun / response follow-ups keep context
  if (
    /\b(respond|reply|he|she|they|him|her)\b/i.test(q) &&
    q.split(/\s+/).length <= 8 &&
    !newChannel
  ) {
    return false;
  }
  if (/^what about\b/i.test(q) && !newChannel && people.length <= 1) {
    return false;
  }

  // "about X" where X is not part of prior topic → new topic
  const aboutMatch = q.match(/\babout\s+([A-Za-z][A-Za-z'-]{1,40})\b/);
  if (aboutMatch?.[1]) {
    const about = aboutMatch[1].toLowerCase();
    const priorTopic = (prior.topic ?? "").toLowerCase();
    const priorBlob = `${priorTopic} ${prior.people.join(" ").toLowerCase()}`;
    if (!priorBlob.includes(about) && about.length > 2) {
      return true;
    }
  }

  // Substantial standalone question with its own entities
  if ((newPerson || newChannel) && q.length > 25) {
    return true;
  }

  // Completely new latest/decision question with no pronoun follow-up language
  if (
    (intent === "decision_search" || intent === "latest_update" || intent === "person_statement") &&
    q.length > 40 &&
    !/\b(he|she|they|him|her|that|this|respond|reply|same|also)\b/i.test(q) &&
    (newPerson || !people.length)
  ) {
    if (
      newPerson &&
      prior.topic &&
      !q.toLowerCase().includes((prior.topic.split(/\s+/)[0] ?? "").toLowerCase())
    ) {
      return true;
    }
  }

  return false;
}

/**
 * For "What about this week?" after a prior Slack question — keep topic/people, replace time.
 */
export function expandRelativeTimeFollowUp(
  question: string,
  prior: SlackConversationContext | null,
  now: Date = new Date(),
): string {
  if (!prior?.topic && !prior?.people.length) return question;
  const q = question.trim();
  const timeOnly =
    /^(what about|and)?\s*(this|last)\s+(week|month|monday|tuesday|wednesday|thursday|friday)\??$/i.test(
      q,
    ) || /^(this|last)\s+(week|month)\??$/i.test(q);

  if (!timeOnly) return question;

  const range = parseSlackTimeRange(q, now);
  const parts = [
    prior.topic ? `What about ${prior.topic}` : "What about that",
    prior.people.length ? `(regarding ${prior.people.join(", ")})` : null,
    prior.channels.length ? `(channels: ${prior.channels.join(", ")})` : null,
    range ? `(${range.label})` : `(${q})`,
  ].filter(Boolean);
  return parts.join(" ");
}

/**
 * Expand follow-up with optional reset when topic changes.
 */
export function resolveSlackFollowUpQuestion(
  question: string,
  prior: SlackConversationContext | null,
  now?: Date,
): { question: string; reset: boolean; prior: SlackConversationContext | null } {
  if (!prior) return { question, reset: false, prior: null };

  if (shouldResetSlackFollowUpContext(question, prior)) {
    return { question, reset: true, prior: null };
  }

  const timeExpanded = expandRelativeTimeFollowUp(question, prior, now);
  if (timeExpanded !== question) {
    return { question: timeExpanded, reset: false, prior };
  }

  // Defer to expandQuestionWithSlackContext in conversation-state
  return { question, reset: false, prior };
}
