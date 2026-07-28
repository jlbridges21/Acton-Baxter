import "server-only";

import { isAppAccessRole } from "@/lib/auth/roles";
import { getEnv } from "@/lib/env";
import {
  getDepartmentBySlug,
  listDepartments,
  SALES_DEPARTMENT_SLUG,
} from "@/lib/org/departments";
import { createServiceClient } from "@/lib/supabase/admin";
import { getReportStore } from "@/lib/research/report-store";
import { pemNeatStoreError } from "@/lib/pem-neat/errors";

export type SalespersonOption = {
  id: string;
  displayName: string;
  email?: string | null;
  role?: string | null;
};

function shouldUseMemoryProfiles(): boolean {
  const env = getEnv();
  return (
    env.E2E_TEST_AUTH_BYPASS ||
    env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-")
  );
}

function isEligibleSalesRole(role: string | null | undefined): boolean {
  return isAppAccessRole(role);
}

/** Active Baxter users eligible as salesperson selectors (no hardcoded people). */
export async function listSalespeople(): Promise<SalespersonOption[]> {
  if (shouldUseMemoryProfiles()) {
    const profiles = await getReportStore().listProfiles();
    const departments = await listDepartments();

    // E2E/memory: when departments are seeded but users lack assignments, still allow
    // app-access profiles so PEM flows keep working without manual department setup.
    const filterBySalesDepartment = departments.some((d) => d.slug === SALES_DEPARTMENT_SLUG);
    const salesDepartment = filterBySalesDepartment
      ? await getDepartmentBySlug(SALES_DEPARTMENT_SLUG)
      : null;

    return profiles
      .filter((profile) => {
        if (!isEligibleSalesRole(profile.role)) return false;
        if (!filterBySalesDepartment || !salesDepartment) return true;
        if (!profile.department_id) return true;
        return profile.department_id === salesDepartment.id;
      })
      .map((p) => ({
        id: p.id,
        displayName: p.full_name?.trim() || "Unnamed user",
        role: p.role,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, department_id, departments!inner(slug)")
    .eq("departments.slug", SALES_DEPARTMENT_SLUG)
    .in("role", ["user", "admin", "super_admin"])
    .order("full_name", { ascending: true });

  if (error) {
    throw pemNeatStoreError(error, "Unable to load salespeople");
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    displayName: (row.full_name as string | null)?.trim() || "Unnamed user",
    email: null,
    role: (row.role as string | null) ?? null,
  }));
}

export async function resolveSalespersonDisplayName(
  userId: string,
): Promise<SalespersonOption | null> {
  const all = await listSalespeople();
  return all.find((p) => p.id === userId) ?? null;
}
