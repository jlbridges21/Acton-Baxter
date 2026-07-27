import { z } from "zod";

/**
 * Request contract validation for HighLevel API calls (Prompt 3).
 *
 * Opportunity search (v3): locationId required; camelCase filter names.
 * Do NOT send location_id, pipeline_id, stage_id, contact_id, assigned_to.
 */

const nonEmptyString = z.string().trim().min(1);

export const opportunitySearchQuerySchema = z
  .object({
    locationId: nonEmptyString,
    q: z.string().trim().max(75).optional(),
    status: z.enum(["open", "won", "lost", "abandoned", "all"]).optional(),
    pipelineId: nonEmptyString.optional(),
    pipelineStageId: nonEmptyString.optional(),
    contactId: nonEmptyString.optional(),
    assignedTo: nonEmptyString.optional(),
    campaignId: nonEmptyString.optional(),
    id: nonEmptyString.optional(),
    order: nonEmptyString.optional(),
    date: nonEmptyString.optional(),
    endDate: nonEmptyString.optional(),
    startAfter: z.union([nonEmptyString, z.number()]).optional(),
    startAfterId: nonEmptyString.optional(),
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(100).optional(),
    country: nonEmptyString.optional(),
    getTasks: z.boolean().optional(),
    getNotes: z.boolean().optional(),
    getCalendarEvents: z.boolean().optional(),
  })
  .strict();

export type OpportunitySearchQuery = z.infer<typeof opportunitySearchQuerySchema>;

/** Deprecated snake_case names that must never appear on opportunity search. */
export const DEPRECATED_OPPORTUNITY_SEARCH_PARAMS = [
  "location_id",
  "pipeline_id",
  "pipeline_stage_id",
  "stage_id",
  "contact_id",
  "assigned_to",
] as const;

export function assertNoDeprecatedOpportunityParams(params: Record<string, unknown>): void {
  for (const key of DEPRECATED_OPPORTUNITY_SEARCH_PARAMS) {
    if (key in params && params[key] !== undefined && params[key] !== null) {
      throw new Error(
        `Deprecated opportunity search param "${key}" is not allowed. Use camelCase (e.g. locationId).`,
      );
    }
  }
  if ("locationId" in params && "location_id" in params) {
    throw new Error("Do not send both locationId and location_id");
  }
}

/**
 * Build a validated opportunity search query. Omits empty/undefined values.
 */
export function buildOpportunitySearchQuery(input: {
  locationId: string;
  q?: string;
  status?: "open" | "won" | "lost" | "abandoned" | "all";
  pipelineId?: string;
  pipelineStageId?: string;
  contactId?: string;
  assignedTo?: string;
  campaignId?: string;
  id?: string;
  order?: string;
  date?: string;
  endDate?: string;
  startAfter?: string | number;
  startAfterId?: string;
  page?: number;
  limit?: number;
  country?: string;
  getTasks?: boolean;
  getNotes?: boolean;
  getCalendarEvents?: boolean;
}): OpportunitySearchQuery {
  const raw: Record<string, unknown> = { locationId: input.locationId };
  const optionalKeys = [
    "q",
    "status",
    "pipelineId",
    "pipelineStageId",
    "contactId",
    "assignedTo",
    "campaignId",
    "id",
    "order",
    "date",
    "endDate",
    "startAfter",
    "startAfterId",
    "page",
    "limit",
    "country",
    "getTasks",
    "getNotes",
    "getCalendarEvents",
  ] as const;

  for (const key of optionalKeys) {
    const value = input[key];
    if (value === undefined || value === null || value === "") continue;
    raw[key] = value;
  }

  assertNoDeprecatedOpportunityParams(raw);
  return opportunitySearchQuerySchema.parse(raw);
}

export function toQueryRecord(
  params: Record<string, string | number | boolean | undefined | null>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return out;
}

export const contactSearchBodySchema = z
  .object({
    locationId: nonEmptyString,
    query: z.string().trim().optional(),
    email: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    page: z.number().int().positive().optional(),
    pageLimit: z.number().int().positive().max(100).optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .passthrough();

export function buildContactSearchBody(input: {
  locationId: string;
  query?: string;
  email?: string;
  phone?: string;
  page?: number;
  limit?: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = { locationId: input.locationId };
  if (input.query?.trim()) body.query = input.query.trim();
  if (input.email?.trim()) body.email = input.email.trim();
  if (input.phone?.trim()) body.phone = input.phone.trim();
  if (input.page && input.page > 0) body.page = input.page;
  if (input.limit && input.limit > 0) {
    body.pageLimit = Math.min(input.limit, 100);
  }
  return contactSearchBodySchema.parse(body);
}
