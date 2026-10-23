/** Server-side gate for Reports pages: the signed-in user plus their Reports access. */

import "server-only";

import { requireActiveUser } from "@/lib/auth/session";
import { requesterFromAuthUser } from "@/lib/agents/permissions";
import { getReportsAccess } from "./access";

export async function loadReportsPageContext() {
  const user = await requireActiveUser();
  const requester = requesterFromAuthUser(user);
  const access = await getReportsAccess(requester).catch(() => null);
  return { user, requester, access };
}
