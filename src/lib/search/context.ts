/**
 * Per-request search context: the verified requester plus lazily computed, memoized access
 * from the systems that already own authorization (AI Workforce policies, Reports/Dexter,
 * Sam Operations, BambooHR, GoHighLevel role policy). Providers never decide access themselves
 * from the client; they ask this context on the server.
 */

import "server-only";

import { isAdminRole } from "@/lib/auth/roles";
import type { AuthUser } from "@/lib/auth/session";
import { requesterFromAuthUser } from "@/lib/agents/permissions";
import type { Requester } from "@/lib/agents/types";
import type { NavRequirement } from "@/lib/navigation/registry";
import type { ReportsAccess } from "@/lib/reports/access";
import type { OpsAccess } from "@/lib/ops/org";
import type { BambooAccess } from "@/lib/bamboohr/access";

export type SearchContext = {
  user: { id: string; email: string; role: string; label: string };
  requester: Requester;
  isAdmin: boolean;
  reportsAccess(): Promise<ReportsAccess | null>;
  opsAccess(): Promise<OpsAccess | null>;
  bambooAccess(): Promise<BambooAccess | null>;
  /** GoHighLevel read access for a resource, from the connector's role policy. */
  canReadGhl(resource: "contacts" | "opportunities"): boolean;
  meets(requirement: NavRequirement | undefined): Promise<boolean>;
  /** Capability tags used to filter index rows at retrieval time. */
  capabilities(): Promise<string[]>;
};

function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
}

/** Map Baxter roles onto the GoHighLevel connector policy (src/lib/connectors/ghl/access-policy). */
export function ghlRoleFor(role: string): "admin" | "salesperson" | "viewer" {
  if (isAdminRole(role)) return "admin";
  if (role === "user") return "salesperson";
  return "viewer";
}

export type SearchContextOverrides = Partial<
  Pick<SearchContext, "reportsAccess" | "opsAccess" | "bambooAccess" | "canReadGhl">
>;

export function createSearchContext(
  user: AuthUser,
  overrides: SearchContextOverrides = {},
): SearchContext {
  const requester = requesterFromAuthUser(user);
  return createSearchContextFor(
    {
      id: user.id,
      email: user.email,
      role: user.profile.role,
      label: user.profile.full_name || user.email,
    },
    requester,
    overrides,
  );
}

export function createSearchContextFor(
  user: SearchContext["user"],
  requester: Requester,
  overrides: SearchContextOverrides = {},
): SearchContext {
  const isAdmin = isAdminRole(user.role) && requester.verifiedVia !== "unverified";

  const reportsAccess =
    overrides.reportsAccess ??
    memo(async () => {
      const { getReportsAccess } = await import("@/lib/reports/access");
      return getReportsAccess(requester).catch(() => null);
    });
  const opsAccess =
    overrides.opsAccess ??
    memo(async () => {
      const { getOpsAccess } = await import("@/lib/ops/org");
      return getOpsAccess(requester).catch(() => null);
    });
  const bambooAccess =
    overrides.bambooAccess ??
    memo(async () => {
      const { getBambooAccess } = await import("@/lib/bamboohr/access");
      return getBambooAccess(requester).catch(() => null);
    });
  const canReadGhl =
    overrides.canReadGhl ??
    ((resource: "contacts" | "opportunities") => {
      // Mirrors RESOURCE_ACCESS_BY_ROLE in the connector policy: admin/salesperson read.
      const r = ghlRoleFor(user.role);
      void resource;
      return requester.verifiedVia !== "unverified" && (r === "admin" || r === "salesperson");
    });

  const ctx: SearchContext = {
    user,
    requester,
    isAdmin,
    reportsAccess,
    opsAccess,
    bambooAccess,
    canReadGhl,
    async meets(requirement) {
      switch (requirement) {
        case undefined:
          return true;
        case "reports":
          return Boolean((await reportsAccess())?.canUse);
        case "reports_admin":
          return Boolean((await reportsAccess())?.isAdmin);
        case "ops_full": {
          const a = await opsAccess();
          return Boolean(a && (a.canViewAll || a.canConfigure));
        }
        case "ops_view_all":
          return Boolean((await opsAccess())?.canViewAll);
      }
    },
    capabilities: memo(async () => {
      const caps = new Set<string>([`role:${user.role}`]);
      if (isAdmin) caps.add("admin");
      const reports = await reportsAccess();
      if (reports?.canUse) for (const c of reports.categories) caps.add(`reports:${c}`);
      return [...caps];
    }),
  };
  return ctx;
}
