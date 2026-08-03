/**
 * Conversation-entity arbitration layer.
 *
 * Design choice: keep physical stores separate (`ghlContext` / `pemContext` / `slackContext`)
 * and add a thin arbitration record (`entityArbitration`) plus a reader that picks the
 * most-recently established source. Merging the three stores would be more disruptive
 * and risk breaking each source's follow-up contracts; arbitration alone fixes the
 * "code-order wins" bug for ambiguous pronouns.
 */

import { readGhlConversationState } from "@/lib/baxter-data/ghl/conversation-state";
import { readPemConversationState } from "@/lib/baxter-data/pem-neats/conversation-state";
import { readSlackConversationState } from "@/lib/baxter-data/slack/conversation-state";
import { decideConversationContext } from "@/lib/baxter-ai/conversation-context";
import type { BaxterHistoryMessage } from "@/lib/baxter-ai/types";
import type { EvidenceSourceKey } from "./types";

export type PreferredEntitySource = "ghl" | "pem" | "slack";

export type EntityArbitrationRecord = {
  lastSource: PreferredEntitySource;
  label: string | null;
  setAt: string;
};

const KEY = "entityArbitration";

export function readEntityArbitration(
  metadata: Record<string, unknown> | null | undefined,
): EntityArbitrationRecord | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata[KEY];
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const lastSource = obj.lastSource;
  if (lastSource !== "ghl" && lastSource !== "pem" && lastSource !== "slack") return null;
  return {
    lastSource,
    label: typeof obj.label === "string" ? obj.label : null,
    setAt: typeof obj.setAt === "string" ? obj.setAt : new Date(0).toISOString(),
  };
}

export function writeEntityArbitration(
  metadata: Record<string, unknown>,
  next: EntityArbitrationRecord | null,
): Record<string, unknown> {
  const copy = { ...metadata };
  if (!next) {
    delete copy[KEY];
    return copy;
  }
  copy[KEY] = next;
  return copy;
}

type TimedSource = { source: PreferredEntitySource; setAt: string; label: string | null };

/**
 * Prefer the explicit arbitration stamp; else derive from per-source store timestamps.
 */
export function mostRecentEntitySource(
  metadata: Record<string, unknown> | null | undefined,
): EntityArbitrationRecord | null {
  const stamped = readEntityArbitration(metadata);
  const timed: TimedSource[] = [];

  const ghl = readGhlConversationState(metadata);
  if (ghl?.contact?.id) {
    timed.push({
      source: "ghl",
      setAt: ghl.opportunity?.setAt || ghl.contact.setAt || ghl.updatedAt,
      label: ghl.contact.displayName || null,
    });
  }

  const pem = readPemConversationState(metadata);
  if (pem.active?.activePemId) {
    // PEM active has no setAt — use arbitration stamp if present, else epoch-low so
    // an explicit newer ghl/slack stamp wins unless we just wrote arbitration.
    timed.push({
      source: "pem",
      setAt: stamped?.lastSource === "pem" ? stamped.setAt : "1970-01-01T00:00:00.000Z",
      label: pem.active.activeProspectName,
    });
  }

  const slack = readSlackConversationState(metadata);
  if (slack && (slack.refs.length > 0 || slack.projectName || slack.topic)) {
    timed.push({
      source: "slack",
      setAt: slack.updatedAt,
      label: slack.projectName || slack.topic || slack.people[0] || null,
    });
  }

  if (stamped) {
    // Stamp wins when it is at least as new as any derived store clock.
    const newerStore = timed.some((t) => t.setAt > stamped.setAt);
    if (!newerStore) return stamped;
  }

  if (timed.length === 0) return stamped;
  timed.sort((a, b) => b.setAt.localeCompare(a.setAt));
  const top = timed[0]!;
  return { lastSource: top.source, label: top.label, setAt: top.setAt };
}

/**
 * For ambiguous follow-ups, return the preferred source key to boost in canHandle().
 */
export function preferredSourceForFollowUp(input: {
  question: string;
  history: BaxterHistoryMessage[];
  conversationMetadata: Record<string, unknown>;
}): PreferredEntitySource | null {
  const ctx = decideConversationContext(input.question, input.history);
  if (!ctx.isFollowUp && !ctx.hasPronounReference && !ctx.inheritPriorEntities) {
    return null;
  }
  return mostRecentEntitySource(input.conversationMetadata)?.lastSource ?? null;
}

export function sourceKeyToPreferred(key: EvidenceSourceKey): PreferredEntitySource | null {
  if (key === "ghl") return "ghl";
  if (key === "pem_neat") return "pem";
  return null;
}
