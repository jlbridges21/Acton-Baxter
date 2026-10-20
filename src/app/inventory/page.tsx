import { AppShell } from "@/components/layout/app-shell";
import { InventoryClient } from "@/components/inventory/inventory-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { parseInventoryFilters } from "@/lib/inventory/filters";
import { signInventoryFiles } from "@/lib/inventory/order-files";
import { listAllInventoryItems, listInventoryVocab } from "@/lib/inventory/store";
import { listExpenseJobs, splitPickerJobs } from "@/lib/receipts";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function InventoryPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireActiveUser();
  const filters = parseInventoryFilters(await searchParams);
  const [rawItems, statuses, storageStates, allJobs] = await Promise.all([
    listAllInventoryItems(),
    listInventoryVocab("status"),
    listInventoryVocab("storage"),
    listExpenseJobs({ includeInactive: true }),
  ]);
  // New assignments offer Open projects only; items on a Closed project keep their label.
  const { pickable: jobs, linkedLabels } = splitPickerJobs(
    allJobs,
    rawItems.map((item) => item.jobId),
  );
  // Full list stays on the client so sort, filter, and search do not reload the page.
  // Revisit around 2,000 rows, when shipping every signed photo URL on first load
  // is no longer cheaper than a paged query.
  const signedPhotos = await signInventoryFiles(
    rawItems.flatMap((item) => (item.photoStoragePath ? [item.photoStoragePath] : [])),
  );
  const rows = rawItems.map((item) => {
    if (!item.photoStoragePath) return item;
    const photoUrl = signedPhotos.get(item.photoStoragePath);
    return photoUrl ? { ...item, photoUrl } : item;
  });
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
        rows={rows}
        filters={filters}
        statuses={statuses}
        storageStates={storageStates}
        jobs={jobs.map((job) => ({ id: job.id, label: job.label }))}
        linkedJobLabels={linkedLabels}
        projectOptions={[...projectOptions.entries()].map(([value, label]) => ({ value, label }))}
        vendors={vendors}
        orderNumbers={orderNumbers}
        isAdmin={isAdminRole(user.profile.role)}
      />
    </AppShell>
  );
}
