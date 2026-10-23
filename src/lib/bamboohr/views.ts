/**
 * Authorized, attributed views of BambooHR data — the only entry points the UI and Sam use.
 * Each section is fetched only if the requester may see it, and carries its own provenance.
 */

import "server-only";

import { auditRead, authorizeEmployee, requireViewAll, type BambooAccess } from "./access";
import { getConnection } from "./connection";
import { BambooError } from "./errors";
import { FIELD_GROUPS, FIELD_LABELS } from "./fields";
import { provenance, type Provenance, type Sourced } from "./provenance";
import * as svc from "./service";

export type SectionResult<T> = Sourced<T> | { data: null; source: Provenance; problem: string };

function unavailable(
  entityType: string,
  recordId: string | null,
  problem: string,
  classification: Provenance["classification"],
): { data: null; source: Provenance; problem: string } {
  return {
    data: null,
    source: provenance({
      provider: "bamboohr",
      entityType,
      recordId,
      fieldIds: [],
      classification,
      freshness: "unavailable",
    }),
    problem,
  };
}

async function section<T>(
  entityType: string,
  recordId: string | null,
  classification: Provenance["classification"],
  run: () => Promise<Sourced<T>>,
): Promise<SectionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof BambooError &&
      ["missing_scope", "forbidden_employee", "not_found", "unsupported"].includes(error.reason)
    ) {
      return unavailable(entityType, recordId, error.message, classification);
    }
    throw error;
  }
}

export type EmployeeView = {
  employeeId: string;
  self: boolean;
  profile: Sourced<{
    groups: Array<{
      key: string;
      label: string;
      fields: Array<{ id: string; label: string; value: string | null }>;
    }>;
    notReturned: string[];
  }>;
  onboarding: SectionResult<svc.OnboardingStatus> | null;
  files: SectionResult<svc.FileMetadata> | null;
};

/** One employee, filtered to what this requester may see. */
export async function employeeView(
  access: BambooAccess,
  employeeId: string,
  opts: { include?: Array<"onboarding" | "files">; channel?: "web" | "sam" } = {},
): Promise<EmployeeView> {
  const allowed = await authorizeEmployee(access, employeeId);
  const conn = await getConnection();
  const granted = conn?.granted_scopes ?? [];
  const p = await svc.getEmployeeFields(employeeId, allowed.groups, allowed.custom);
  const groupDefs = [
    ...allowed.groups.map((g) => ({
      key: g,
      label: g === "basic" ? "Name" : g === "job" ? "Job" : "Work contact",
      ids: FIELD_GROUPS[g].map((f) => f.id),
    })),
    ...(allowed.custom.length
      ? [{ key: "custom", label: "Custom fields", ids: allowed.custom }]
      : []),
  ];
  const profile = {
    data: {
      groups: groupDefs
        .map((g) => ({
          key: g.key,
          label: g.label,
          fields: g.ids
            .filter((id) => id in p.data.fields)
            .map((id) => ({ id, label: FIELD_LABELS[id] ?? id, value: p.data.fields[id] ?? null })),
        }))
        .filter((g) => g.fields.length),
      notReturned: p.data.notReturned,
    },
    source: p.source,
  };
  const want = new Set(opts.include ?? []);
  const onboarding =
    want.has("onboarding") && access.canViewAll
      ? granted.includes("onboarding")
        ? await section("Onboarding experience", employeeId, "onboarding", () =>
            svc.getOnboardingStatus(employeeId),
          )
        : unavailable(
            "Onboarding experience",
            employeeId,
            'The "onboarding" scope wasn\'t granted to the Baxter app.',
            "onboarding",
          )
      : null;
  const files =
    want.has("files") && access.canViewAll
      ? granted.includes("employee:file")
        ? await section("Employee files (metadata)", employeeId, "employee_files", () =>
            svc.getEmployeeFileMetadata(employeeId),
          )
        : unavailable(
            "Employee files (metadata)",
            employeeId,
            'The "employee:file" scope wasn\'t granted to the Baxter app.',
            "employee_files",
          )
      : null;
  await auditRead(
    access,
    employeeId,
    ["profile", ...(onboarding ? ["onboarding status"] : []), ...(files ? ["file list"] : [])].join(
      ", ",
    ),
    opts.channel ?? "web",
  );
  return { employeeId, self: allowed.self, profile, onboarding, files };
}

/** Search (HR and leadership only). Employees see only themselves. */
export async function searchEmployees(
  access: BambooAccess,
  query: string,
  after: string | null = null,
) {
  requireViewAll(access, "search BambooHR employees");
  const result = await svc.listEmployees({ nameFilter: query, limit: 50, after });
  await auditRead(access, null, `employee search${query ? ` "${query.slice(0, 40)}"` : ""}`, "web");
  return result;
}
