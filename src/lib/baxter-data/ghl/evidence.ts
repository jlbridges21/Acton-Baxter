import "server-only";

import type { GhlEvidenceSource } from "@/lib/connectors/ghl/types";

export function createGhlEvidenceSource(input: {
  resourceType: string;
  resourceId: string;
  resourceName?: string | null;
  summary?: string | null;
}): GhlEvidenceSource {
  return {
    type: "gohighlevel",
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    resourceName: input.resourceName ?? null,
    url: null,
    retrievedAt: new Date().toISOString(),
    summary: input.summary ?? null,
  };
}

export function createContactEvidenceSource(
  contactId: string,
  contactName?: string | null,
  summary?: string | null,
): GhlEvidenceSource {
  return createGhlEvidenceSource({
    resourceType: "contact",
    resourceId: contactId,
    resourceName: contactName,
    summary,
  });
}

export function createOpportunityEvidenceSource(
  opportunityId: string,
  opportunityName?: string | null,
  summary?: string | null,
): GhlEvidenceSource {
  return createGhlEvidenceSource({
    resourceType: "opportunity",
    resourceId: opportunityId,
    resourceName: opportunityName,
    summary,
  });
}

export function createPipelineEvidenceSource(
  pipelineId: string,
  pipelineName?: string | null,
  summary?: string | null,
): GhlEvidenceSource {
  return createGhlEvidenceSource({
    resourceType: "pipeline",
    resourceId: pipelineId,
    resourceName: pipelineName,
    summary,
  });
}

export function createConversationEvidenceSource(
  conversationId: string,
  summary?: string | null,
): GhlEvidenceSource {
  return createGhlEvidenceSource({
    resourceType: "conversation",
    resourceId: conversationId,
    resourceName: null,
    summary,
  });
}

export function createCalendarEventEvidenceSource(
  eventId: string,
  eventTitle?: string | null,
  summary?: string | null,
): GhlEvidenceSource {
  return createGhlEvidenceSource({
    resourceType: "calendar_event",
    resourceId: eventId,
    resourceName: eventTitle,
    summary,
  });
}

export function createUserEvidenceSource(
  userId: string,
  userName?: string | null,
  summary?: string | null,
): GhlEvidenceSource {
  return createGhlEvidenceSource({
    resourceType: "user",
    resourceId: userId,
    resourceName: userName,
    summary,
  });
}

export function mergeEvidenceSources(...sourceArrays: GhlEvidenceSource[][]): GhlEvidenceSource[] {
  const seen = new Set<string>();
  const merged: GhlEvidenceSource[] = [];

  for (const sources of sourceArrays) {
    for (const source of sources) {
      const key = `${source.resourceType}:${source.resourceId}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(source);
      }
    }
  }

  return merged;
}

export function formatEvidenceSourceForBaxter(source: GhlEvidenceSource): string {
  const parts: string[] = [`GoHighLevel ${source.resourceType}`];

  if (source.resourceName) {
    parts.push(`"${source.resourceName}"`);
  }

  if (source.resourceId) {
    parts.push(`(ID: ${source.resourceId.slice(0, 12)}...)`);
  }

  if (source.summary) {
    parts.push(`- ${source.summary}`);
  }

  return parts.join(" ");
}

export function formatEvidenceSourcesForBaxter(sources: GhlEvidenceSource[]): string[] {
  return sources.map(formatEvidenceSourceForBaxter);
}
