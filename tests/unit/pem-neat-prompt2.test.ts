import { describe, expect, it, beforeEach } from "vitest";
import { USER_ROLES } from "@/lib/research/constants";
import {
  isAdminRole,
  isAppAccessRole,
  isPendingAccessRole,
  isSuperAdminRole,
  ROLE_LABELS,
} from "@/lib/auth/roles";
import { isSuperAdminEmail, BOOTSTRAP_SUPER_ADMIN_EMAIL } from "@/lib/auth/super-admin";
import { getAdminNavLinks } from "@/lib/baxter/admin-nav";
import {
  listDepartments,
  createDepartment,
  updateDepartment,
  deactivateDepartment,
  assignUserDepartment,
  getDepartmentBySlug,
  SALES_DEPARTMENT_SLUG,
  resetMemoryDepartmentsForTests,
} from "@/lib/org/departments";
import { getReportStore, resetMemoryStoreForTests } from "@/lib/research/report-store";
import { listSalespeople } from "@/lib/pem-neat/salespeople";
import {
  getPemNeatProviderTimeoutMs,
  isAbortError,
  pemNeatStoreError,
} from "@/lib/pem-neat/errors";
import { AppError } from "@/lib/errors";

describe("Baxter application roles", () => {
  it("uses new_user, user, admin, super_admin — not salesperson", () => {
    expect(USER_ROLES).toEqual(["new_user", "user", "admin", "super_admin"]);
    expect(USER_ROLES).not.toContain("salesperson");
  });

  it("treats user/admin/super_admin as app access", () => {
    expect(isAppAccessRole("user")).toBe(true);
    expect(isAppAccessRole("admin")).toBe(true);
    expect(isAppAccessRole("super_admin")).toBe(true);
    expect(isAppAccessRole("new_user")).toBe(false);
    expect(isAppAccessRole("salesperson")).toBe(false);
  });

  it("treats admin and super_admin as admin roles", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("super_admin")).toBe(true);
    expect(isAdminRole("user")).toBe(false);
  });

  it("labels roles for UI", () => {
    expect(ROLE_LABELS.super_admin).toBe("Super Admin");
    expect(ROLE_LABELS.user).toBe("User");
    expect(isPendingAccessRole("new_user")).toBe(true);
    expect(isSuperAdminRole("super_admin")).toBe(true);
  });

  it("recognizes bootstrap super-admin email", () => {
    expect(isSuperAdminEmail(BOOTSTRAP_SUPER_ADMIN_EMAIL)).toBe(true);
    expect(isSuperAdminEmail("other@actonadu.com")).toBe(false);
  });
});

describe("Baxter Settings navigation", () => {
  it("hamburger Settings goes to global Baxter Settings", () => {
    const settings = getAdminNavLinks().find((l) => l.label === "Settings");
    expect(settings?.href).toBe("/admin/settings");
    expect(settings?.match?.("/admin/settings")).toBe(true);
    expect(settings?.match?.("/admin/knowledge/settings")).toBe(false);
  });
});

describe("Departments + PEM salesperson eligibility", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.E2E_TEST_AUTH_BYPASS = "true";
    resetMemoryStoreForTests();
    resetMemoryDepartmentsForTests();
  });

  it("seeds default departments including Sales", async () => {
    const departments = await listDepartments();
    expect(departments.some((d) => d.slug === SALES_DEPARTMENT_SLUG)).toBe(true);
    expect(await getDepartmentBySlug(SALES_DEPARTMENT_SLUG)).toBeTruthy();
  });

  it("supports create, rename, and deactivate", async () => {
    const created = await createDepartment({ name: "Estimating" });
    expect(created.slug).toBe("estimating");
    const renamed = await updateDepartment(created.id, { name: "Precon" });
    expect(renamed.name).toBe("Precon");
    const deactivated = await deactivateDepartment(created.id);
    expect(deactivated.is_active).toBe(false);
  });

  it("includes Sales users and admins in PEM salesperson picker; excludes Design", async () => {
    const store = getReportStore();
    const sales = await getDepartmentBySlug(SALES_DEPARTMENT_SLUG);
    const design = await getDepartmentBySlug("design");
    expect(sales && design).toBeTruthy();

    await store.ensureProfile({
      id: "00000000-0000-4000-8000-000000000011",
      full_name: "Sales User",
      role: "user",
      department_id: sales!.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await store.ensureProfile({
      id: "00000000-0000-4000-8000-000000000012",
      full_name: "Sales Admin",
      role: "admin",
      department_id: sales!.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await store.ensureProfile({
      id: "00000000-0000-4000-8000-000000000013",
      full_name: "Design User",
      role: "user",
      department_id: design!.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await store.ensureProfile({
      id: "00000000-0000-4000-8000-000000000014",
      full_name: "Pending",
      role: "new_user",
      department_id: sales!.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Force department filter path by assigning departments to all candidates
    const options = await listSalespeople();
    const names = options.map((o) => o.displayName);
    expect(names).toContain("Sales User");
    expect(names).toContain("Sales Admin");
    expect(names).not.toContain("Design User");
    expect(names).not.toContain("Pending");
  });

  it("assignUserDepartment updates profile department", async () => {
    const store = getReportStore();
    const sales = await getDepartmentBySlug(SALES_DEPARTMENT_SLUG);
    await store.ensureProfile({
      id: "00000000-0000-4000-8000-000000000015",
      full_name: "Assign Me",
      role: "user",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await assignUserDepartment("00000000-0000-4000-8000-000000000015", sales!.id);
    const profile = await store.getProfile("00000000-0000-4000-8000-000000000015");
    expect(profile?.department_id).toBe(sales!.id);
  });
});

describe("PEM generation error mapping (unexpected-error regression)", () => {
  it("maps AbortError to PEM_NEAT_TIMEOUT AppError semantics", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
    expect(isAbortError(new Error("other"))).toBe(false);
  });

  it("maps missing-table store errors to migration-required AppError", () => {
    const err = pemNeatStoreError(
      new Error('relation "public.pem_neat_generations" does not exist'),
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("PEM_NEAT_MIGRATION_REQUIRED");
    expect(err.message).not.toMatch(/PGRST|relation/i);
  });

  it("uses a PEM-specific timeout well above the global 12s default", () => {
    delete process.env.PEM_NEAT_TIMEOUT_MS;
    expect(getPemNeatProviderTimeoutMs()).toBeGreaterThanOrEqual(60_000);
  });
});
