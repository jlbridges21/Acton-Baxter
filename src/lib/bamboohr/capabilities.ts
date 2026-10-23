/**
 * Capability diagnostics: a capability is reported working only when a safe, read-only request
 * actually succeeds. Results (statuses only — never employee data) are stored on the connection.
 */

import "server-only";

import { recordAudit } from "@/lib/agents/audit";
import { agentDb, eq } from "@/lib/agents/store";
import type { BambooAccess } from "./access";
import { getConnection } from "./connection";
import { BambooError } from "./errors";
import { missingScopes } from "./scopes";
import * as svc from "./service";
import { PLANNED_WRITES } from "./writes";

export type CapabilityStatus =
  | "working"
  | "no_permission"
  | "scope_not_granted"
  | "no_data"
  | "unsupported"
  | "error"
  | "disabled";
export type Capability = {
  key: string;
  label: string;
  endpoint: string;
  scope: string | null;
  status: CapabilityStatus;
  detail: string;
};

export const CAPABILITY_STATUS_LABELS: Record<CapabilityStatus, string> = {
  working: "Working",
  no_permission: "No permission",
  scope_not_granted: "Scope not granted",
  no_data: "No data",
  unsupported: "No public API",
  error: "Error",
  disabled: "Disabled by design",
};

async function probe(
  key: string,
  label: string,
  endpoint: string,
  scope: string | null,
  granted: string[],
  run: () => Promise<string>,
): Promise<Capability> {
  if (scope && !granted.includes(scope))
    return {
      key,
      label,
      endpoint,
      scope,
      status: "scope_not_granted",
      detail: `The "${scope}" scope wasn't granted. Reconnect and approve it if this is needed.`,
    };
  try {
    return { key, label, endpoint, scope, status: "working", detail: await run() };
  } catch (error) {
    if (error instanceof BambooError) {
      const status: CapabilityStatus =
        error.reason === "missing_scope" || error.reason === "forbidden_employee"
          ? "no_permission"
          : error.reason === "not_found"
            ? "no_data"
            : "error";
      return { key, label, endpoint, scope, status, detail: error.message };
    }
    return {
      key,
      label,
      endpoint,
      scope,
      status: "error",
      detail: "The check failed unexpectedly.",
    };
  }
}

export async function runDiagnostics(
  access: BambooAccess,
): Promise<{ capabilities: Capability[]; missingScopes: string[] }> {
  if (!access.canManageConnection && !access.canViewAll)
    throw new BambooError(
      "Only the COO, CEO, or HR administrators can run BambooHR diagnostics.",
      "not_authorized",
    );
  const conn = await getConnection();
  if (!conn || conn.status === "disconnected")
    throw new BambooError("BambooHR isn't connected.", "not_connected");
  const granted = conn.granted_scopes;
  let sampleId: string | null = null;
  const caps: Capability[] = [];
  caps.push(
    await probe(
      "company",
      "Company information",
      "GET /v1/company_information",
      "company:info",
      granted,
      async () => {
        const c = await svc.getCompanyInfo();
        await agentDb().update("bamboohr_connections", [eq("id", conn.id)], {
          company_name: c.data.displayName ?? c.data.legalName,
        });
        return `Connected to ${c.data.displayName ?? c.data.legalName ?? conn.company_domain}.`;
      },
    ),
  );
  caps.push(
    await probe(
      "employee_list",
      "List employees",
      "GET /v1/employees",
      "employee:name",
      granted,
      async () => {
        const l = await svc.listEmployees({ limit: 1 });
        sampleId = l.data.employees[0]?.id ?? null;
        return l.data.total !== null
          ? `${l.data.total} employee record(s) visible.`
          : "Employee list readable.";
      },
    ),
  );
  const fieldProbe = (
    key: string,
    label: string,
    scope: string,
    group: "job" | "contact",
    fields: string[],
  ) =>
    probe(
      key,
      label,
      `GET /v1/employees/{id}?fields=${fields.join(",")}`,
      scope,
      granted,
      async () => {
        if (!sampleId) throw new BambooError("No employee was visible to test with.", "not_found");
        const p = await svc.getEmployeeFields(sampleId, [group]);
        const got = fields.filter((f) => f in p.data.fields);
        if (!got.length)
          throw new BambooError(
            `BambooHR returned none of ${fields.join(", ")} (they may be restricted or empty).`,
            "missing_scope",
          );
        return `Readable: ${got.join(", ")}.`;
      },
    );
  caps.push(
    await fieldProbe("employee_job", "Job information", "employee:job", "job", [
      "jobTitle",
      "department",
      "supervisor",
      "hireDate",
    ]),
  );
  caps.push(
    await fieldProbe("employee_contact", "Work contact", "employee:contact", "contact", [
      "workEmail",
      "workPhone",
    ]),
  );
  caps.push(
    await probe(
      "directory",
      "Employee directory",
      "GET /v1/employees/directory",
      "employee_directory",
      granted,
      async () => {
        const d = await svc.getDirectoryFieldNames();
        return `${d.data.count} directory entries; fields: ${d.data.fields
          .map((f) => f.id)
          .slice(0, 12)
          .join(", ")}.`;
      },
    ),
  );
  caps.push(
    await probe(
      "fields",
      "Field list (incl. custom fields)",
      "GET /v1/meta/fields",
      "field",
      granted,
      async () => {
        const f = await svc.listFieldMetadata(true);
        return `${f.data.length} fields, ${f.data.filter((x) => x.custom).length} custom, ${f.data.filter((x) => x.sensitive).length} treated as sensitive (never read).`;
      },
    ),
  );
  caps.push(
    await probe(
      "files",
      "Employee file list",
      "GET /v1/employees/{id}/files/view",
      "employee:file",
      granted,
      async () => {
        if (!sampleId) throw new BambooError("No employee was visible to test with.", "not_found");
        const f = await svc.getEmployeeFileMetadata(sampleId);
        return `${f.data.categories.length} file categor${f.data.categories.length === 1 ? "y" : "ies"} visible (metadata only).`;
      },
    ),
  );
  caps.push(
    await probe(
      "onboarding",
      "Onboarding status",
      "GET /v1/employees/{id}/onboarding-experiences",
      "onboarding",
      granted,
      async () => {
        if (!sampleId) throw new BambooError("No employee was visible to test with.", "not_found");
        const o = await svc.getOnboardingStatus(sampleId);
        return o.data.experiences.length
          ? `${o.data.experiences.length} onboarding experience(s) on the test record.`
          : "Readable; the test record has no onboarding experiences (BambooHR shows them only when the onboarding workflow feature is on).";
      },
    ),
  );
  caps.push({
    key: "surveys",
    label: "Surveys / employee satisfaction",
    endpoint: "—",
    scope: null,
    status: "unsupported",
    detail:
      "BambooHR's public API reference documents no endpoints to create, send, or read surveys or eNPS results.",
  });
  for (const w of PLANNED_WRITES)
    caps.push({
      key: `write_${w.key}`,
      label: w.label,
      endpoint: "—",
      scope: w.scope,
      status: "disabled",
      detail: "Writes are turned off until approved onboarding SOPs define them.",
    });
  const missing = missingScopes(conn.requested_scopes, granted);
  await agentDb().update("bamboohr_connections", [eq("id", conn.id)], {
    capabilities: { list: caps, missingScopes: missing },
    capabilities_checked_at: new Date().toISOString(),
  });
  await recordAudit({
    actor: { userId: access.userId, label: access.label },
    action: "bamboohr.diagnostics",
    targetType: "ops_integration",
    targetId: null,
    summary: `BambooHR diagnostics: ${caps.filter((c) => c.status === "working").length} working, ${caps.filter((c) => c.status === "no_permission" || c.status === "scope_not_granted").length} missing permission.`,
  });
  return { capabilities: caps, missingScopes: missing };
}
