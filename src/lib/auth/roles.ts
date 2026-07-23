export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin";
}

export function assertAdminRole(role: string | null | undefined): void {
  if (!isAdminRole(role)) {
    throw new Error("Admin role required");
  }
}
