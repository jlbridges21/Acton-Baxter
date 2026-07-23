import { describe, expect, it } from "vitest";
import {
  assertAdminRole,
  isAdminRole,
  isAppAccessRole,
  isPendingAccessRole,
} from "@/lib/auth/roles";

describe("role-based access helpers", () => {
  it("identifies admin roles", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("salesperson")).toBe(false);
    expect(isAdminRole("new_user")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
  });

  it("identifies app access vs pending roles", () => {
    expect(isAppAccessRole("admin")).toBe(true);
    expect(isAppAccessRole("salesperson")).toBe(true);
    expect(isAppAccessRole("new_user")).toBe(false);
    expect(isPendingAccessRole("new_user")).toBe(true);
    expect(isPendingAccessRole("salesperson")).toBe(false);
  });

  it("throws when asserting a non-admin role", () => {
    expect(() => assertAdminRole("salesperson")).toThrow("Admin role required");
    expect(() => assertAdminRole("new_user")).toThrow("Admin role required");
  });
});
