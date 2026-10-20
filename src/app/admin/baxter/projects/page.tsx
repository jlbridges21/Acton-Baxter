import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { MasterProjectLogClient } from "@/components/admin/master-project-log-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import {
  loadMasterProjectLog,
  type ProjectRegistryLoadResult,
} from "@/lib/baxter-data/project-registry";
import { parseProjectLogViewParams } from "@/lib/baxter-data/project-registry/log-view";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminMasterProjectLogPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const view = parseProjectLogViewParams(await searchParams);
  // Read-only: the sheet is the source of truth. Short-cached like Baxter AI reads.
  let loaded: ProjectRegistryLoadResult | null = null;
  let loadError: string | null = null;
  try {
    loaded = await loadMasterProjectLog();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Could not read the Master Project Log.";
  }

  return (
    <AppShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Master Project Log</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Every project on the Project Charter Master sheet. Column J (Open/Closed) decides which
          projects Receipts, Site Inspections, and Inventory offer — only Open projects appear. Edit
          the sheet to change a project; this page is read-only.
        </p>
      </div>
      <MasterProjectLogClient
        rows={loaded?.rows ?? []}
        spreadsheetId={loaded?.spreadsheetId ?? ""}
        tabName={loaded?.tabName ?? ""}
        fetchedAt={loaded?.fetchedAt ?? null}
        fromCache={loaded?.fromCache ?? false}
        loadError={loadError}
        initialView={view}
      />
    </AppShell>
  );
}
