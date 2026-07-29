import type { BaxterAnswerMode } from "./types";

export type BaxterQuestionClass =
  | "baxter_identity"
  | "acton_company_specific"
  | "acton_process_specific"
  | "general_knowledge"
  | "conversational"
  | "clarification"
  | "unsafe_or_disallowed";

const UNSAFE =
  /\b(password|api[_\s-]?key|private[_\s-]?key|ssn|social security|ignore (all )?(previous|prior) instructions|jailbreak)\b/i;

export function classifyBaxterQuestion(question: string): BaxterQuestionClass {
  const q = normalizeForClassify(question);
  if (!q) return "conversational";
  if (UNSAFE.test(question)) return "unsafe_or_disallowed";

  if (
    /^(hi|hello|hey|thanks|thank you|ok|okay|cool|great|got it)\b/.test(q) ||
    /^(tell me more|what do you mean|can you (explain|clarify|expand)|say that differently|continue)\b/.test(
      q,
    )
  ) {
    return "conversational";
  }

  if (
    /\b(who (are|is) (you|baxter)|what (are|is) (you|baxter)|what can you do|how do you work|what do you know\b|what information can you|what (sources|systems) can you|are you customer|can you access (buildertrend|gohighlevel|domo)|what version|runtime version|what tools|how do i (generate|create|make) (a )?(pem )?neat|what is (a )?(pem|neat))\b/.test(
      q,
    ) ||
    q === "what do you know" ||
    q === "who is baxter" ||
    q === "what are you"
  ) {
    return "baxter_identity";
  }

  if (
    /\b(help me write|draft|summarize|rewrite|rephrase|explain (what|a|an|the)|what is (an |a )?adu\b|what is a raci|difference between|ideas for|professional email)\b/.test(
      q,
    ) &&
    !/\b(our|acton|company|internal|policy|procedure|pem|feasibility)\b/.test(q)
  ) {
    return "general_knowledge";
  }

  if (
    /\b(process|procedure|workflow|after feasibility|pem|site inspection|raci|handoff|checklist)\b/.test(
      q,
    ) &&
    /\b(our|we|acton|company|internal)\b/.test(q)
  ) {
    return "acton_process_specific";
  }

  if (
    /\b(acton|our (policy|pto|benefits|feasibility|handbook)|company (policy|process)|who is responsible|what does our)\b/.test(
      q,
    )
  ) {
    return "acton_company_specific";
  }

  if (/\b(clarify|which one|what specifically|can you be more specific)\b/.test(q)) {
    return "clarification";
  }

  if (/\bacton\b/.test(q) || /\bour internal\b/.test(q)) {
    return "acton_company_specific";
  }

  return "general_knowledge";
}

function normalizeForClassify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\w\s'?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function answerModeLabel(mode: BaxterAnswerMode | null | undefined): string | null {
  switch (mode) {
    case "identity":
      return "Baxter information";
    case "grounded":
      return "Approved Acton knowledge";
    case "general":
      return "General guidance";
    case "mixed":
      return "Mixed answer";
    case "clarification":
      return "Clarification";
    default:
      return null;
  }
}
