/**
 * Decision / suggestion / implementation classification for Slack evidence.
 * Request-lifecycle only — not persisted as organizational memory.
 */

import type { SlackMessageEvidence } from "./types";

export type SlackDecisionRole =
  | "suggestion"
  | "discussion"
  | "agreement"
  | "decision"
  | "implementation"
  | "reversal"
  | "unclear";

export type SlackDecisionCandidate = {
  topic: string;
  proposalMessage: SlackMessageEvidence | null;
  agreementMessage: SlackMessageEvidence | null;
  decisionMessage: SlackMessageEvidence | null;
  implementationMessage: SlackMessageEvidence | null;
  reversedBy: SlackMessageEvidence | null;
  currentStateMessage: SlackMessageEvidence | null;
};

const REVERSAL =
  /\b(actually|never\s+mind|nevermind|keep it|revert|undo|changed (my|our) mind|instead|scratch that|on second thought)\b/i;
const COMMITMENT =
  /\b(i'?ll |i will |i can |i'?m going to |i am going to |i'?ll have |i'?ll send |i'?ll update )\b/i;
const OWNERSHIP_WEAK = /\b(someone should|we should get someone|anybody want to)\b/i;
const DECISION_MARKERS =
  /\b(agreed|let'?s |we'?ll |we will|decided|approved|final|moving forward|confirmed|locked in|remove the wait|going with)\b/i;
const SUGGESTION_MARKERS =
  /\b(maybe|might|could|should we|what if|consider|thinking about|suggest)\b/i;
const IMPLEMENTATION_MARKERS =
  /\b(updated the calendar|i updated it|changed to|moved to|set to|i changed it)\b/i;

export function classifyDecisionRole(text: string): SlackDecisionRole {
  if (REVERSAL.test(text)) return "reversal";
  if (IMPLEMENTATION_MARKERS.test(text)) return "implementation";
  // Soft proposals win over overlapping decision-ish keywords ("Maybe we should remove…")
  if (SUGGESTION_MARKERS.test(text)) return "suggestion";
  if (DECISION_MARKERS.test(text)) {
    // Affirmation alone → agreement; imperative finalize → decision
    if (/\b(remove the|let'?s |we will|decided|approved|confirmed|going with)\b/i.test(text)) {
      return "decision";
    }
    if (/\b(agreed|agree|yes\.|works for me)\b/i.test(text)) return "agreement";
    return "decision";
  }
  if (COMMITMENT.test(text) && !OWNERSHIP_WEAK.test(text)) return "agreement";
  if (/\b(discuss|thinking|curious|wonder)\b/i.test(text)) return "discussion";
  return "unclear";
}

export function isCommitmentStatement(text: string): boolean {
  return COMMITMENT.test(text) && !OWNERSHIP_WEAK.test(text);
}

/**
 * Build a decision candidate chain from chronologically ordered evidence.
 */
export function buildDecisionCandidate(
  topic: string,
  messages: SlackMessageEvidence[],
): SlackDecisionCandidate {
  const ordered = [...messages].sort((a, b) =>
    String(a.messageTs).localeCompare(String(b.messageTs)),
  );

  let proposal: SlackMessageEvidence | null = null;
  let agreement: SlackMessageEvidence | null = null;
  let decision: SlackMessageEvidence | null = null;
  let implementation: SlackMessageEvidence | null = null;
  let reversedBy: SlackMessageEvidence | null = null;

  for (const msg of ordered) {
    const role = classifyDecisionRole(msg.text);
    if (role === "suggestion" && !proposal) proposal = msg;
    if (role === "agreement") agreement = msg;
    if (role === "decision") {
      decision = msg;
      // A later decision after a reversal starts a new chain
      if (reversedBy) {
        reversedBy = null;
      }
    }
    if (role === "implementation") implementation = msg;
    if (role === "reversal") {
      reversedBy = msg;
      // Stale decision is no longer current
      decision = null;
    }
  }

  const currentStateMessage = reversedBy ?? implementation ?? decision ?? agreement ?? proposal;

  return {
    topic,
    proposalMessage: proposal,
    agreementMessage: agreement,
    decisionMessage: decision,
    implementationMessage: implementation,
    reversedBy,
    currentStateMessage,
  };
}

/** Prefer decision/implementation evidence over suggestions for decision_search. */
export function rankDecisionEvidence(messages: SlackMessageEvidence[]): SlackMessageEvidence[] {
  const scored = messages.map((m) => {
    const role = classifyDecisionRole(m.text);
    let boost = 0;
    if (role === "decision") boost = 50;
    else if (role === "implementation") boost = 45;
    else if (role === "agreement") boost = 35;
    else if (role === "reversal") boost = 40;
    else if (role === "suggestion") boost = -20;
    return { m, boost, role };
  });
  scored.sort((a, b) => b.boost - a.boost);
  return scored.map((s) => s.m);
}

export function decisionEvidenceNotes(candidate: SlackDecisionCandidate): string[] {
  const notes: string[] = [];
  if (candidate.decisionMessage) {
    notes.push(
      `Decision evidence: ${candidate.decisionMessage.authorName ?? "employee"} — "${candidate.decisionMessage.text.slice(0, 120)}"`,
    );
  }
  if (candidate.proposalMessage && candidate.proposalMessage !== candidate.decisionMessage) {
    notes.push(
      `Earlier suggestion (not the decision): ${candidate.proposalMessage.authorName ?? "employee"}`,
    );
  }
  if (candidate.reversedBy) {
    notes.push(
      `Later reversal: ${candidate.reversedBy.authorName ?? "employee"} — "${candidate.reversedBy.text.slice(0, 120)}"`,
    );
  }
  if (candidate.implementationMessage) {
    notes.push(
      `Implementation confirmation: ${candidate.implementationMessage.authorName ?? "employee"}`,
    );
  }
  return notes;
}
