/**
 * Which BambooHR fields Baxter may read. Names are BambooHR API field names (documentation:
 * "List of Field Names"). Anything not listed here is never requested; custom fields need an
 * explicit allowlist chosen by the CEO or COO and must pass the sensitive-name check.
 * Shared by server and browser.
 */

export type FieldGroup = "basic" | "job" | "contact";

export const FIELD_GROUPS: Record<FieldGroup, Array<{ id: string; label: string }>> = {
  basic: [
    { id: "displayName", label: "Name" },
    { id: "firstName", label: "First name" },
    { id: "lastName", label: "Last name" },
    { id: "preferredName", label: "Preferred name" },
  ],
  job: [
    { id: "jobTitle", label: "Job title" },
    { id: "department", label: "Department" },
    { id: "division", label: "Division" },
    { id: "location", label: "Location" },
    { id: "supervisor", label: "Manager" },
    { id: "supervisorEId", label: "Manager's employee id" },
    { id: "hireDate", label: "Hire date" },
    { id: "status", label: "Status (active/inactive)" },
    { id: "employmentHistoryStatus", label: "Employment status" },
  ],
  contact: [
    { id: "workEmail", label: "Work email" },
    { id: "workPhone", label: "Work phone" },
    { id: "workPhoneExtension", label: "Work phone extension" },
  ],
};

export const STANDARD_FIELD_IDS = Object.values(FIELD_GROUPS).flatMap((g) => g.map((f) => f.id));
export const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(FIELD_GROUPS).flatMap((g) => g.map((f) => [f.id, f.label])),
);

/** Never read, even if a scope would allow it or someone allow-lists a matching custom field. */
export const SENSITIVE_FIELD =
  /(pay|salary|wage|rate|compensation|bonus|commission|ssn|\bsin\b|nin|ein|tax|bank|routing|account|passport|visa|national|birth|age$|gender|ethnic|race|marital|address|city|state|zip|country|home|personal|mobile|dependent|emergency|medical|health|vaccin|disab|veteran|religio|citizen|license|credit|password|termination)/i;

export function isSensitiveField(idOrName: string): boolean {
  return SENSITIVE_FIELD.test(idOrName);
}

/** Field ids a request may fetch: standard groups plus allow-listed, non-sensitive custom fields. */
export function readableFieldIds(groups: FieldGroup[], customAllowlist: string[] = []): string[] {
  const std = groups.flatMap((g) => FIELD_GROUPS[g].map((f) => f.id));
  const custom = customAllowlist.filter(
    (f) => /^[A-Za-z0-9_.]{1,80}$/.test(f) && !isSensitiveField(f),
  );
  return [...new Set([...std, ...custom])];
}
