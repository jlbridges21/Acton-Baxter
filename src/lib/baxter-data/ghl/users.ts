import "server-only";

import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import {
  listUsers,
  getUserById,
  getUserByEmail,
  findUserByName,
  getUserSummary,
} from "@/lib/connectors/ghl/resources/users";
import type { BaxterGhlUserContext, GhlUser, GhlEvidenceSource } from "./types";
import { createUserEvidenceSource } from "./evidence";

export async function getBaxterUserContext(): Promise<BaxterGhlUserContext | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const users = await listUsers();
  const evidenceSources = users.map((u) =>
    createUserEvidenceSource(u.id, u.name, `Role: ${u.role ?? "N/A"}`),
  );

  return { users, evidenceSources };
}

export async function getBaxterUserById(
  userId: string,
): Promise<{ user: GhlUser | null; evidenceSources: GhlEvidenceSource[] } | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const user = await getUserById(userId);
  const evidenceSources: GhlEvidenceSource[] = [];

  if (user) {
    evidenceSources.push(createUserEvidenceSource(user.id, user.name, `Found by ID: ${userId}`));
  }

  return { user, evidenceSources };
}

export async function getBaxterUserByEmail(
  email: string,
): Promise<{ user: GhlUser | null; evidenceSources: GhlEvidenceSource[] } | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const user = await getUserByEmail(email);
  const evidenceSources: GhlEvidenceSource[] = [];

  if (user) {
    evidenceSources.push(createUserEvidenceSource(user.id, user.name, `Found by email: ${email}`));
  }

  return { user, evidenceSources };
}

export async function findBaxterUserByName(
  name: string,
): Promise<{ user: GhlUser | null; evidenceSources: GhlEvidenceSource[] } | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const user = await findUserByName(name);
  const evidenceSources: GhlEvidenceSource[] = [];

  if (user) {
    evidenceSources.push(createUserEvidenceSource(user.id, user.name, `Found by name: "${name}"`));
  }

  return { user, evidenceSources };
}

export async function getBaxterUserSummary(): Promise<{
  summary: {
    totalUsers: number;
    users: Array<{ id: string; name: string; email: string; role: string | null }>;
  };
  evidenceSources: GhlEvidenceSource[];
} | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const summary = await getUserSummary();
  const evidenceSources = summary.users.map((u) =>
    createUserEvidenceSource(u.id, u.name, `Role: ${u.role ?? "N/A"}`),
  );

  return { summary, evidenceSources };
}
