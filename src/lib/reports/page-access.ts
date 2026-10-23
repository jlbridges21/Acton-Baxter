/** Server-side gate for Reports pages: the signed-in user plus their Reports access. */

import "server-only";

import { requireActiveUser } from "@/lib/auth/session";
import { DEXTER_AVATAR_PATH } from "@/lib/agents/defaults";
import { requesterFromAuthUser } from "@/lib/agents/permissions";
import { getResolvedAgent } from "@/lib/agents/registry";
import { DEXTER_SLUG, getReportsAccess } from "./access";

export async function loadReportsPageContext() {
  const user = await requireActiveUser();
  const requester = requesterFromAuthUser(user);
  const [access, dexter] = await Promise.all([
    getReportsAccess(requester).catch(() => null),
    getResolvedAgent(DEXTER_SLUG).catch(() => null),
  ]);
  // The portrait set in AI Studio, so Reports always matches the AI Office.
  const dexterAvatarUrl = dexter?.row.avatar_url || DEXTER_AVATAR_PATH;
  return { user, requester, access, dexterAvatarUrl };
}
