import "server-only";

import { ghlGet } from "../client";
import {
  ghlOpportunitiesSearchResponseSchema,
  ghlOpportunitySchema,
  type GhlOpportunity,
} from "../types";
import { normalizeOpportunity } from "../normalize";
import { requireGhlLocationId } from "../config";
import { buildOpportunitySearchQuery } from "../request-contracts";
import { parseGhlPageMeta, paginateGhl } from "../pagination";

export type OpportunitySearchOptions = {
  q?: string;
  pipelineId?: string;
  /** Prefer pipelineStageId (v3). stageId kept as alias. */
  pipelineStageId?: string;
  stageId?: string;
  status?: "open" | "won" | "lost" | "abandoned" | "all";
  contactId?: string;
  assignedTo?: string;
  id?: string;
  limit?: number;
  page?: number;
  startAfter?: string | number;
  startAfterId?: string;
};

export type OpportunitySearchResult = {
  opportunities: GhlOpportunity[];
  total: number | null;
  hasMore: boolean;
  nextPageUrl: string | null;
  startAfterId: string | null;
  startAfter: string | number | null;
};

/**
 * Search opportunities using current HighLevel contract:
 * GET /opportunities/search
 * Version: v3
 * Required: locationId (camelCase)
 * Filters: pipelineId, pipelineStageId, contactId, assignedTo, status, …
 *
 * Do NOT send location_id / pipeline_id / stage_id.
 */
export async function searchOpportunities(
  options: OpportunitySearchOptions = {},
): Promise<OpportunitySearchResult> {
  const locationId = requireGhlLocationId();

  const query = buildOpportunitySearchQuery({
    locationId,
    q: options.q,
    status: options.status,
    pipelineId: options.pipelineId,
    pipelineStageId: options.pipelineStageId ?? options.stageId,
    contactId: options.contactId,
    assignedTo: options.assignedTo,
    id: options.id,
    limit: options.limit ? Math.min(options.limit, 100) : undefined,
    page: options.page,
    startAfter: options.startAfter,
    startAfterId: options.startAfterId,
  });

  const response = await ghlGet("/opportunities/search", query, {
    resource: "opportunities",
    injectLocationId: false, // already in validated query
    locationIdParam: "locationId",
  });
  const parsed = ghlOpportunitiesSearchResponseSchema.safeParse(response);

  if (!parsed.success) {
    console.warn("[GHL Opportunities] Response validation warning:", parsed.error.message);
    const raw = response as {
      opportunities?: unknown[];
      meta?: Record<string, unknown>;
    };
    const meta = parseGhlPageMeta(raw.meta);
    return {
      opportunities: Array.isArray(raw.opportunities)
        ? (raw.opportunities as Record<string, unknown>[]).map(normalizeOpportunity)
        : [],
      total: meta.total,
      hasMore: meta.hasMore,
      nextPageUrl: meta.nextPageUrl,
      startAfterId: meta.startAfterId,
      startAfter: meta.startAfter,
    };
  }

  const meta = parseGhlPageMeta(parsed.data.meta);
  return {
    opportunities: parsed.data.opportunities.map((o) =>
      normalizeOpportunity(o as Record<string, unknown>),
    ),
    total: meta.total,
    hasMore: meta.hasMore,
    nextPageUrl: meta.nextPageUrl,
    startAfterId: meta.startAfterId,
    startAfter: meta.startAfter,
  };
}

/**
 * Search across multiple pages (bounded). Use for admin/insights — not for every chat turn.
 */
export async function searchOpportunitiesPaginated(
  options: OpportunitySearchOptions & { maxPages?: number; maxItems?: number } = {},
): Promise<{
  opportunities: GhlOpportunity[];
  total: number | null;
  truncated: boolean;
  incomplete: boolean;
  incompleteReason: string | null;
  pagesFetched: number;
}> {
  const result = await paginateGhl<GhlOpportunity>({
    maxPages: options.maxPages ?? 5,
    maxItems: options.maxItems ?? 200,
    fetchPage: async ({ page, startAfterId, startAfter }) => {
      const pageResult = await searchOpportunities({
        ...options,
        page,
        startAfterId: startAfterId ?? undefined,
        startAfter: startAfter ?? undefined,
        limit: options.limit ?? 50,
      });
      return {
        items: pageResult.opportunities,
        meta: {
          total: pageResult.total,
          hasMore: pageResult.hasMore,
          nextPageUrl: pageResult.nextPageUrl,
          startAfterId: pageResult.startAfterId,
          startAfter: pageResult.startAfter,
          currentPage: page,
          nextPage: pageResult.hasMore ? page + 1 : null,
        },
      };
    },
  });

  return {
    opportunities: result.items,
    total: result.total,
    truncated: result.truncated,
    incomplete: result.incomplete,
    incompleteReason: result.incompleteReason,
    pagesFetched: result.pagesFetched,
  };
}

export async function getOpportunityById(opportunityId: string): Promise<GhlOpportunity | null> {
  try {
    const response = await ghlGet(`/opportunities/${opportunityId}`, undefined, {
      resource: "opportunities",
      injectLocationId: false,
    });
    const data = response as { opportunity?: unknown };
    const opportunity = data.opportunity ?? response;

    const parsed = ghlOpportunitySchema.safeParse(opportunity);
    if (!parsed.success) {
      console.warn("[GHL Opportunities] Validation warning:", parsed.error.message);
      return normalizeOpportunity(opportunity as Record<string, unknown>);
    }

    return normalizeOpportunity(parsed.data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function listOpportunitiesByContact(
  contactId: string,
  options: { limit?: number } = {},
): Promise<GhlOpportunity[]> {
  const result = await searchOpportunities({
    contactId,
    limit: options.limit ?? 50,
  });
  return result.opportunities;
}

export async function listOpportunitiesByPipeline(
  pipelineId: string,
  options: {
    stageId?: string;
    pipelineStageId?: string;
    status?: "open" | "won" | "lost" | "abandoned" | "all";
    limit?: number;
  } = {},
): Promise<GhlOpportunity[]> {
  const result = await searchOpportunities({
    pipelineId,
    pipelineStageId: options.pipelineStageId ?? options.stageId,
    status: options.status,
    limit: options.limit ?? 100,
  });
  return result.opportunities;
}

export async function listOpenOpportunities(limit = 50): Promise<GhlOpportunity[]> {
  const result = await searchOpportunities({ status: "open", limit });
  return result.opportunities;
}

export async function getOpportunityCount(
  options: {
    pipelineId?: string;
    status?: "open" | "won" | "lost" | "abandoned" | "all";
  } = {},
): Promise<number> {
  const result = await searchOpportunities({
    pipelineId: options.pipelineId,
    status: options.status,
    limit: 1,
  });
  return result.total ?? result.opportunities.length;
}
