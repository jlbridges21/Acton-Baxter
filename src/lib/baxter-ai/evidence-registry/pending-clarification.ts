/**
 * Unified pending-clarification state for any clarification Baxter asks.
 *
 * Historically, PEM entity-disambiguation lived only in `pemContext.pending`, while the
 * information-category source menu stored no pending state at all — so replies to the
 * menu were treated as fresh questions. Both kinds now share this record so a reply is
 * interpreted in context, and a genuinely new question can abandon it.
 */

import { decideConversationContext } from "@/lib/baxter-ai/conversation-context";
import { extractProjectReferenceName } from "@/lib/dossier/project-setup-name-resolve";
import { normalizeEntitySearchName } from "@/lib/baxter-ai/entity-name-normalize";
import type { BaxterHistoryMessage } from "@/lib/baxter-ai/types";

export type PendingClarificationCategory = "pem" | "ghl" | "slack" | "project_registry";

export type PendingClarification = {
  /** information_category = source menu; entity_disambiguation = which person/PEM */
  kind: "information_category" | "entity_disambiguation";
  /** Clean entity search name (e.g. Janowitz). */
  entityName: string;
  /** Display label shown in the clarification (e.g. Linda Janowitz). */
  entityLabel: string;
  /** Original user question that triggered the clarification. */
  originalQuestion: string;
  /** Categories offered (information_category only). */
  categories: PendingClarificationCategory[];
  /** Candidate labels for entity_disambiguation (e.g. Test 8 vs Test 2). */
  candidateLabels: string[];
  setAt: string;
};

const KEY = "pendingClarification";

export function readPendingClarification(
  metadata: Record<string, unknown> | null | undefined,
): PendingClarification | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata[KEY];
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.kind !== "information_category" && o.kind !== "entity_disambiguation") return null;
  const entityName = typeof o.entityName === "string" ? o.entityName.trim() : "";
  if (!entityName) return null;
  return {
    kind: o.kind,
    entityName,
    entityLabel:
      typeof o.entityLabel === "string" && o.entityLabel.trim() ? o.entityLabel.trim() : entityName,
    originalQuestion: typeof o.originalQuestion === "string" ? o.originalQuestion : "",
    categories: Array.isArray(o.categories)
      ? (o.categories.filter(
          (c): c is PendingClarificationCategory =>
            c === "pem" || c === "ghl" || c === "slack" || c === "project_registry",
        ) as PendingClarificationCategory[])
      : [],
    candidateLabels: Array.isArray(o.candidateLabels)
      ? o.candidateLabels.filter((c): c is string => typeof c === "string")
      : [],
    setAt: typeof o.setAt === "string" ? o.setAt : new Date(0).toISOString(),
  };
}

export function writePendingClarification(
  metadata: Record<string, unknown>,
  next: PendingClarification | null,
): Record<string, unknown> {
  const copy = { ...metadata };
  if (!next) {
    delete copy[KEY];
    return copy;
  }
  copy[KEY] = next;
  return copy;
}

export function clearPendingClarification(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return writePendingClarification(metadata, null);
}

/**
 * Map a short reply onto a category offered by the information menu.
 * Returns null when the reply is not a category selection (may still be a
 * field follow-up about the same entity).
 */
export function detectClarificationCategoryReply(
  question: string,
): PendingClarificationCategory | null {
  const q = question.trim();
  if (!q) return null;

  if (
    /\b(pem|neat|type\s*[12]\s*pain|pain\s*points?|budget|decision\s+process|reason for building|sales notes)\b/i.test(
      q,
    )
  ) {
    return "pem";
  }
  if (/\b(contact(?:\s+info(?:rmation)?)?|go\s*high\s*level|\bghl\b|email|phone|crm)\b/i.test(q)) {
    return "ghl";
  }
  if (/\b(slack|channel|latest\s+updates?|recent\s+activity)\b/i.test(q)) {
    return "slack";
  }
  if (/\b(address|location|city|where|street|zip|postal)\b/i.test(q)) {
    return "project_registry";
  }
  return null;
}

/**
 * True when this turn names a different entity than the pending clarification.
 */
function namesDifferentEntity(question: string, pending: PendingClarification): boolean {
  const fromProject = extractProjectReferenceName(question);
  const normalizedPending =
    normalizeEntitySearchName(pending.entityName) || pending.entityName.toLowerCase();
  if (fromProject) {
    const n = fromProject.toLowerCase();
    if (
      n &&
      !n.includes(normalizedPending.toLowerCase()) &&
      !normalizedPending.toLowerCase().includes(n)
    ) {
      // Allow surname overlap with full label ("Janowitz" vs "Linda Janowitz")
      const pendingTokens = normalizedPending.toLowerCase().split(/\s+/);
      if (!pendingTokens.some((t) => t.length >= 3 && (n.includes(t) || t.includes(n)))) {
        return true;
      }
    }
  }

  const proper = question.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/);
  if (proper?.[1]) {
    const n = proper[1].toLowerCase();
    const label = pending.entityLabel.toLowerCase();
    const name = pending.entityName.toLowerCase();
    if (!label.includes(n) && !n.includes(name) && !name.includes(n.split(/\s+/).pop() ?? "")) {
      return true;
    }
  }
  return false;
}

/**
 * Decide whether a pending clarification should be abandoned for a new turn.
 * Preserves the previously-fixed behavior: a genuinely unrelated new question
 * drops the pending state.
 */
export function shouldAbandonPendingClarification(input: {
  question: string;
  history: BaxterHistoryMessage[];
  pending: PendingClarification;
}): boolean {
  const ctx = decideConversationContext(input.question, input.history);
  if (ctx.isAggregation || ctx.isNewSubject) return true;
  if (ctx.reason === "new_entity_named" || ctx.reason === "time_filter_new_scope") return true;
  if (namesDifferentEntity(input.question, input.pending)) return true;
  return false;
}

export type PendingClarificationResolution =
  | {
      action: "continue_with_entity";
      /** Question rewritten to include the pending entity so downstream extractors work. */
      enrichedQuestion: string;
      entityName: string;
      entityLabel: string;
      category: PendingClarificationCategory | null;
      clearPending: boolean;
    }
  | { action: "abandon" }
  | { action: "none" };

/**
 * Interpret the current user turn against a pending clarification.
 */
export function resolvePendingClarificationReply(input: {
  question: string;
  history: BaxterHistoryMessage[];
  pending: PendingClarification | null;
}): PendingClarificationResolution {
  const pending = input.pending;
  if (!pending) return { action: "none" };

  if (
    shouldAbandonPendingClarification(
      input as { question: string; history: BaxterHistoryMessage[]; pending: PendingClarification },
    )
  ) {
    return { action: "abandon" };
  }

  // Entity-disambiguation replies (e.g. "Test 8") are handled by PEM's own pending;
  // keep the unified record until PEM clears it, but do not rewrite here.
  if (pending.kind === "entity_disambiguation") {
    return { action: "none" };
  }

  const category = detectClarificationCategoryReply(input.question);
  const label = pending.entityLabel || pending.entityName;

  // Category pick or any follow-up field ask about the established entity.
  const enriched = enrichQuestionWithPendingEntity(input.question, label, category);
  return {
    action: "continue_with_entity",
    enrichedQuestion: enriched,
    entityName: pending.entityName,
    entityLabel: label,
    category,
    clearPending: true,
  };
}

function enrichQuestionWithPendingEntity(
  question: string,
  entityLabel: string,
  category: PendingClarificationCategory | null,
): string {
  const q = question.trim();
  // Already names the entity — leave as-is.
  if (
    new RegExp(`\\b${escapeRegExp(entityLabel.split(/\s+/).pop() || entityLabel)}\\b`, "i").test(q)
  ) {
    return q;
  }

  if (category === "pem") {
    return `Tell me about ${entityLabel}'s PEM NEAT`;
  }
  if (category === "ghl") {
    return `What is ${entityLabel}'s contact info from GoHighLevel?`;
  }
  if (category === "slack") {
    return `What is the latest update in ${entityLabel}'s project Slack channel?`;
  }
  if (category === "project_registry" || /\b(address|location|city|where)\b/i.test(q)) {
    if (/\bcity\b/i.test(q)) return `What city is the ${entityLabel} project?`;
    return `What is the ${entityLabel} project address?`;
  }

  // Generic continuation — attach entity so field extractors / registry can resolve.
  return `${q} (regarding the ${entityLabel} project)`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildInformationCategoryPending(input: {
  entityName: string;
  entityLabel: string;
  originalQuestion: string;
  categories: PendingClarificationCategory[];
}): PendingClarification {
  return {
    kind: "information_category",
    entityName: input.entityName,
    entityLabel: input.entityLabel,
    originalQuestion: input.originalQuestion,
    categories: input.categories,
    candidateLabels: [],
    setAt: new Date().toISOString(),
  };
}

export function buildEntityDisambiguationPending(input: {
  entityName: string;
  entityLabel: string;
  originalQuestion: string;
  candidateLabels: string[];
}): PendingClarification {
  return {
    kind: "entity_disambiguation",
    entityName: input.entityName,
    entityLabel: input.entityLabel,
    originalQuestion: input.originalQuestion,
    categories: [],
    candidateLabels: input.candidateLabels,
    setAt: new Date().toISOString(),
  };
}
