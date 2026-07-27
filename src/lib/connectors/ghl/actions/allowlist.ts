import "server-only";

/**
 * Allowlist of contact fields that can be updated via Baxter.
 * These are standard GHL contact fields, not custom fields.
 */
export const ALLOWED_CONTACT_FIELDS = [
  "firstName",
  "lastName",
  "name",
  "email",
  "phone",
  "address1",
  "city",
  "state",
  "postalCode",
  "country",
  "companyName",
  "website",
  "source",
  "assignedTo",
  "dnd", // Do Not Disturb
] as const;

export type AllowedContactField = (typeof ALLOWED_CONTACT_FIELDS)[number];

/**
 * Allowlist of opportunity fields that can be updated via Baxter.
 */
export const ALLOWED_OPPORTUNITY_FIELDS = [
  "name",
  "monetaryValue",
  "status", // open, won, lost, abandoned
  "assignedTo",
  "pipelineStageId",
  "source",
] as const;

export type AllowedOpportunityField = (typeof ALLOWED_OPPORTUNITY_FIELDS)[number];

/**
 * Valid opportunity statuses.
 */
export const VALID_OPPORTUNITY_STATUSES = ["open", "won", "lost", "abandoned"] as const;

export type OpportunityStatus = (typeof VALID_OPPORTUNITY_STATUSES)[number];

/**
 * Check if a contact field is in the allowlist.
 */
export function isContactFieldAllowed(field: string): field is AllowedContactField {
  return ALLOWED_CONTACT_FIELDS.includes(field as AllowedContactField);
}

/**
 * Check if an opportunity field is in the allowlist.
 */
export function isOpportunityFieldAllowed(field: string): field is AllowedOpportunityField {
  return ALLOWED_OPPORTUNITY_FIELDS.includes(field as AllowedOpportunityField);
}

/**
 * Filter a set of proposed changes to only include allowed fields.
 * Returns the filtered changes and a list of rejected fields.
 */
export function filterContactChanges(changes: Record<string, unknown>): {
  allowed: Record<string, unknown>;
  rejected: string[];
} {
  const allowed: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(changes)) {
    if (isContactFieldAllowed(key)) {
      allowed[key] = value;
    } else {
      rejected.push(key);
    }
  }

  return { allowed, rejected };
}

/**
 * Filter opportunity changes to only include allowed fields.
 */
export function filterOpportunityChanges(changes: Record<string, unknown>): {
  allowed: Record<string, unknown>;
  rejected: string[];
} {
  const allowed: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(changes)) {
    if (isOpportunityFieldAllowed(key)) {
      // Validate status values
      if (key === "status" && typeof value === "string") {
        if (!VALID_OPPORTUNITY_STATUSES.includes(value as OpportunityStatus)) {
          rejected.push(`${key} (invalid value: ${value})`);
          continue;
        }
      }
      allowed[key] = value;
    } else {
      rejected.push(key);
    }
  }

  return { allowed, rejected };
}

/**
 * Validate that a stage ID is valid for a pipeline.
 * This should be called with cached pipeline data.
 */
export function isValidStageForPipeline(
  stageId: string,
  pipelineStages: Array<{ id: string; name: string }>,
): boolean {
  return pipelineStages.some((s) => s.id === stageId);
}

/**
 * Get description of allowed fields for user-facing messages.
 */
export function describeAllowedContactFields(): string {
  return ALLOWED_CONTACT_FIELDS.join(", ");
}

export function describeAllowedOpportunityFields(): string {
  return ALLOWED_OPPORTUNITY_FIELDS.join(", ");
}
