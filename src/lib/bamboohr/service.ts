/**
 * Read-only BambooHR data service. Every function:
 *   - requests only the fields it needs (BambooHR's employee endpoints require explicit fields),
 *   - strips anything sensitive even if BambooHR returned it,
 *   - returns data wrapped with provenance (`Sourced<T>`) so callers can attribute it.
 * Authorization (who may see which employee) is enforced one level up, in access.ts.
 *
 * Endpoints (BambooHR API reference):
 *   GET /v1/company_information                     scope company:info
 *   GET /v1/employees?fields=&filter[..]&page[..]   scopes employee:name / employee:job …
 *   GET /v1/employees/{id}?fields=                  unknown/unauthorized fields silently dropped
 *   GET /v1/employees/directory                     scope employee_directory
 *   GET /v1/meta/fields                             scope field
 *   GET /v1/employees/{id}/files/view               scope employee:file (metadata only)
 *   GET /v1/employees/{id}/onboarding-experiences   scope onboarding
 */

import "server-only";

import { bambooGet } from "./client";
import { BambooError } from "./errors";
import { FIELD_LABELS, isSensitiveField, readableFieldIds, type FieldGroup } from "./fields";
import { provenance, type Provenance, type Sourced } from "./provenance";

const ID_RE = /^[0-9]{1,12}$/;
function assertId(id: string) {
  if (!ID_RE.test(id)) throw new BambooError("BambooHR employee ids are numbers.", "not_found");
}

function source(
  p: Omit<Provenance, "retrievedAt" | "lastConfirmedAt" | "sourceUrl" | "freshness">,
  lastConfirmedAt: string | null,
): Provenance {
  // No documented deep link exists for employee records, so sourceUrl stays null (never guessed).
  return provenance({ ...p, lastConfirmedAt });
}

function clean(record: Record<string, unknown>, allowed: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of allowed) {
    if (isSensitiveField(f) && !FIELD_LABELS[f]) continue;
    if (!(f in record)) continue;
    const v = record[f];
    out[f] =
      v === null || v === undefined || v === ""
        ? null
        : typeof v === "object"
          ? JSON.stringify(v).slice(0, 200)
          : String(v).slice(0, 500);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------
export type CompanyInfo = {
  legalName: string | null;
  displayName: string | null;
  domain: string | null;
  timezone: string | null;
};

export async function getCompanyInfo(): Promise<Sourced<CompanyInfo>> {
  const { body, connection } = await bambooGet<Record<string, unknown>>("/v1/company_information", {
    scopeHint: "company:info",
    what: "company information",
  });
  const s = (k: string) => (typeof body?.[k] === "string" ? (body[k] as string) : null);
  return {
    data: {
      legalName: s("legalName"),
      displayName: s("displayName"),
      domain: s("domain"),
      timezone: s("timezone"),
    },
    source: source(
      {
        provider: "bamboohr",
        entityType: "Company information",
        recordId: null,
        fieldIds: ["legalName", "displayName", "domain", "timezone"],
        classification: "company",
      },
      connection.last_success_at,
    ),
  };
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------
export type EmployeeSummary = {
  id: string;
  name: string;
  jobTitle: string | null;
  status: string | null;
  restricted: string[];
};

/** GET /v1/employees with cursor pagination. `nameFilter` uses BambooHR's case-insensitive substring filter. */
export async function listEmployees(
  opts: { nameFilter?: string; limit?: number; after?: string | null } = {},
): Promise<
  Sourced<{ employees: EmployeeSummary[]; total: number | null; nextCursor: string | null }>
> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 250);
  const q = [
    `fields=${encodeURIComponent("firstName,lastName,preferredName,jobTitleName,status")}`,
    `page[limit]=${limit}`,
    "sort=lastName,firstName",
  ];
  if (opts.after) q.push(`page[after]=${encodeURIComponent(opts.after)}`);
  const term = (opts.nameFilter ?? "").trim().slice(0, 60);
  if (term) q.push(`filter[lastName]=${encodeURIComponent(term)}`);
  type Page = {
    data?: Array<Record<string, unknown>>;
    meta?: { total?: number; page?: { nextCursor?: string | null } };
  };
  let { body, connection } = await bambooGet<Page>(`/v1/employees?${q.join("&")}`, {
    scopeHint: "employee:name",
    what: "the employee list",
  });
  let rows = body?.data ?? [];
  if (term && rows.length === 0) {
    // No last-name match: try first name (filters AND together, so it's a second request).
    const q2 = q
      .filter((x) => !x.startsWith("filter["))
      .concat(`filter[firstName]=${encodeURIComponent(term)}`);
    ({ body, connection } = await bambooGet<Page>(`/v1/employees?${q2.join("&")}`, {
      scopeHint: "employee:name",
      what: "the employee list",
    }));
    rows = body?.data ?? [];
  }
  const employees = rows
    .map((r) => {
      const first = String(r.preferredName || r.firstName || "").trim();
      return {
        id: String(r.employeeId ?? r.id ?? ""),
        name:
          [first, String(r.lastName ?? "").trim()].filter(Boolean).join(" ") || "(name restricted)",
        jobTitle: typeof r.jobTitleName === "string" ? r.jobTitleName : null,
        status: typeof r.status === "string" ? r.status : null,
        restricted: Array.isArray(r._restrictedFields)
          ? (r._restrictedFields as string[]).slice(0, 20)
          : [],
      };
    })
    .filter((e) => ID_RE.test(e.id));
  return {
    data: {
      employees,
      total: typeof body?.meta?.total === "number" ? body.meta.total : null,
      nextCursor: body?.meta?.page?.nextCursor ?? null,
    },
    source: source(
      {
        provider: "bamboohr",
        entityType: "Employee list",
        recordId: null,
        fieldIds: ["firstName", "lastName", "preferredName", "jobTitleName", "status"],
        classification: "employee_basic",
      },
      connection.last_success_at,
    ),
  };
}

export type EmployeeProfile = {
  id: string;
  fields: Record<string, string | null>;
  /** Requested but not returned: BambooHR silently drops unknown or unauthorized fields, so we can't tell which. */
  notReturned: string[];
};

/** GET /v1/employees/{id}?fields=… for an explicit, pre-authorized field list. */
export async function getEmployeeFields(
  id: string,
  groups: FieldGroup[],
  customAllowlist: string[] = [],
): Promise<Sourced<EmployeeProfile>> {
  assertId(id);
  const fields = readableFieldIds(groups, customAllowlist);
  const { body, connection } = await bambooGet<Record<string, unknown>>(
    `/v1/employees/${id}?fields=${encodeURIComponent(fields.join(","))}`,
    {
      scopeHint: groups.includes("job") ? "employee:job" : "employee:name",
      what: "this employee's record",
    },
  ).catch((error: unknown) => {
    if (error instanceof BambooError && error.reason === "missing_scope") {
      // BambooHR returns 403 "Insufficient Permissions to view this employee" at record level.
      throw new BambooError(
        "The employee record exists, but BambooHR's permissions for the connected account don't allow reading it.",
        "forbidden_employee",
      );
    }
    throw error;
  });
  const cleaned = clean(body ?? {}, fields);
  return {
    data: { id, fields: cleaned, notReturned: fields.filter((f) => !(f in (body ?? {}))) },
    source: source(
      {
        provider: "bamboohr",
        entityType: "Employee profile",
        recordId: id,
        fieldIds: Object.keys(cleaned),
        classification: groups.includes("contact")
          ? "employee_contact"
          : groups.includes("job")
            ? "employee_job"
            : "employee_basic",
      },
      connection.last_success_at,
    ),
  };
}

/** Look up employees whose work email matches exactly (for identity linking). */
export async function findByWorkEmail(email: string): Promise<string[]> {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(e)) return [];
  type Page = {
    data?: Array<Record<string, unknown>>;
    meta?: { page?: { nextCursor?: string | null } };
  };
  const match = (rows: Array<Record<string, unknown>>) =>
    rows
      .filter(
        (r) =>
          String(r.workEmail ?? "")
            .trim()
            .toLowerCase() === e,
      )
      .map((r) => String(r.employeeId ?? r.id))
      .filter((id) => ID_RE.test(id));
  try {
    const { body } = await bambooGet<Page>(
      `/v1/employees?fields=workEmail&filter[workEmail]=${encodeURIComponent(e)}&page[limit]=10`,
      { scopeHint: "employee:contact", what: "work emails" },
    );
    return match(body?.data ?? []);
  } catch (error) {
    // BambooHR doesn't document workEmail as filterable; fall back to paging the list (emails only).
    if (!(error instanceof BambooError) || !["unsupported", "not_found"].includes(error.reason))
      throw error;
  }
  const found: string[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const pageQuery: string = `/v1/employees?fields=workEmail&page[limit]=500${after ? `&page[after]=${encodeURIComponent(after)}` : ""}`;
    const { body }: { body: Page } = await bambooGet<Page>(pageQuery, {
      scopeHint: "employee:contact",
      what: "work emails",
    });
    found.push(...match(body?.data ?? []));
    after = body?.meta?.page?.nextCursor ?? null;
    if (!after) break;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Directory, fields, files, onboarding
// ---------------------------------------------------------------------------
export async function getDirectoryFieldNames(): Promise<
  Sourced<{ fields: Array<{ id: string; name: string }>; count: number }>
> {
  const { body, connection } = await bambooGet<{
    fields?: Array<{ id: string; name: string }>;
    employees?: unknown[];
  }>("/v1/employees/directory", {
    scopeHint: "employee_directory",
    what: "the employee directory",
  });
  return {
    data: {
      fields: (body?.fields ?? []).map((f) => ({ id: String(f.id), name: String(f.name) })),
      count: body?.employees?.length ?? 0,
    },
    source: source(
      {
        provider: "bamboohr",
        entityType: "Employee directory",
        recordId: null,
        fieldIds: [],
        classification: "employee_basic",
      },
      connection.last_success_at,
    ),
  };
}

let fieldCache: {
  at: number;
  domain: string;
  value: Array<{
    id: string;
    name: string;
    type: string;
    alias: string | null;
    custom: boolean;
    sensitive: boolean;
  }>;
} | null = null;
export function resetBambooFieldCacheForTests() {
  fieldCache = null;
}

/** GET /v1/meta/fields — names and types only (no employee data). Cached 1 hour. */
export async function listFieldMetadata(force = false): Promise<
  Sourced<
    Array<{
      id: string;
      name: string;
      type: string;
      alias: string | null;
      custom: boolean;
      sensitive: boolean;
    }>
  >
> {
  const { getConnection } = await import("./connection");
  const conn = await getConnection();
  if (
    !force &&
    fieldCache &&
    conn &&
    fieldCache.domain === conn.company_domain &&
    Date.now() - fieldCache.at < 3600_000
  ) {
    return {
      data: fieldCache.value,
      source: provenance({
        provider: "bamboohr",
        entityType: "Field list",
        recordId: null,
        fieldIds: [],
        classification: "company",
        freshness: "cached",
        retrievedAt: new Date(fieldCache.at).toISOString(),
        lastConfirmedAt: conn.last_success_at,
      }),
    };
  }
  const { body, connection } = await bambooGet<
    Array<{ id: string | number; name: string; type: string; alias?: string }>
  >("/v1/meta/fields", { scopeHint: "field", what: "the field list" });
  const value = (body ?? []).map((f) => {
    const id = String(f.id);
    return {
      id,
      name: String(f.name),
      type: String(f.type),
      alias: f.alias ?? null,
      custom: !f.alias || /^custom/i.test(f.alias),
      sensitive: isSensitiveField(`${f.name} ${f.alias ?? ""}`),
    };
  });
  fieldCache = { at: Date.now(), domain: connection.company_domain, value };
  return {
    data: value,
    source: source(
      {
        provider: "bamboohr",
        entityType: "Field list",
        recordId: null,
        fieldIds: [],
        classification: "company",
      },
      connection.last_success_at,
    ),
  };
}

export type FileMetadata = {
  categories: Array<{
    name: string;
    files: Array<{
      name: string;
      size: number | null;
      dateCreated: string | null;
      sharedWithEmployee: boolean;
    }>;
  }>;
};

export async function getEmployeeFileMetadata(id: string): Promise<Sourced<FileMetadata>> {
  assertId(id);
  const { body, connection } = await bambooGet<{
    categories?: Array<{ name?: string; files?: Array<Record<string, unknown>> }>;
  }>(`/v1/employees/${id}/files/view`, {
    scopeHint: "employee:file",
    what: "this employee's file list",
  });
  return {
    data: {
      categories: (body?.categories ?? []).map((c) => ({
        name: String(c.name ?? "Files"),
        files: (c.files ?? []).map((f) => ({
          name: String(f.name ?? f.originalFileName ?? "File").slice(0, 200),
          size: typeof f.size === "number" ? f.size : null,
          dateCreated: typeof f.dateCreated === "string" ? f.dateCreated : null,
          sharedWithEmployee: f.shareWithEmployee === true || f.shareWithEmployee === "yes",
        })),
      })),
    },
    source: source(
      {
        provider: "bamboohr",
        entityType: "Employee files (metadata)",
        recordId: id,
        fieldIds: [],
        classification: "employee_files",
      },
      connection.last_success_at,
    ),
  };
}

export type OnboardingStatus = { experiences: Array<{ id: string; status: string }> };

export async function getOnboardingStatus(id: string): Promise<Sourced<OnboardingStatus>> {
  assertId(id);
  const { body, connection } = await bambooGet<{
    onboardingExperiences?: Array<{ id?: number; status?: string }>;
  }>(`/v1/employees/${id}/onboarding-experiences`, {
    scopeHint: "onboarding",
    what: "onboarding records",
  });
  return {
    data: {
      experiences: (body?.onboardingExperiences ?? []).map((e) => ({
        id: String(e.id ?? ""),
        status: String(e.status ?? "unknown"),
      })),
    },
    source: source(
      {
        provider: "bamboohr",
        entityType: "Onboarding experience",
        recordId: id,
        fieldIds: ["status"],
        classification: "onboarding",
      },
      connection.last_success_at,
    ),
  };
}
