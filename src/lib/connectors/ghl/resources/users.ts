import "server-only";

import { ghlGet } from "../client";
import { ghlUsersResponseSchema, type GhlUser } from "../types";
import { normalizeUser } from "../normalize";
import { requireGhlLocationId } from "../config";
import { getCachedReference, setCachedReference } from "../cache";

export async function listUsers(options: { useCache?: boolean } = {}): Promise<GhlUser[]> {
  const locationId = requireGhlLocationId();

  if (options.useCache !== false) {
    const cached = await getCachedReference<GhlUser[]>(locationId, "users");
    if (cached) {
      return cached;
    }
  }

  try {
    const response = await ghlGet("/users/");
    const parsed = ghlUsersResponseSchema.safeParse(response);

    let users: GhlUser[];

    if (!parsed.success) {
      console.warn("[GHL Users] Response validation warning:", parsed.error.message);
      const raw = response as { users?: unknown[] };
      users = Array.isArray(raw.users)
        ? (raw.users as Record<string, unknown>[]).map(normalizeUser)
        : [];
    } else {
      users = parsed.data.users.map((u) => normalizeUser(u as Record<string, unknown>));
    }

    await setCachedReference(locationId, "users", users);
    return users;
  } catch (error) {
    console.warn(
      "[GHL Users] API may not be available:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return [];
  }
}

export async function getUserById(
  userId: string,
  options: { useCache?: boolean } = {},
): Promise<GhlUser | null> {
  const users = await listUsers(options);
  return users.find((u) => u.id === userId) ?? null;
}

export async function getUserByEmail(
  email: string,
  options: { useCache?: boolean } = {},
): Promise<GhlUser | null> {
  const users = await listUsers(options);
  const lower = email.toLowerCase();
  return users.find((u) => u.email.toLowerCase() === lower) ?? null;
}

export async function findUserByName(
  name: string,
  options: { useCache?: boolean } = {},
): Promise<GhlUser | null> {
  const users = await listUsers(options);
  const lower = name.toLowerCase();

  const exact = users.find((u) => u.name.toLowerCase() === lower);
  if (exact) return exact;

  const partial = users.find(
    (u) =>
      u.name.toLowerCase().includes(lower) ||
      u.firstName?.toLowerCase().includes(lower) ||
      u.lastName?.toLowerCase().includes(lower),
  );

  return partial ?? null;
}

export async function getUserSummary(options: { useCache?: boolean } = {}): Promise<{
  totalUsers: number;
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: string | null;
  }>;
}> {
  const users = await listUsers(options);

  return {
    totalUsers: users.length,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
    })),
  };
}
