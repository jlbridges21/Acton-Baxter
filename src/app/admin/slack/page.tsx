import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getAdminSlackSnapshot, getSlackActivityOverview } from "@/lib/slack/admin";
import { AdminSlackActivityClient } from "@/components/admin/admin-slack-activity-client";
import type { SlackActivityFilters } from "@/lib/slack/activity";

export default async function AdminSlackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const params = await searchParams;
  const filters: SlackActivityFilters = {
    q: typeof params.q === "string" ? params.q : undefined,
    kind: (typeof params.kind === "string" ? params.kind : "all") as SlackActivityFilters["kind"],
    range: (typeof params.range === "string"
      ? params.range
      : "all") as SlackActivityFilters["range"],
    sort: (typeof params.sort === "string"
      ? params.sort
      : "recent") as SlackActivityFilters["sort"],
  };

  const [snapshot, overview] = await Promise.all([
    getAdminSlackSnapshot({ adminUserId: user.profile.id }),
    getSlackActivityOverview(filters),
  ]);

  return (
    <AppShell user={user}>
      <Suspense
        fallback={<p className="text-sm text-[var(--acton-muted)]">Loading Slack activity…</p>}
      >
        <AdminSlackActivityClient
          overview={overview}
          extras={{
            health: snapshot.health,
            config: snapshot.config,
            stats: snapshot.stats,
            identity: snapshot.identity,
            search: snapshot.search,
          }}
        />
      </Suspense>
    </AppShell>
  );
}
