/**
 * BambooHR employees — live, read-only, through the existing BambooHR service.
 *
 * Only the CEO, COO, and confirmed HR administrators (BambooAccess.canViewAll) can search
 * employees; for everyone else this provider and its category do not exist. Only approved
 * directory fields are requested: name, job title, and employment status. Compensation, SSN,
 * payroll, health, demographics, home address, and documents are never requested, searched,
 * or shown. Nothing is mirrored into the index, and every search is audited (never contents).
 */

import "server-only";

import { recordAudit } from "@/lib/agents/audit";
import type { EmployeeSummary } from "@/lib/bamboohr/service";
import type { ProviderHit, SearchProvider } from "../provider";
import { safeId } from "../safety";

const EMPLOYEE_ID = /^[0-9]{1,12}$/;

function hit(e: EmployeeSummary, fields: Set<string>): ProviderHit | null {
  const id = safeId(e.id, EMPLOYEE_ID);
  if (!id) return null;
  const title = fields.has("jobTitle") ? e.jobTitle : null;
  const status = fields.has("status") ? e.status : null;
  return {
    recordId: id,
    title: e.name,
    subtitle: [title, status].filter(Boolean).join(" · ") || "Employee",
    description: null,
    breadcrumb: ["Sam Operations", "Employees"],
    url: `/ai/operations?tab=employees&employee=${id}`,
    icon: "users",
    auth: "sensitive",
    sourceMatched: true,
    match: { title: e.name, fields: [title, status] },
  };
}

export const bambooEmployeesProvider: SearchProvider = {
  id: "bamboohr-employees",
  category: "employees",
  name: "BambooHR employees",
  icon: "users",
  sourceSystem: "bamboohr",
  description: "Live, read-only BambooHR directory search (name, job title, status).",
  searchableFields: [
    { key: "name", label: "Name", sensitivity: "standard", defaultEnabled: true },
    { key: "jobTitle", label: "Job title", sensitivity: "standard", defaultEnabled: true },
    { key: "status", label: "Employment status", sensitivity: "standard", defaultEnabled: true },
    {
      key: "compensation",
      label: "Compensation & pay",
      sensitivity: "restricted",
      defaultEnabled: false,
    },
    { key: "ssn", label: "SSN / tax ids", sensitivity: "restricted", defaultEnabled: false },
    { key: "health", label: "Health & benefits", sensitivity: "restricted", defaultEnabled: false },
    {
      key: "demographics",
      label: "Demographics & DOB",
      sensitivity: "restricted",
      defaultEnabled: false,
    },
    { key: "homeAddress", label: "Home address", sensitivity: "restricted", defaultEnabled: false },
    {
      key: "documents",
      label: "Employee documents",
      sensitivity: "restricted",
      defaultEnabled: false,
    },
  ],
  optional: true,
  indexing: "live",
  permissionSummary:
    "CEO, COO, and confirmed HR administrators only (Sam Operations roles). Every search is audited.",
  minQueryLength: 2,
  timeoutMs: 3500,
  async canUse(ctx) {
    return Boolean((await ctx.bambooAccess())?.canViewAll);
  },
  async availability() {
    const { getConnection } = await import("@/lib/bamboohr/connection");
    const c = await getConnection().catch(() => null);
    if (c?.status === "connected") return { available: true };
    return {
      available: false,
      reason:
        c?.status === "reauthorization_required"
          ? "BambooHR needs to be reconnected."
          : "BambooHR isn't connected.",
    };
  },
  async search(ctx, input) {
    const { listEmployees } = await import("@/lib/bamboohr/service");
    const tokens = input.query.trim().split(/\s+/);
    // BambooHR filters one name field at a time; send the last word, rank the rest locally.
    const term = tokens[tokens.length - 1] ?? "";
    const { data } = await listEmployees({
      nameFilter: term,
      limit: Math.min(input.limit * 2, 50),
    });
    const hits = data.employees
      .map((e) => hit(e, input.fields))
      .filter((h): h is ProviderHit => h !== null);
    void recordAudit({
      actor: { userId: ctx.user.id, label: ctx.user.label },
      action: "search.bamboohr",
      targetType: "bamboohr_employee",
      targetId: null,
      summary: `Searched BambooHR employees from Global Search (${hits.length} result${hits.length === 1 ? "" : "s"}).`,
      details: { queryLength: input.query.length },
    });
    return { hits, hasMore: Boolean(data.nextCursor), freshness: { kind: "live" } };
  },
};
