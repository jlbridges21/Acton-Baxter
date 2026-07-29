/**
 * Source authority — which evidence class leads for which question types.
 * Intent-dependent: not one global ranking for every question.
 */

export type BaxterSourceAuthorityClass =
  "knowledge" | "pem_neat" | "gohighlevel" | "rulebook" | "slack" | "capability";

export type SourceAuthorityHint = {
  primary: BaxterSourceAuthorityClass[];
  secondary: BaxterSourceAuthorityClass[];
  notes: string[];
};

/**
 * Deterministic hints for the model / orchestration (not a hard filter).
 */
export function classifySourceAuthority(question: string): SourceAuthorityHint {
  const q = question.toLowerCase();

  if (
    /\b(what can (you|baxter) (do|search)|how do i use baxter|capabilities|search in slack)\b/.test(
      q,
    )
  ) {
    return { primary: ["capability"], secondary: [], notes: ["Capability / help"] };
  }

  // Explicit Slack attribution / conversational recall
  if (
    /\b(what did .+ say|who (said|mentioned)|last message|summarize #|in #[\w-]+|did .+ respond|what did (he|she|they) say)\b/.test(
      q,
    )
  ) {
    return {
      primary: ["slack"],
      secondary: [],
      notes: [
        "Slack is authoritative for who-said / message recall — do not answer from docs as if someone said them",
      ],
    };
  }

  if (
    /\b(type\s*[12]\s*pain|neat|pem)\b/.test(q) &&
    /\b(said|slack|discussed|mentioned|since the pem|team)\b/.test(q)
  ) {
    return {
      primary: ["pem_neat", "slack"],
      secondary: ["gohighlevel"],
      notes: ["PEM facts + Slack discussion — keep source/time separate"],
    };
  }

  if (/\b(type\s*[12]\s*pain|neat assessment|feasibility package fields)\b/.test(q)) {
    return { primary: ["pem_neat"], secondary: ["slack"], notes: ["Saved PEM NEAT"] };
  }

  if (/\b(stage|pipeline|opportunity|contact|calendar|ghl|gohighlevel)\b/.test(q)) {
    if (/\b(said|slack|discussed|mentioned|asked to|delay)\b/.test(q)) {
      return {
        primary: ["gohighlevel", "slack"],
        secondary: [],
        notes: ["CRM state + Slack conversation — do not claim CRM updated unless GHL shows it"],
      };
    }
    return { primary: ["gohighlevel"], secondary: ["slack"], notes: ["CRM source of truth"] };
  }

  if (
    /\b(official|policy|procedure|required|standard|how should|who is responsible|rulebook)\b/.test(
      q,
    )
  ) {
    return {
      primary: ["rulebook", "knowledge"],
      secondary: ["slack"],
      notes: ["Official process leads; Slack may note temporary coverage or recent discussion"],
    };
  }

  if (
    /\b(said|say|says|saying|mentioned|discussed|discussion|conversation|last message|who said|when did we decide|what happened|summarize #|in #)\b/.test(
      q,
    )
  ) {
    return {
      primary: ["slack"],
      secondary: ["knowledge", "rulebook", "gohighlevel", "pem_neat"],
      notes: ["Conversational / historical Slack"],
    };
  }

  if (/\b(latest|current|status|update|right now|where are we|today|when will)\b/.test(q)) {
    return {
      primary: ["gohighlevel", "slack"],
      secondary: ["knowledge", "pem_neat", "rulebook"],
      notes: ["Live/current sources preferred; surface Slack vs approved-source discrepancies"],
    };
  }

  return {
    primary: ["knowledge"],
    secondary: ["rulebook", "pem_neat", "gohighlevel", "slack"],
    notes: ["Default Knowledge-first"],
  };
}

/** Prompt block explaining authority to the model. */
export function buildSourceAuthorityPromptBlock(hint: SourceAuthorityHint): string {
  return [
    "Source authority for this question:",
    `- Prefer: ${hint.primary.join(", ")}`,
    hint.secondary.length ? `- Also useful: ${hint.secondary.join(", ")}` : null,
    "- Slack = conversational/current team discussion — NOT automatic approved policy.",
    "- Knowledge / Rulebook = approved organizational knowledge and process.",
    "- PEM NEAT = saved partnership-evaluation intelligence for a prospect.",
    "- GoHighLevel = live CRM records (stages, contacts, opportunities).",
    "- If Slack is newer than Knowledge on the same factual claim, explain both (do not silently overwrite).",
    "- Distinguish Slack suggestions vs decisions vs implementations vs reversals; do not invent consensus.",
    "- Never invent authors, channels, dates, or Slack links.",
    "- Never attribute Knowledge/Rulebook/GHL facts as something an employee 'said' unless Slack evidence shows it.",
    "- Do not invent deadlines from vague language ('soon').",
    "- Prefer paraphrasing Slack; short quotes only when the user asks what someone exactly said.",
    "- If Slack search failed or was incomplete, say so — do not invent Slack content from other sources.",
    ...hint.notes.map((n) => `- Note: ${n}`),
  ]
    .filter(Boolean)
    .join("\n");
}
