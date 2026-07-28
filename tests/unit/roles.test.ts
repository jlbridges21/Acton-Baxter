import { describe, expect, it } from "vitest";
import {
  assertAdminRole,
  isAdminRole,
  isAppAccessRole,
  isPendingAccessRole,
  isSuperAdminRole,
  ROLE_LABELS,
} from "@/lib/auth/roles";

describe("role-based access helpers", () => {
  it("identifies admin roles", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("super_admin")).toBe(true);
    expect(isAdminRole("user")).toBe(false);
    expect(isAdminRole("new_user")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
  });

  it("identifies super admin role", () => {
    expect(isSuperAdminRole("super_admin")).toBe(true);
    expect(isSuperAdminRole("admin")).toBe(false);
  });

  it("identifies app access vs pending roles", () => {
    expect(isAppAccessRole("admin")).toBe(true);
    expect(isAppAccessRole("super_admin")).toBe(true);
    expect(isAppAccessRole("user")).toBe(true);
    expect(isAppAccessRole("new_user")).toBe(false);
    expect(isPendingAccessRole("new_user")).toBe(true);
    expect(isPendingAccessRole("user")).toBe(false);
  });

  it("provides role labels", () => {
    expect(ROLE_LABELS.user).toBe("User");
    expect(ROLE_LABELS.super_admin).toBe("Super Admin");
  });

  it("throws when asserting a non-admin role", () => {
    expect(() => assertAdminRole("user")).toThrow("Admin role required");
    expect(() => assertAdminRole("new_user")).toThrow("Admin role required");
  });
});
