/**
 * Whether existing non-Slack evidence already answers the employee's question.
 * Presence of Knowledge is not the same as answering a dynamic WHEN/status ask.
 */

import { isProjectStatusQuestion, isProjectInformationQuestion } from "./project-status";

export function nonSlackEvidenceSatisfiesQuestion(
  question: string,
  contextExcerpts: string[],
): boolean {
  const q = question.toLowerCase();
  const blob = contextExcerpts.join("\n").toLowerCase();
  if (!blob.trim()) return false;

  // Explicit Slack conversational questions are never satisfied by Knowledge alone.
  if (
    /\b(what did .+ say|who (said|mentioned)|last message|say last|in #|slack|did .+ respond|what happened|when did we decide|who mentioned)\b/i.test(
      q,
    )
  ) {
    return false;
  }

  // Project-status / latest project update — static Knowledge/GHL/sales rows are insufficient.
  if (isProjectStatusQuestion(question)) {
    return false;
  }

  // Timeline / readiness / status asks need temporal or commitment language in evidence.
  if (
    /\b(when will|when is|be ready|ready by|ready for|status of|latest on|current status|has .+ been|are we still)\b/i.test(
      q,
    )
  ) {
    const hasTimeline =
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|yesterday|this week|next week|by \d|ready (by|for|on)|deadline|due|scheduled|ship(?:ping)? on)\b/i.test(
        blob,
      ) || /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(blob);
    return hasTimeline;
  }

  // Metric / count / KPI asks are not satisfied by definition-only evidence.
  if (
    /\b(how many|how much|number of|kpi|conversion rate|total sold|we sold)\b/i.test(q) &&
    !/\b(what is a? |define |definition of )\b/i.test(q)
  ) {
    const hasNumericOrMetric =
      /\b\d[\d,]*(?:\.\d+)?%?\b/.test(blob) ||
      /\b(kpi|count|total|sum|average|sold|conducted|completed)\b/i.test(blob);
    const looksLikeDefinitionOnly =
      /\b(is a |refers to |means |stands for |definition)\b/i.test(blob) && !hasNumericOrMetric;
    if (looksLikeDefinitionOnly || !hasNumericOrMetric) return false;
  }

  return true;
}

export function shouldForceSlackDespiteOtherEvidence(question: string): boolean {
  const q = question.toLowerCase();
  if (
    /\b(what did .+ say|who (said|mentioned)|last message|say last|in #|did .+ respond|when did we decide|who mentioned|what happened)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  if (/\b(when will|when is|be ready|ready by|latest on|status of|current status)\b/i.test(q)) {
    return true;
  }
  if (isProjectStatusQuestion(question) || isProjectInformationQuestion(question)) {
    return true;
  }
  return false;
}
