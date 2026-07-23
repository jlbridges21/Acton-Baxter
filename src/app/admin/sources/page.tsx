import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SourceHealthTable } from "@/components/admin/source-health-table";
import { requireUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { getEnv } from "@/lib/env";
import { getLiveSourceHealth, getMockSourceHealth } from "@/lib/research/source-health";

export default async function AdminSourcesPage() {
  const user = await requireUser();
  if (!isAdminRole(user.profile.role)) {
    redirect("/dashboard");
  }

  const env = getEnv();
  const sources = env.ENABLE_MOCK_RESEARCH ? getMockSourceHealth() : await getLiveSourceHealth();

  return (
    <AppShell user={user}>
      <SourceHealthTable sources={sources} />
    </AppShell>
  );
}
