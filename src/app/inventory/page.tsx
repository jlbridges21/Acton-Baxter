import { AppShell } from "@/components/layout/app-shell";
import { InventoryClient } from "@/components/inventory/inventory-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { applyInventoryQuery, parseInventoryFilters } from "@/lib/inventory/filters";
import { signInventoryFiles } from "@/lib/inventory/order-files";
import { listAllInventoryItems, listInventoryVocab } from "@/lib/inventory/store";
import { listExpenseJobs } from "@/lib/receipts";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function InventoryPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireActiveUser();
  const filters = parseInventoryFilters(await searchParams);
  const [rawItems, statuses, storageStates, jobs] = await Promise.all([
    listAllInventoryItems(),
    listInventoryVocab("status"),
    listInventoryVocab("storage"),
    listExpenseJobs({ includeInactive: false }),
  ]);
  const queried = applyInventoryQuery(rawItems, filters);
  const signedPhotos = await signInventoryFiles(
    queried.rows.flatMap((item) => (item.photoStoragePath ? [item.photoStoragePath] : [])),
  );
  const rows = queried.rows.map((item) => {
    if (!item.photoStoragePath) return item;
    const photoUrl = signedPhotos.get(item.photoStoragePath);
    return photoUrl ? { ...item, photoUrl } : item;
  });
  const result = { ...queried, rows };
  const projectOptions = new Map<string, string>();
  for (const job of jobs) projectOptions.set(job.id, job.label);
  for (const item of rawItems) {
    if (item.jobId) projectOptions.set(item.jobId, item.projectLabel);
    if (item.customProjectLabel) {
      projectOptions.set(`custom:${item.customProjectLabel}`, item.customProjectLabel);
    }
  }
  const vendors = [
    ...new Set(
      rawItems.map((item) => item.vendor).filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  const orderNumbers = [
    ...new Set(
      rawItems.map((item) => item.orderNumber).filter((value): value is string => Boolean(value)),
    ),
  ].sort();

  return (
    <AppShell user={user}>
      <InventoryClient
        rows={result.rows}
        matchingIds={result.matchingIds}
        total={result.total}
        page={result.page}
        pageCount={result.pageCount}
        filters={{ ...filters, page: result.page }}
        statuses={statuses}
        storageStates={storageStates}
        jobs={jobs.map((job) => ({ id: job.id, label: job.label }))}
        projectOptions={[...projectOptions.entries()].map(([value, label]) => ({ value, label }))}
        vendors={vendors}
        orderNumbers={orderNumbers}
        isAdmin={isAdminRole(user.profile.role)}
      />
    </AppShell>
  );
}
