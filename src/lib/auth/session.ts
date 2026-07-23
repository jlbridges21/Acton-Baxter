import { isAppAccessRole } from "@/lib/auth/roles";
import { getEnv } from "@/lib/env";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { getReportStore } from "@/lib/research/report-store";
import type { Profile, UserRole } from "@/lib/research/db-types";

export type AuthUser = {
  id: string;
  email: string;
  profile: Profile;
};

function testBypassUser(): AuthUser | null {
  const env = getEnv();
  // Next.js forces NODE_ENV to "development" under `next dev`, so Playwright
  // cannot rely on NODE_ENV=test. Bypass is still blocked in production.
  if (!env.E2E_TEST_AUTH_BYPASS || env.NODE_ENV === "production") {
    return null;
  }

  const id = env.E2E_TEST_USER_ID || "00000000-0000-4000-8000-000000000001";
  const email = env.E2E_TEST_USER_EMAIL || "test@actonadu.local";
  const fullName = env.E2E_TEST_USER_NAME || "Test Salesperson";
  const role = (env.E2E_TEST_USER_ROLE || "salesperson") as UserRole;
  const now = new Date().toISOString();

  return {
    id,
    email,
    profile: {
      id,
      full_name: fullName,
      role,
      created_at: now,
      updated_at: now,
    },
  };
}

export async function requireUser(): Promise<AuthUser> {
  const bypass = testBypassUser();
  if (bypass) {
    await getReportStore().ensureProfile(bypass.profile);
    return bypass;
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AuthenticationError();
  }

  const store = getReportStore();
  let profile = await store.getProfile(user.id);
  if (!profile) {
    profile = await store.ensureProfile({
      id: user.id,
      full_name:
        (user.user_metadata?.full_name as string | undefined) ||
        user.email?.split("@")[0] ||
        "Acton User",
      role: ((user.user_metadata?.role as UserRole | undefined) ?? "new_user") as UserRole,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  return {
    id: user.id,
    email: user.email ?? "",
    profile,
  };
}

export async function getOptionalUser(): Promise<AuthUser | null> {
  try {
    return await requireUser();
  } catch {
    return null;
  }
}

/** Authenticated user with salesperson or admin access (not pending new_user). */
export async function requireActiveUser(): Promise<AuthUser> {
  const user = await requireUser();
  if (!isAppAccessRole(user.profile.role)) {
    throw new AuthorizationError(
      "Your account is pending approval. An administrator must grant access before you can use the app.",
    );
  }
  return user;
}

export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireActiveUser();
  if (user.profile.role !== "admin") {
    throw new AuthorizationError("Admin access required");
  }
  return user;
}
