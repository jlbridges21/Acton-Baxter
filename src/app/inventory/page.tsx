import { AppShell } from "@/components/layout/app-shell";
import {
  InventoryClient,
  type InventoryProjectOption,
} from "@/components/inventory/inventory-client";
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
  // Open and Closed projects are offered (the client filters by status); items on a
  // hidden or unknown-status project keep their label.
  const { pickable: jobs, linkedLabels } = splitPickerJobs(
    allJobs,
    rawItems.map((item) => item.jobId),
    { allowClosed: true },
  );
  const jobStatusById = new Map(
    allJobs.map((job) => [job.id, job.source === "project" ? job.projectStatus : null]),
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
  const projectOptions = new Map<string, InventoryProjectOption>();
  for (const job of jobs) {
    projectOptions.set(job.id, {
      value: job.id,
      label: job.label,
      projectStatus: jobStatusById.get(job.id) ?? null,
    });
  }
  for (const item of rawItems) {
    if (item.jobId) {
      projectOptions.set(item.jobId, {
        value: item.jobId,
        label: item.projectLabel,
        projectStatus: jobStatusById.get(item.jobId) ?? null,
      });
    }
    if (item.customProjectLabel) {
      const value = `custom:${item.customProjectLabel}`;
      projectOptions.set(value, { value, label: item.customProjectLabel, projectStatus: null });
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
        jobs={jobs.map((job) => ({
          id: job.id,
          label: job.label,
          projectStatus: jobStatusById.get(job.id) ?? null,
        }))}
        linkedJobLabels={linkedLabels}
        projectOptions={[...projectOptions.values()]}
        vendors={vendors}
        orderNumbers={orderNumbers}
        isAdmin={isAdminRole(user.profile.role)}
      />
    </AppShell>
  );
}
