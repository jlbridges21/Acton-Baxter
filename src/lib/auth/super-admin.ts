import "server-only";

/**
 * Super-admin and rulebook editor authorization.
 */

export const BOOTSTRAP_SUPER_ADMIN_EMAIL = "baxter@actonadu.com";

/**
 * Check if an email belongs to the bootstrap super-admin.
 */
export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL;
}

/**
 * Check if a user is a super-admin.
 * Super-admin = bootstrap email match OR profile.role === 'super_admin'.
 */
export function isSuperAdmin(user: {
  email?: string | null;
  profile?: { role?: string };
}): boolean {
  return isSuperAdminEmail(user.email) || user.profile?.role === "super_admin";
}

/**
 * Check if a user is an admin (has admin or super_admin role).
 * All admins can edit rulebook drafts.
 */
export function isAdminRole(user: { profile?: { role?: string } }): boolean {
  const role = user.profile?.role;
  return role === "admin" || role === "super_admin";
}

/**
 * Check if a user can edit rulebook drafts.
 * All admins can edit drafts.
 */
export function isRulebookEditor(user: { profile?: { role?: string } }): boolean {
  return isAdminRole(user);
}

/**
 * Check if a user can activate rulebook versions.
 * All admins can activate rulebooks.
 */
export function isRulebookActivator(user: { profile?: { role?: string } }): boolean {
  return isAdminRole(user);
}
