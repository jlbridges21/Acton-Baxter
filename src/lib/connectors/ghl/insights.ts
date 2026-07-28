import "server-only";

import {
  searchOpportunitiesPaginated,
  type OpportunitySearchOptions,
} from "./resources/opportunities";
import { listPipelines } from "./resources/pipelines";
import { listUsers } from "./resources/users";
import { getContactById } from "./resources/contacts";
import { listUpcomingEvents } from "./resources/calendars";
import { searchConversations } from "./resources/conversations";
import type { GhlOpportunity, GhlCalendarEvent, GhlConversation } from "./types";

export type StaleOpportunityRow = {
  opportunityId: string;
  opportunityName: string;
  contactId: string | null;
  contactName: string | null;
  pipelineName: string | null;
  stageName: string | null;
  ownerName: string | null;
  status: string;
  lastUpdated: string | null;
  daysStale: number;
};

/**
 * Read-only report: open opportunities not updated within `daysSinceUpdate`.
 * Threshold is caller-supplied — not Acton policy by itself.
 */
export async function getStaleOpportunities(input: {
  daysSinceUpdate: number;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: OpportunitySearchOptions["status"];
  maxItems?: number;
  maxPages?: number;
}): Promise<{
  rows: StaleOpportunityRow[];
  truncated: boolean;
  incomplete: boolean;
  incompleteReason: string | null;
  scannedCount: number;
  retrievedAt: string;
}> {
  const days = Math.max(1, input.daysSinceUpdate);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const retrievedAt = new Date().toISOString();

  const [page, pipelines, users] = await Promise.all([
    searchOpportunitiesPaginated({
      status: input.status ?? "open",
      pipelineId: input.pipelineId,
      pipelineStageId: input.pipelineStageId,
      maxItems: input.maxItems ?? 100,
      maxPages: input.maxPages ?? 4,
      limit: 50,
    }),
    listPipelines({ useCache: true }).catch(() => []),
    listUsers({ useCache: true }).catch(() => []),
  ]);

  const pipelineById = new Map(pipelines.map((p) => [p.id, p]));
  const userById = new Map(users.map((u) => [u.id, u]));

  const rows: StaleOpportunityRow[] = [];
  for (const opp of page.opportunities) {
    const updated = opp.dateUpdated ? new Date(opp.dateUpdated).getTime() : 0;
    if (!updated || updated > cutoff) continue;

    const pipeline = pipelineById.get(opp.pipelineId);
    const stage = pipeline?.stages.find((s) => s.id === opp.pipelineStageId);
    const owner = opp.assignedTo ? userById.get(opp.assignedTo) : null;
    let contactName: string | null = null;
    if (opp.contactId) {
      const contact = await getContactById(opp.contactId).catch(() => null);
      contactName =
        contact?.name || [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || null;
    }

    rows.push({
      opportunityId: opp.id,
      opportunityName: opp.name,
      contactId: opp.contactId || null,
      contactName,
      pipelineName: pipeline?.name ?? null,
      stageName: stage?.name ?? null,
      ownerName: owner?.name ?? owner?.email ?? null,
      status: opp.status,
      lastUpdated: opp.dateUpdated,
      daysStale: Math.floor((Date.now() - updated) / (24 * 60 * 60 * 1000)),
    });
  }

  rows.sort((a, b) => b.daysStale - a.daysStale);
  return {
    rows,
    truncated: page.truncated,
    incomplete: page.incomplete,
    incompleteReason: page.incompleteReason,
    scannedCount: page.opportunities.length,
    retrievedAt,
  };
}

export type UnownedOpportunityRow = {
  opportunityId: string;
  opportunityName: string;
  contactId: string | null;
  contactName: string | null;
  pipelineName: string | null;
  stageName: string | null;
  status: string;
  monetaryValue: number | null;
};

export async function getUnownedOpportunities(
  input: {
    status?: OpportunitySearchOptions["status"];
    pipelineId?: string;
    maxItems?: number;
    maxPages?: number;
  } = {},
): Promise<{
  rows: UnownedOpportunityRow[];
  truncated: boolean;
  incomplete: boolean;
  incompleteReason: string | null;
  scannedCount: number;
  retrievedAt: string;
}> {
  const retrievedAt = new Date().toISOString();
  const [page, pipelines] = await Promise.all([
    searchOpportunitiesPaginated({
      status: input.status ?? "open",
      pipelineId: input.pipelineId,
      maxItems: input.maxItems ?? 100,
      maxPages: input.maxPages ?? 4,
      limit: 50,
    }),
    listPipelines({ useCache: true }).catch(() => []),
  ]);

  const pipelineById = new Map(pipelines.map((p) => [p.id, p]));
  const rows: UnownedOpportunityRow[] = [];

  for (const opp of page.opportunities) {
    if (opp.assignedTo) continue;
    const pipeline = pipelineById.get(opp.pipelineId);
    const stage = pipeline?.stages.find((s) => s.id === opp.pipelineStageId);
    let contactName: string | null = null;
    if (opp.contactId) {
      const contact = await getContactById(opp.contactId).catch(() => null);
      contactName =
        contact?.name || [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || null;
    }
    rows.push({
      opportunityId: opp.id,
      opportunityName: opp.name,
      contactId: opp.contactId || null,
      contactName,
      pipelineName: pipeline?.name ?? null,
      stageName: stage?.name ?? null,
      status: opp.status,
      monetaryValue: opp.monetaryValue,
    });
  }

  return {
    rows,
    truncated: page.truncated,
    incomplete: page.incomplete,
    incompleteReason: page.incompleteReason,
    scannedCount: page.opportunities.length,
    retrievedAt,
  };
}

export async function getAppointmentsInRange(input: {
  daysAhead?: number;
  daysBack?: number;
}): Promise<{ events: GhlCalendarEvent[]; retrievedAt: string }> {
  const retrievedAt = new Date().toISOString();
  const daysAhead = input.daysAhead ?? 7;
  const events = await listUpcomingEvents(daysAhead, { limit: 100 });
  return { events, retrievedAt };
}

/**
 * Conversations with unreadCount > 0 when the API exposes it.
 */
export async function getUnreadConversations(limit = 50): Promise<{
  conversations: GhlConversation[];
  supported: boolean;
  retrievedAt: string;
}> {
  const retrievedAt = new Date().toISOString();
  const result = await searchConversations({ limit });
  const withUnread = result.conversations.filter((c) => (c.unreadCount ?? 0) > 0);
  // If every conversation has unreadCount 0 and we got results, field may still be valid
  const supported = result.conversations.some((c) => typeof c.unreadCount === "number");
  return { conversations: withUnread, supported, retrievedAt };
}

export function formatInsightTable(
  title: string,
  rows: Array<Record<string, string | number | null>>,
): string {
  if (!rows.length) return `${title}\n\nNo matching records.`;
  const lines = [title, ""];
  for (const row of rows.slice(0, 25)) {
    const parts = Object.entries(row)
      .filter(([, v]) => v !== null && v !== "")
      .map(([k, v]) => `${k}: ${v}`);
    lines.push(`• ${parts.join(" · ")}`);
  }
  if (rows.length > 25) lines.push(`…and ${rows.length - 25} more`);
  return lines.join("\n");
}

/** Helper for tests / typing */
export function isOpportunityUnowned(opp: GhlOpportunity): boolean {
  return !opp.assignedTo;
}
