/**
 * Deterministic Baxter query plan — code-owned routing intent.
 * Guides source priority; does not grant the LLM arbitrary tool choice.
 */
import {
  detectConceptQuestion,
  hasLikelyPersonRecordSignal,
  isOperationalPemMetricQuestion,
  isStructuredMetricQuestion,
} from "@/lib/baxter/concept-vocabulary";
import { detectPemIntent } from "@/lib/baxter-data/pem-neats/intent";
import { planKnowledgeQuery } from "@/lib/knowledge-index/query-planner";
import { parseTimeRangeFromQuestion } from "@/lib/knowledge-index/temporal";
import { detectSlackSearchRole } from "@/lib/baxter-data/slack/when";

export type BaxterRoutingIntent =
  | "concept_definition"
  | "capability_help"
  | "company_policy_process"
  | "structured_metric"
  | "spreadsheet_data"
  | "prospect_intelligence"
  | "live_crm_contact"
  | "live_crm_opportunity"
  | "slack_recall"
  | "rulebook_process"
  | "current_status"
  | "general_question"
  | "ambiguous";

export type BaxterSourceKey =
  | "knowledge"
  | "structured_knowledge"
  | "pem_neat"
  | "rulebook"
  | "ghl"
  | "slack"
  | "general_model"
  | "capability_registry";

export type BaxterQueryPlan = {
  intent: BaxterRoutingIntent;
  subjectEntities: string[];
  prospectCandidates: string[];
  requestedFields: string[];
  metrics: string[];
  aggregations: Array<"count" | "sum" | "average" | "min" | "max" | null>;
  timeRange: { label: string; fromIso?: string; toIso?: string } | null;
  geography: string | null;
  sourcePriority: BaxterSourceKey[];
  sourcesSkipped: Array<{ source: BaxterSourceKey; reason: string }>;
  needsCurrentData: boolean;
  needsConversationData: boolean;
  pemLookup: "run" | "skip";
  pemSkipReason: string | null;
  operationalPemMetric: boolean;
  knowledgePlanMode: string | null;
  rawQuestion: string;
};

const GEOGRAPHY =
  /\b(bay area|east bay|south bay|peninsula|los angeles|\bla\b|orange county|san diego|sacramento|central valley)\b/i;

function extractGeography(question: string): string | null {
  const m = question.match(GEOGRAPHY);
  if (!m?.[1]) return null;
  const raw = m[1].trim();
  if (/^la$/i.test(raw)) return "LA";
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractMetrics(question: string): string[] {
  const metrics: string[] = [];
  const q = question.toLowerCase();
  if (/\b(how many|number of|count)\b/.test(q) && /\b(pem|meeting)/.test(q)) {
    metrics.push("pem_meeting_count");
  }
  if (/\bkpi\b/.test(q)) metrics.push("pem_kpi");
  if (/\b(how much|total).*(sold|sell|sales|agreement)/.test(q) || /\bsold this\b/.test(q)) {
    metrics.push("sales_total");
  }
  if (/\bmargin\b/.test(q)) metrics.push("margin");
  if (/\bconversion rate\b/.test(q)) metrics.push("conversion_rate");
  return metrics;
}

/**
 * Build a deterministic routing plan for diagnostics and answer-path decisions.
 */
export function buildBaxterQueryPlan(question: string, now: Date = new Date()): BaxterQueryPlan {
  const raw = question.trim();
  const concept = detectConceptQuestion(raw);
  const pem = detectPemIntent(raw);
  const knowledge = planKnowledgeQuery(raw, now);
  const timeRange = parseTimeRangeFromQuestion(raw, now);
  const geography = extractGeography(raw);
  const metrics = extractMetrics(raw);
  const slackRole = detectSlackSearchRole({ question: raw });
  const operationalPemMetric = isOperationalPemMetricQuestion(raw);
  const structuredMetric = isStructuredMetricQuestion(raw) || operationalPemMetric;
  const personSignal = hasLikelyPersonRecordSignal(raw);

  const prospectCandidates = pem.nameQuery ? [pem.nameQuery] : [];
  const sourcesSkipped: BaxterQueryPlan["sourcesSkipped"] = [];
  let intent: BaxterRoutingIntent = "general_question";
  let sourcePriority: BaxterSourceKey[] = ["knowledge", "general_model"];
  let pemLookup: "run" | "skip" = "skip";
  let pemSkipReason: string | null = "default_skip_until_name_gated";
  let needsCurrentData = false;
  let needsConversationData = false;

  // Status / Slack-current questions win over loose concept definitions ("What is the latest RACI update?")
  const statusOrSlack =
    slackRole === "primary" ||
    slackRole === "fallback" ||
    /\b(latest|status|update on|when will|ready|what happened)\b/i.test(raw);

  if (
    statusOrSlack &&
    slackRole !== "skip" &&
    !(concept.kind === "definition" && !/\b(latest|status|update|ready|when will)\b/i.test(raw))
  ) {
    intent =
      /\b(latest|status|ready|update on|when will|what happened)\b/i.test(raw) &&
      !/\bwhat did .+ say\b/i.test(raw)
        ? "current_status"
        : "slack_recall";
    sourcePriority =
      intent === "current_status" ? ["slack", "rulebook", "knowledge"] : ["slack", "knowledge"];
    needsCurrentData = true;
    needsConversationData = true;
    pemLookup = "skip";
    pemSkipReason = "slack_or_status_question";
    sourcesSkipped.push({ source: "pem_neat", reason: "not_prospect_intelligence" });
  } else if (
    concept.kind === "definition" &&
    !/\b(latest|status|update on|when will|ready)\b/i.test(raw)
  ) {
    intent = "concept_definition";
    sourcePriority = ["knowledge", "capability_registry", "general_model"];
    pemLookup = "skip";
    pemSkipReason = "concept_definition";
    sourcesSkipped.push({ source: "pem_neat", reason: "concept_definition_not_prospect" });
  } else if (concept.kind === "how_to" || concept.kind === "capability_overview") {
    intent = "capability_help";
    sourcePriority = ["capability_registry", "knowledge"];
    pemLookup = "skip";
    pemSkipReason = "capability_help";
    sourcesSkipped.push({ source: "pem_neat", reason: "capability_not_prospect" });
  } else if (structuredMetric) {
    intent = "structured_metric";
    sourcePriority = ["structured_knowledge", "knowledge", "ghl", "slack"];
    pemLookup = "skip";
    pemSkipReason = "operational_metric_no_prospect";
    sourcesSkipped.push({
      source: "pem_neat",
      reason: "no_matched_prospect_for_metric_question",
    });
  } else if (pem.intent === "record_lookup" && (pem.nameQuery || personSignal)) {
    intent = "prospect_intelligence";
    sourcePriority = ["pem_neat", "knowledge"];
    pemLookup = "run";
    pemSkipReason = null;
  } else if (/\b(raci|rulebook|who (owns|is responsible|handles))\b/i.test(raw)) {
    intent = "rulebook_process";
    sourcePriority = ["rulebook", "knowledge", "slack"];
    pemLookup = "skip";
    pemSkipReason = "rulebook_process";
    sourcesSkipped.push({ source: "pem_neat", reason: "process_not_prospect" });
  } else if (
    /\b(address|phone|email|stage|pipeline|opportunity|contact|owner)\b/i.test(raw) &&
    personSignal
  ) {
    intent = /\b(stage|pipeline|opportunity|owner)\b/i.test(raw)
      ? "live_crm_opportunity"
      : "live_crm_contact";
    sourcePriority = ["ghl", "knowledge"];
    pemLookup = "skip";
    pemSkipReason = "live_crm_preferred";
    sourcesSkipped.push({ source: "pem_neat", reason: "crm_field_not_pem_field" });
  } else if (knowledge.mode.startsWith("structured") || knowledge.aggregation) {
    intent = "spreadsheet_data";
    sourcePriority = ["structured_knowledge", "knowledge"];
    pemLookup = "skip";
    pemSkipReason = "structured_data_question";
  } else if (/\b(process|procedure|policy|standard|feasibility|warranty)\b/i.test(raw)) {
    intent = "company_policy_process";
    sourcePriority = ["knowledge", "rulebook"];
    pemLookup = "skip";
    pemSkipReason = "policy_process";
  } else if (pem.intent === "record_lookup" && !pem.nameQuery) {
    intent = "ambiguous";
    sourcePriority = ["knowledge"];
    pemLookup = "skip";
    pemSkipReason = "record_request_without_prospect";
    sourcesSkipped.push({ source: "pem_neat", reason: "no_prospect_candidate" });
  } else {
    intent = "general_question";
    sourcePriority = ["knowledge", "general_model"];
    pemLookup = "skip";
    pemSkipReason = "no_pem_signal";
  }

  // Strong prospect + PEM field always elevates PEM (unless metric/status already decided)
  if (
    pem.intent === "record_lookup" &&
    pem.nameQuery &&
    !operationalPemMetric &&
    !structuredMetric &&
    intent !== "current_status" &&
    intent !== "slack_recall"
  ) {
    intent = "prospect_intelligence";
    pemLookup = "run";
    pemSkipReason = null;
    sourcePriority = ["pem_neat", ...sourcePriority.filter((s) => s !== "pem_neat")];
    for (let i = sourcesSkipped.length - 1; i >= 0; i--) {
      if (sourcesSkipped[i]?.source === "pem_neat") sourcesSkipped.splice(i, 1);
    }
  }

  return {
    intent,
    subjectEntities: knowledge.entities.slice(0, 5),
    prospectCandidates,
    requestedFields: pem.fields.length ? pem.fields : knowledge.requestedFields.slice(0, 8),
    metrics,
    aggregations: [knowledge.aggregation ?? null],
    timeRange: timeRange
      ? { label: timeRange.label, fromIso: timeRange.fromIso, toIso: timeRange.toIso }
      : knowledge.timeRange
        ? {
            label: knowledge.timeRange.label,
            fromIso: knowledge.timeRange.fromIso,
            toIso: knowledge.timeRange.toIso,
          }
        : null,
    geography,
    sourcePriority,
    sourcesSkipped,
    needsCurrentData,
    needsConversationData,
    pemLookup,
    pemSkipReason,
    operationalPemMetric,
    knowledgePlanMode: knowledge.mode,
    rawQuestion: raw,
  };
}
