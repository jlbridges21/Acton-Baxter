/**
 * Source authority — which evidence class leads for which question types.
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

  if (/\b(what can (you|baxter) do|how do i use baxter|capabilities)\b/.test(q)) {
    return { primary: ["capability"], secondary: [], notes: ["Capability / help"] };
  }

  if (
    /\b(type\s*[12]\s*pain|neat|pem)\b/.test(q) &&
    /\b(said|slack|discussed|mentioned)\b/.test(q)
  ) {
    return {
      primary: ["pem_neat", "slack"],
      secondary: ["gohighlevel"],
      notes: ["PEM facts + Slack discussion"],
    };
  }

  if (/\b(type\s*[12]\s*pain|neat assessment|feasibility package fields)\b/.test(q)) {
    return { primary: ["pem_neat"], secondary: ["slack"], notes: ["Saved PEM NEAT"] };
  }

  if (/\b(stage|pipeline|opportunity|contact|calendar|ghl|gohighlevel)\b/.test(q)) {
    if (/\b(said|slack|discussed|mentioned)\b/.test(q)) {
      return {
        primary: ["gohighlevel", "slack"],
        secondary: [],
        notes: ["CRM + Slack"],
      };
    }
    return { primary: ["gohighlevel"], secondary: ["slack"], notes: ["CRM source of truth"] };
  }

  if (
    /\b(official|policy|procedure|how should|standard process|rulebook|raci matrix process)\b/.test(
      q,
    )
  ) {
    return {
      primary: ["rulebook", "knowledge"],
      secondary: ["slack"],
      notes: ["Approved process leads; Slack may note recent discussion"],
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

  if (/\b(latest|current|status|update|right now)\b/.test(q)) {
    return {
      primary: ["gohighlevel", "slack"],
      secondary: ["knowledge", "pem_neat", "rulebook"],
      notes: ["Live/current sources preferred"],
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
    "- Distinguish Slack suggestions vs decisions vs implementations; do not invent consensus.",
    "- Never invent authors, channels, dates, or Slack links.",
    ...hint.notes.map((n) => `- Note: ${n}`),
  ]
    .filter(Boolean)
    .join("\n");
}
