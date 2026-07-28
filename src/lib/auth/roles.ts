import type { UserRole } from "@/lib/research/types";

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

export function isSuperAdminRole(role: string | null | undefined): boolean {
  return role === "super_admin";
}

/** Roles that may use research features (not pending approval). */
export function isAppAccessRole(role: string | null | undefined): boolean {
  return role === "user" || role === "admin" || role === "super_admin";
}

export function isPendingAccessRole(role: string | null | undefined): boolean {
  return role === "new_user";
}

export const ROLE_LABELS: Record<UserRole, string> = {
  new_user: "New User",
  user: "User",
  admin: "Admin",
  super_admin: "Super Admin",
};

export function assertAdminRole(role: string | null | undefined): void {
  if (!isAdminRole(role)) {
    throw new Error("Admin role required");
  }
}
