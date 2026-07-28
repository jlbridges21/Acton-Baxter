/**
 * Synthetic Fact Ledger fixture modeled on a rich ADU+pool PEM (no real PII).
 * Concepts only — for Sales Intelligence contract tests.
 */
import type { FactLedger } from "@/lib/pem-neat/fact-ledger";
import type { SalesIntelligenceStageOutput } from "@/lib/pem-neat/sales-intelligence-stage";

export const ROBERT_STYLE_FACT_LEDGER: FactLedger = {
  customerContext: [
    {
      summary: "Homeowner has lived in the property since the mid-1990s.",
      speaker: "customer",
      confidence: "high",
    },
    {
      summary:
        "Adult child returned from a mountain town about a year ago and currently rents nearby.",
      speaker: "customer",
      confidence: "high",
    },
    {
      summary: "Homeowner and long-time partner live in the main house.",
      speaker: "customer",
      confidence: "medium",
    },
  ],
  motivation: [
    {
      summary:
        "Considering an ADU so the adult child can keep an independent residence on the property.",
      speaker: "customer",
      confidence: "high",
    },
    {
      summary:
        "Longer term, the adult child may help as the homeowner ages and may eventually inherit.",
      speaker: "customer",
      confidence: "medium",
    },
  ],
  partnerConcerns: [
    {
      summary: "Wants one company to manage the entire process end-to-end.",
      speaker: "customer",
      confidence: "high",
    },
    {
      summary:
        "Prior DIY/managed remodel experience led to mistakes; prefers professional project management.",
      speaker: "customer",
      confidence: "high",
    },
    {
      summary:
        "Values experience, quality, performance, service, transparency, and problem management over lowest cost.",
      speaker: "customer",
      confidence: "high",
    },
  ],
  budget: [
    {
      summary: "Approximately $500,000 cash available for the overall backyard project.",
      amount: "$500,000",
      speaker: "customer",
      confidence: "high",
    },
    {
      summary: "Working allocation roughly $400,000 ADU and $100,000 pool.",
      amount: "$400,000",
      speaker: "customer",
      confidence: "medium",
    },
    {
      summary: "Pool base install quote around $80,000; homeowner budgets closer to $100,000.",
      amount: "$100,000",
      speaker: "customer",
      confidence: "medium",
    },
    {
      summary:
        "Above $500,000 may be possible with other funding; around $600,000 starts to feel like pushing too far.",
      amount: "$600,000",
      speaker: "customer",
      confidence: "medium",
    },
  ],
  decision: [
    {
      summary: 'Homeowner says the final call is theirs: "It\'s my call."',
      speaker: "customer",
      confidence: "high",
    },
    {
      summary: "Adult child's willingness to live in the ADU is a gating condition.",
      speaker: "customer",
      confidence: "high",
    },
    {
      summary: "Partner appears supportive.",
      speaker: "customer",
      confidence: "medium",
    },
    {
      summary: "No firm decision deadline; early discovery stage.",
      speaker: "customer",
      confidence: "high",
    },
    {
      summary: "Alternative: continue adult child's rental.",
      speaker: "customer",
      confidence: "high",
    },
    {
      summary: "Alternative: buy a separate home/condo for the adult child.",
      speaker: "customer",
      confidence: "medium",
    },
    {
      summary: "Alternative: adult child moves farther toward foothills/mountain towns.",
      speaker: "customer",
      confidence: "medium",
    },
    {
      summary: "Alternative: adult child moves into the main house.",
      speaker: "customer",
      confidence: "medium",
    },
    {
      summary: "Alternative: build pool + recreational pool house without an ADU.",
      speaker: "customer",
      confidence: "medium",
    },
  ],
  schedule: [
    {
      summary:
        "Adult child's lease renews in September; homeowner expects renewal may happen either way.",
      speaker: "customer",
      confidence: "medium",
    },
  ],
  project: [
    {
      summary: "Considering coordinated ADU + pool replacement in the backyard.",
      speaker: "customer",
      confidence: "high",
    },
    {
      summary: "Manzanita Build Ready model discussed (~448 SF); also smaller ~350–400 SF custom.",
      speaker: "advisor",
      confidence: "medium",
    },
    {
      summary: "Sewer routing/depth is a concern; PUE/easement and setbacks discussed.",
      speaker: "customer",
      confidence: "high",
    },
    {
      summary:
        "Prefers ~10' separation from house to avoid fire-rating requirements; trees and electrical/PG&E concerns noted.",
      speaker: "customer",
      confidence: "medium",
    },
    {
      summary: "Feasibility package proposed to verify sitework before locking design.",
      speaker: "advisor",
      confidence: "high",
    },
  ],
  commitments: [
    {
      summary: "Advisor to send feasibility package details.",
      speaker: "advisor",
      confidence: "medium",
    },
  ],
  nextSteps: [
    {
      summary: "Prospect to discuss ADU living interest with adult child.",
      speaker: "customer",
      confidence: "medium",
    },
    {
      summary: "Acton to outline feasibility package and coordinated ADU/pool path.",
      speaker: "advisor",
      confidence: "medium",
    },
  ],
  pemProcessEvidence: [
    {
      summary: "PALO / purpose and agenda delivered near meeting start.",
      speaker: "advisor",
      confidence: "high",
    },
    {
      summary: "Three meeting outcomes explained.",
      speaker: "advisor",
      confidence: "medium",
    },
  ],
  limitations: ["Exact sewer depth and easement survey still needed."],
};

/** Representative valid SI stage output for the synthetic ledger (no live model). */
export const ROBERT_STYLE_SI_STAGE: SalesIntelligenceStageOutput = {
  customerStory:
    "Homeowner is exploring an ADU as a long-term housing solution for an adult child who returned to the area about a year ago and currently rents nearby. They want independence while remaining close to family, especially as the homeowner ages. The project is being considered together with pool replacement, creating a coordinated backyard opportunity.",
  customerPain:
    "They want a financially sensible way to provide independent nearby housing without indefinite rent or forcing a move farther away, while avoiding personally coordinating multiple contractors and complex site work.",
  type1Pain: {
    summary: "Independent nearby housing for adult child with long-term family flexibility.",
    drivers: [
      "Give adult child an independent place near family",
      "Reduce long-term dependence on rental housing",
      "Keep adult child nearby for future aging support",
      "Create long-term flexibility on a long-owned property",
    ],
  },
  type2Pain: {
    summary: "Strong preference for one accountable company managing ADU + pool coordination.",
    drivers: [
      "One company managing ADU and pool coordination",
      "Project management rather than managing subcontractors personally",
      "Transparency when problems occur",
      "Experience, quality, service, and predictability above lowest price",
      "Professional discovery and management of site/utility issues",
    ],
  },
  budget: {
    summary:
      "About $500k cash available with a working split of ~$400k ADU / ~$100k pool; additional funding may be possible, while ~$600k starts to feel too expensive. Still exploratory pending sitework.",
    statedTarget: 500000,
    availableFunds: 500000,
    potentialCeiling: 600000,
    aduAllocation: 400000,
    poolAllocation: 100000,
    fundingSummary: "Primarily cash available; additional funding beyond $500k appears possible.",
    flexibility: "Exploratory — site work and coordinated pool scope unknown.",
    risks: ["Sitework/utility unknowns could shift allocations", "~$600k psychological threshold"],
  },
  decisionProcess: {
    summary:
      "Homeowner is primary decision maker; adult child's willingness to live in the ADU is a gating factor. Partner supportive. Early discovery with no firm deadline.",
    primaryDecisionMaker: "Homeowner",
    otherParticipants: ["Adult child (gating participant)", "Long-term partner (supportive)"],
    gatingFactors: ["Adult child must want to live in the ADU"],
    alternatives: [
      "Continue rental",
      "Purchase another property",
      "Move farther toward foothills",
      "Move into main house",
      "Pool + recreational pool house instead of ADU",
    ],
    criteria: ["End-to-end management", "Quality and transparency", "Site certainty"],
    timing: "Early discovery; lease renews in September but not a hard decision deadline",
  },
  schedule: {
    summary: "Low urgency; exploratory timing tied loosely to lease renewal without a hard stop.",
    urgency: "Low",
    dates: ["September lease renewal (soft)"],
    drivers: ["Early discovery", "Feasibility package first"],
  },
  competitionAlternatives: [
    "Continue rental",
    "Buy separate property",
    "Move farther away",
    "Main house",
    "Pool house without ADU",
  ],
  actonRecommendation: {
    fit: "potential_fit",
    summary:
      "Strong Type 2 alignment with turnkey coordination and feasibility-first site discovery; still early on decision timing and adult-child gating.",
    reasons: [
      "End-to-end preference matches Acton model",
      "ADU + pool coordination opportunity",
      "Feasibility package addresses sewer/easement unknowns",
    ],
  },
  nextSteps: {
    prospect: ["Confirm adult child's interest in living in an ADU", "Review feasibility package"],
    acton: ["Send feasibility package outline", "Coordinate ADU/pool path options"],
  },
  meetingOutcome: {
    classification: "DECISION_DATE_NOT_SECURED",
    explanation:
      "Meeting still in discovery; no firm decision date secured. If transcript ends abruptly, treat ending as incomplete.",
    transcriptIncomplete: true,
  },
  qualification: {
    classification: "EARLY_EXPLORATORY",
    explanation:
      "Clear pain/budget/decision signals with strong Type 2 fit, but early discovery and gating on adult-child participation.",
    risks: ["Adult-child gating", "Sitework cost uncertainty", "Incomplete meeting ending"],
  },
};

export const ROBERT_STYLE_SI_CONCEPT_HINTS = {
  story: [/adult child|son|independent|nearby|pool/i],
  type1: [/independen|nearby|rent|aging|flexib/i],
  type2: [/one company|end-to-end|transpar|quality|project management/i],
  budget: [/500|400|100|600/],
  decision: [/my call|gating|partner|discovery|deadline/i],
  alternatives: [/rent|property|foothill|main house|pool house/i],
};
