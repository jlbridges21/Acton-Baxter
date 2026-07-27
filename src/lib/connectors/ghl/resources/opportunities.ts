import "server-only";

import { ghlGet } from "../client";
import {
  ghlOpportunitiesSearchResponseSchema,
  ghlOpportunitySchema,
  type GhlOpportunity,
} from "../types";
import { normalizeOpportunity } from "../normalize";
import { requireGhlLocationId } from "../config";

export type OpportunitySearchOptions = {
  pipelineId?: string;
  stageId?: string;
  status?: "open" | "won" | "lost" | "abandoned" | "all";
  contactId?: string;
  assignedTo?: string;
  limit?: number;
  startAfter?: string;
};

export type OpportunitySearchResult = {
  opportunities: GhlOpportunity[];
  total: number | null;
  hasMore: boolean;
  nextPageUrl: string | null;
};

export async function searchOpportunities(
  options: OpportunitySearchOptions = {},
): Promise<OpportunitySearchResult> {
  const locationId = requireGhlLocationId();

  const query: Record<string, string | number | boolean | undefined> = {
    location_id: locationId,
  };

  if (options.pipelineId) {
    query.pipeline_id = options.pipelineId;
  }
  if (options.stageId) {
    query.stage_id = options.stageId;
  }
  if (options.status && options.status !== "all") {
    query.status = options.status;
  }
  if (options.contactId) {
    query.contact_id = options.contactId;
  }
  if (options.assignedTo) {
    query.assigned_to = options.assignedTo;
  }
  if (options.limit) {
    query.limit = Math.min(options.limit, 100);
  }
  if (options.startAfter) {
    query.startAfter = options.startAfter;
  }

  const response = await ghlGet("/opportunities/search", query, { injectLocationId: false });
  const parsed = ghlOpportunitiesSearchResponseSchema.safeParse(response);

  if (!parsed.success) {
    console.warn("[GHL Opportunities] Response validation warning:", parsed.error.message);
    const raw = response as {
      opportunities?: unknown[];
      meta?: { total?: number; nextPageUrl?: string | null };
    };
    return {
      opportunities: Array.isArray(raw.opportunities)
        ? (raw.opportunities as Record<string, unknown>[]).map(normalizeOpportunity)
        : [],
      total: raw.meta?.total ?? null,
      hasMore: Boolean(raw.meta?.nextPageUrl),
      nextPageUrl: raw.meta?.nextPageUrl ?? null,
    };
  }

  return {
    opportunities: parsed.data.opportunities.map((o) =>
      normalizeOpportunity(o as Record<string, unknown>),
    ),
    total: parsed.data.meta?.total ?? null,
    hasMore: Boolean(parsed.data.meta?.nextPageUrl),
    nextPageUrl: parsed.data.meta?.nextPageUrl ?? null,
  };
}

export async function getOpportunityById(opportunityId: string): Promise<GhlOpportunity | null> {
  try {
    const response = await ghlGet(`/opportunities/${opportunityId}`, undefined, {
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
    status?: "open" | "won" | "lost" | "abandoned" | "all";
    limit?: number;
  } = {},
): Promise<GhlOpportunity[]> {
  const result = await searchOpportunities({
    pipelineId,
    stageId: options.stageId,
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
