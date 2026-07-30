/**
 * Scoped GHL active-entity memory for follow-ups.
 * Persists references only — not field snapshots as long-term truth.
 * Stored in baxter_conversations.metadata.ghlContext
 */
import type { GhlRequestedField } from "./field-aliases";

export type GhlActiveContactRef = {
  id: string;
  displayName: string;
  email?: string | null;
  setAt: string;
};

export type GhlActiveOpportunityRef = {
  id: string;
  pipelineId?: string | null;
  pipelineName?: string | null;
  stageId?: string | null;
  stageName?: string | null;
  setAt: string;
};

export type GhlConversationContext = {
  contact: GhlActiveContactRef | null;
  opportunity: GhlActiveOpportunityRef | null;
  /** Last *answered* field set — not reused to override a new field ask. */
  lastRequestedFields: GhlRequestedField[];
  updatedAt: string;
};

const KEY = "ghlContext";

export function readGhlConversationState(
  metadata: Record<string, unknown> | null | undefined,
): GhlConversationContext | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata[KEY];
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const contactRaw = obj.contact;
  const opportunityRaw = obj.opportunity;
  return {
    contact:
      contactRaw && typeof contactRaw === "object"
        ? {
            id: String((contactRaw as { id?: unknown }).id ?? ""),
            displayName: String((contactRaw as { displayName?: unknown }).displayName ?? ""),
            email:
              typeof (contactRaw as { email?: unknown }).email === "string"
                ? (contactRaw as { email: string }).email
                : null,
            setAt:
              typeof (contactRaw as { setAt?: unknown }).setAt === "string"
                ? (contactRaw as { setAt: string }).setAt
                : new Date().toISOString(),
          }
        : null,
    opportunity:
      opportunityRaw && typeof opportunityRaw === "object"
        ? {
            id: String((opportunityRaw as { id?: unknown }).id ?? ""),
            pipelineId:
              typeof (opportunityRaw as { pipelineId?: unknown }).pipelineId === "string"
                ? (opportunityRaw as { pipelineId: string }).pipelineId
                : null,
            pipelineName:
              typeof (opportunityRaw as { pipelineName?: unknown }).pipelineName === "string"
                ? (opportunityRaw as { pipelineName: string }).pipelineName
                : null,
            stageId:
              typeof (opportunityRaw as { stageId?: unknown }).stageId === "string"
                ? (opportunityRaw as { stageId: string }).stageId
                : null,
            stageName:
              typeof (opportunityRaw as { stageName?: unknown }).stageName === "string"
                ? (opportunityRaw as { stageName: string }).stageName
                : null,
            setAt:
              typeof (opportunityRaw as { setAt?: unknown }).setAt === "string"
                ? (opportunityRaw as { setAt: string }).setAt
                : new Date().toISOString(),
          }
        : null,
    lastRequestedFields: Array.isArray(obj.lastRequestedFields)
      ? (obj.lastRequestedFields as GhlRequestedField[]).slice(0, 8)
      : [],
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
  };
}

export function writeGhlConversationState(
  metadata: Record<string, unknown>,
  next: GhlConversationContext | null,
): Record<string, unknown> {
  const copy = { ...metadata };
  if (!next) {
    delete copy[KEY];
    return copy;
  }
  copy[KEY] = next;
  return copy;
}

export function buildGhlConversationContext(input: {
  contact?: GhlActiveContactRef | null;
  opportunity?: GhlActiveOpportunityRef | null;
  lastRequestedFields?: GhlRequestedField[];
}): GhlConversationContext {
  const now = new Date().toISOString();
  return {
    contact: input.contact ? { ...input.contact, setAt: input.contact.setAt || now } : null,
    opportunity: input.opportunity
      ? { ...input.opportunity, setAt: input.opportunity.setAt || now }
      : null,
    lastRequestedFields: input.lastRequestedFields ?? [],
    updatedAt: now,
  };
}
