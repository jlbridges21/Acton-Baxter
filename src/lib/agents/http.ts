/**
 * Shared request helpers for /api/ai/* route handlers: session → requester, agent
 * lookup, and authorization shortcuts. Every route authorizes on the server.
 */

import "server-only";

import { requireActiveUser, type AuthUser } from "@/lib/auth/session";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { assertAgentAccess, getAgentAccess, requesterFromAuthUser } from "./permissions";
import { getResolvedAgent, listResolvedAgents } from "./registry";
import type { AccessLevel, Requester, ResolvedAgent } from "./types";

export type AiContext = { user: AuthUser; requester: Requester };

export async function requireAiContext(): Promise<AiContext> {
  const user = await requireActiveUser();
  return { user, requester: requesterFromAuthUser(user) };
}

export function actorOf(ctx: AiContext) {
  return { userId: ctx.user.id, label: ctx.user.profile.full_name || ctx.user.email };
}

export async function requireAgent(slug: string): Promise<ResolvedAgent> {
  const agent = await getResolvedAgent(slug, { fresh: true });
  if (!agent) throw new NotFoundError("Agent not found");
  return agent;
}

export async function requireAgentAccess(
  ctx: AiContext,
  slug: string,
  level: AccessLevel,
): Promise<ResolvedAgent> {
  const agent = await requireAgent(slug);
  await assertAgentAccess(ctx.requester, agent, level);
  return agent;
}

/**
 * Onboarding belongs to whichever agents have the onboarding tools enabled (Sam today).
 * Access is the union of the requester's access to those agents — not hardcoded to a name.
 */
export async function onboardingAccess(requester: Requester): Promise<Set<AccessLevel>> {
  const owners = (await listResolvedAgents()).filter((a) =>
    a.config.tools.enabled.some((t) => t === "onboarding_progress" || t === "onboarding_templates"),
  );
  const union = new Set<AccessLevel>();
  for (const agent of owners)
    for (const level of await getAgentAccess(requester, agent)) union.add(level);
  return union;
}

export async function assertOnboardingAccess(requester: Requester, level: AccessLevel) {
  const access = await onboardingAccess(requester);
  if (!access.has(level)) {
    throw new AuthorizationError(
      level === "manage"
        ? "Only people who manage the HR agent can edit onboarding templates."
        : "You don't have access to onboarding records.",
    );
  }
  return access;
}
