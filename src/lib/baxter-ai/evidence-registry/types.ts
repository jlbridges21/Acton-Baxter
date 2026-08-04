/**
 * Evidence-source registry contracts.
 * Arbitration layer over GHL / Rulebook / PEM — does not rewrite those subsystems.
 */

import type { BaxterContextItem, BaxterHistoryMessage } from "@/lib/baxter-ai/types";
import type { EntityResolutionResult } from "./entity-resolution";
import type { PreferredEntitySource } from "./conversation-arbitration";

export type EvidenceSourceKey = "ghl" | "rulebook" | "pem_neat" | "customer_dossier";

export type EvidenceSourceHandleInput = {
  question: string;
  history: BaxterHistoryMessage[];
  entity: EntityResolutionResult;
  preferredSource: PreferredEntitySource | null;
  conversationMetadata: Record<string, unknown>;
  role?: string | null;
  channel?: "web" | "slack";
  ghlConfigured: boolean;
  /** Baxter profile id — used for per-user Slack Search authorization (not routing). */
  userId?: string | null;
  externalUserId?: string | null;
  slackTeamId?: string | null;
};

export type EvidenceSourceResolveInput = EvidenceSourceHandleInput & {
  /** Sources already tried that returned null (found nothing). */
  priorMisses: EvidenceSourceKey[];
};

export type EvidenceSourceResult = {
  items: BaxterContextItem[];
  deterministicAnswer?: string | null;
  clarification?: string | null;
  /** 0–1; high means safe to short-circuit with this result. */
  confidence: number;
  /** Optional per-source conversation state patches applied by the orchestrator. */
  nextGhlState?: import("@/lib/baxter-data/ghl/conversation-state").GhlConversationContext | null;
  nextPemState?:
    import("@/lib/baxter-data/pem-neats/conversation-state").PemConversationState | null;
  diagnostics?: unknown;
  /** True when this is a "not found in this source" soft miss that should not stop the registry. */
  softMiss?: boolean;
  intentLabel?: string | null;
};

export type EvidenceSource = {
  key: EvidenceSourceKey;
  canHandle(input: EvidenceSourceHandleInput): { plausible: boolean; confidence: number };
  resolve(input: EvidenceSourceResolveInput): Promise<EvidenceSourceResult | null>;
};

export type RegistryEarlyAnswer = {
  kind: "deterministic" | "clarification" | "not_found";
  answer: string;
  sources: BaxterContextItem[];
  confidence: "high" | "medium" | "low";
  insufficientKnowledge: boolean;
  answerMode: "grounded" | "clarification";
  modelProvider: string;
  modelName: string;
  winningSource: EvidenceSourceKey | "none";
};

export type RegistryRunResult = {
  earlyAnswer: RegistryEarlyAnswer | null;
  /** Items to prepend/merge into KB context when no early answer. */
  contextItems: BaxterContextItem[];
  conversationMetadata: Record<string, unknown>;
  diagnostics: {
    entity: EntityResolutionResult;
    preferredSource: PreferredEntitySource | null;
    tried: Array<{ key: EvidenceSourceKey; confidence: number; outcome: string }>;
    semantic?: {
      questionType: string;
      confidence: number;
      source: string;
      latencyMs: number;
      model: string | null;
      error?: string;
      skippedEntityLookup: boolean;
    };
  };
};
