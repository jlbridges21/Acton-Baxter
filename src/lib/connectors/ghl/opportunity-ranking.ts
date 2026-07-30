import type { GhlOpportunity } from "./types";
import type { GhlReferenceData } from "./reference-data";

export type OpportunityRankPolicy = {
  /** Pipeline name substrings preferred as active project pipelines (case-insensitive). */
  preferredPipelineKeywords: string[];
  /** Pipeline name substrings treated as marketing/secondary unless user asks historically. */
  marketingPipelineKeywords: string[];
  /** Prefer open status over closed. */
  preferOpen: boolean;
  /**
   * Extra score for preferred pipelines (stage/pipeline questions).
   * Lets Feasibility beat an open Marketing opp even when FP is closed.
   */
  preferredPipelineBoost?: number;
};

export const DEFAULT_OPPORTUNITY_RANK_POLICY: OpportunityRankPolicy = {
  preferredPipelineKeywords: ["feasibility", "design agreement", "pem", "project", "sales"],
  marketingPipelineKeywords: ["marketing", "nurture", "cold"],
  preferOpen: true,
  preferredPipelineBoost: 0,
};

/** Stronger preferred-pipeline bias for stage/pipeline questions (FP over Marketing). */
export const STAGE_QUESTION_RANK_POLICY: OpportunityRankPolicy = {
  preferredPipelineKeywords: ["feasibility", "design agreement", "pem", "project", "sales"],
  marketingPipelineKeywords: ["marketing", "nurture", "cold"],
  preferOpen: true,
  preferredPipelineBoost: 50,
};

function scoreOpportunity(
  opp: GhlOpportunity,
  refs: GhlReferenceData | null,
  policy: OpportunityRankPolicy,
): number {
  let score = 0;
  const pipelineName = (refs?.pipelineNameById.get(opp.pipelineId) ?? "").toLowerCase();
  const status = (opp.status || "").toLowerCase();
  const preferredBoost = policy.preferredPipelineBoost ?? 0;

  if (policy.preferOpen && status === "open") score += 100;
  if (status === "won" || status === "lost" || status === "abandoned") score -= 50;

  for (const kw of policy.preferredPipelineKeywords) {
    if (pipelineName.includes(kw.toLowerCase())) score += 40 + preferredBoost;
  }
  for (const kw of policy.marketingPipelineKeywords) {
    if (pipelineName.includes(kw.toLowerCase())) score -= 30;
  }

  const updated = opp.dateUpdated ? new Date(opp.dateUpdated).getTime() : 0;
  // Recency boost (up to ~30 points for updates within last ~90 days)
  if (updated) {
    const days = (Date.now() - updated) / 86400000;
    score += Math.max(0, 30 - days / 3);
  }

  return score;
}

/**
 * Rank opportunities for a contact when Baxter needs "the" project opportunity.
 * Does not hide multiples — callers should clarify when top scores are close.
 */
export function rankOpportunitiesForContact(
  opportunities: GhlOpportunity[],
  refs: GhlReferenceData | null,
  policy: OpportunityRankPolicy = DEFAULT_OPPORTUNITY_RANK_POLICY,
): GhlOpportunity[] {
  return [...opportunities].sort(
    (a, b) => scoreOpportunity(b, refs, policy) - scoreOpportunity(a, refs, policy),
  );
}

export function opportunitiesNeedClarification(
  ranked: GhlOpportunity[],
  refs: GhlReferenceData | null,
  policy: OpportunityRankPolicy = DEFAULT_OPPORTUNITY_RANK_POLICY,
): boolean {
  if (ranked.length <= 1) return false;
  const top = scoreOpportunity(ranked[0]!, refs, policy);
  const second = scoreOpportunity(ranked[1]!, refs, policy);
  return Math.abs(top - second) < 25;
}
