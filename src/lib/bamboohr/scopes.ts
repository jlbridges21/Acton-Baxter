/**
 * BambooHR OAuth scopes Baxter may request. Names are taken verbatim from BambooHR's API
 * reference (security schemes on each endpoint) and the OpenID Connect page. Read-only only:
 * no `.write`, compensation, identification, protected-info, address, or dependent scopes.
 * Shared by the server and the connection UI.
 */

export type ScopeGroup = {
  key: string;
  label: string;
  scopes: string[];
  why: string;
  optional: boolean;
};

export const SCOPE_GROUPS: ScopeGroup[] = [
  {
    key: "identity",
    label: "Sign-in identity",
    scopes: ["openid", "email", "company_id"],
    why: "Identify who connected and which BambooHR company (OpenID Connect).",
    optional: false,
  },
  {
    key: "offline",
    label: "Stay connected",
    scopes: ["offline_access"],
    why: "Receive a refresh token so the connection keeps working without daily reconnects.",
    optional: false,
  },
  {
    key: "company",
    label: "Company information",
    scopes: ["company:info"],
    why: "GET /api/v1/company_information — company name and domain.",
    optional: false,
  },
  {
    key: "names",
    label: "Employee names",
    scopes: ["employee:name"],
    why: "GET /api/v1/employees — list and search employees by name.",
    optional: false,
  },
  {
    key: "job",
    label: "Job information",
    scopes: ["employee:job"],
    why: "Job title, department, division, location, manager, hire date.",
    optional: false,
  },
  {
    key: "contact",
    label: "Work contact",
    scopes: ["employee:contact"],
    why: "Work email and phone — needed to link BambooHR employees to Baxter accounts.",
    optional: false,
  },
  {
    key: "directory",
    label: "Employee directory",
    scopes: ["employee_directory"],
    why: "GET /api/v1/employees/directory (if the directory is shared).",
    optional: false,
  },
  {
    key: "fields",
    label: "Field list",
    scopes: ["field"],
    why: "GET /api/v1/meta/fields — discover standard and custom field names.",
    optional: false,
  },
  {
    key: "custom",
    label: "Custom fields",
    scopes: ["employee:custom_fields"],
    why: "Read custom fields that leadership has allow-listed.",
    optional: true,
  },
  {
    key: "files",
    label: "Employee file list",
    scopes: ["employee:file"],
    why: "GET /api/v1/employees/{id}/files/view — file names and categories only (no downloads).",
    optional: true,
  },
  {
    key: "onboarding",
    label: "Onboarding status",
    scopes: ["onboarding"],
    why: "GET /api/v1/employees/{id}/onboarding-experiences — read-only status.",
    optional: true,
  },
];

export const DEFAULT_SCOPE_GROUPS = SCOPE_GROUPS.filter((g) => !g.optional).map((g) => g.key);

/** Scopes Baxter must never request in this phase. */
export const FORBIDDEN_SCOPE =
  /(\.write$|compensation|identification|protected_info|sensitive_employee|dependent|demographic|vaccination|creditcards|encrypted|management)/;

export function scopesFor(groupKeys: string[]): string[] {
  const keys = new Set([...DEFAULT_SCOPE_GROUPS, ...groupKeys]);
  return [...new Set(SCOPE_GROUPS.filter((g) => keys.has(g.key)).flatMap((g) => g.scopes))].filter(
    (s) => !FORBIDDEN_SCOPE.test(s),
  );
}

/** Requested scopes not present in the granted list. */
export function missingScopes(requested: string[], granted: string[]): string[] {
  const g = new Set(granted);
  return requested.filter((s) => !g.has(s));
}
