import { describe, expect, it } from "vitest";
import { assertAdminRole, isAdminRole } from "@/lib/auth/roles";

describe("role-based admin access helper", () => {
  it("identifies admin roles", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("salesperson")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
  });

  it("throws when asserting a non-admin role", () => {
    expect(() => assertAdminRole("salesperson")).toThrow("Admin role required");
  });
});
