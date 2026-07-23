export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin";
}

/** Roles that may use research features (not pending approval). */
export function isAppAccessRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "salesperson";
}

export function isPendingAccessRole(role: string | null | undefined): boolean {
  return role === "new_user";
}

export function assertAdminRole(role: string | null | undefined): void {
  if (!isAdminRole(role)) {
    throw new Error("Admin role required");
  }
}
