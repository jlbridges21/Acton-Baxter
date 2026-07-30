import type { BaxterAnswerMode, BaxterSourceKind, BaxterSourceReference } from "./types";

export type BaxterQuestionClass =
  | "baxter_identity"
  | "acton_company_specific"
  | "acton_process_specific"
  | "general_knowledge"
  | "conversational"
  | "clarification"
  | "unsafe_or_disallowed";

/** User-facing answer provenance labels (code-owned; not model-chosen). */
export type BaxterAnswerTypeLabel =
  | "Approved Acton knowledge"
  | "Live Acton data"
  | "Slack conversational update"
  | "PEM sales intelligence"
  | "General knowledge"
  | "Baxter information"
  | "Mixed Acton sources"
  | "Clarification"
  | "Mixed answer";

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
    /\b(who (are|is) (you|baxter)|what (are|is) (you|baxter)|what can you (do|help)|how do you work|what do you know\b|what information can you|what (sources|systems) can you|what are your (capabilities|limitations)|are you customer|what version|runtime version|what tools)\b/.test(
      q,
    ) ||
    q === "what do you know" ||
    q === "who is baxter" ||
    q === "what are you"
  ) {
    return "baxter_identity";
  }

  // Narrow “can you access X / do you have BuilderTrend” stay identity-scoped, not company process.
  if (
    /\b(can you (access|search|read|generate)|do you have access to|do you support)\b/.test(q) &&
    /\b(buildertrend|gohighlevel|ghl|slack|google|pem|neat|domo)\b/.test(q) &&
    !/\bhttps?:\/\/|docs\.google\.com\b/.test(q)
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

/** Legacy mode→label map (kept for callers without sources). Prefer deriveAnswerTypeLabel. */
export function answerModeLabel(mode: BaxterAnswerMode | null | undefined): string | null {
  switch (mode) {
    case "identity":
      return "Baxter information";
    case "grounded":
      return "Approved Acton knowledge";
    case "general":
      return "General knowledge";
    case "mixed":
      return "Mixed answer";
    case "clarification":
      return "Clarification";
    default:
      return null;
  }
}

type AnswerTypeBucket = "approved" | "live" | "slack" | "pem" | "capability" | "other";

function bucketForSourceKind(kind: BaxterSourceKind): AnswerTypeBucket {
  switch (kind) {
    case "knowledge_entry":
    case "manual":
    case "google_doc":
    case "google_sheet":
    case "google_file":
    case "rulebook":
      return "approved";
    case "gohighlevel":
      return "live";
    case "slack":
      return "slack";
    case "pem_neat":
      return "pem";
    case "capability":
      return "capability";
    default:
      return "other";
  }
}

const BUCKET_LABEL: Record<Exclude<AnswerTypeBucket, "other" | "capability">, string> = {
  approved: "Approved Acton knowledge",
  live: "Live Acton data",
  slack: "Slack conversational update",
  pem: "PEM sales intelligence",
};

/**
 * Derive user-facing answer type from actual cited sources + answer mode.
 * Code-owned — do not ask the model to invent this label.
 */
export function deriveAnswerTypeLabel(input: {
  answerMode?: BaxterAnswerMode | null;
  sources?: Array<Pick<BaxterSourceReference, "sourceKind">> | null;
}): string | null {
  const mode = input.answerMode ?? null;
  const sources = input.sources ?? [];

  if (mode === "clarification") return "Clarification";
  if (mode === "error") return null;
  if (mode === "identity" && sources.length === 0) return "Baxter information";

  const buckets = new Set<AnswerTypeBucket>();
  for (const source of sources) {
    buckets.add(bucketForSourceKind(source.sourceKind));
  }
  buckets.delete("capability");
  buckets.delete("other");

  if (buckets.size === 0) {
    if (mode === "general") return "General knowledge";
    if (mode === "mixed") return "Mixed answer";
    if (mode === "identity") return "Baxter information";
    return answerModeLabel(mode);
  }

  if (buckets.size === 1) {
    const only = [...buckets][0]!;
    return BUCKET_LABEL[only as keyof typeof BUCKET_LABEL] ?? "Mixed Acton sources";
  }

  // Two clear kinds → join with + ; three+ → Mixed Acton sources
  if (buckets.size === 2) {
    const order: Array<keyof typeof BUCKET_LABEL> = ["approved", "live", "slack", "pem"];
    const labels = order.filter((k) => buckets.has(k)).map((k) => BUCKET_LABEL[k]);
    if (labels.length === 2) return `${labels[0]} + ${labels[1]}`;
  }

  return "Mixed Acton sources";
}
