import { AppShell } from "@/components/layout/app-shell";
import { ToursDashboard } from "@/components/tours/tours-dashboard";
import { requireActiveUser } from "@/lib/auth/session";
import { listTours } from "@/lib/tours/store";

export const dynamic = "force-dynamic";

export default async function ToursPage() {
  const user = await requireActiveUser();
  const { tours, error } = await listTours();

  return (
    <AppShell user={user}>
      <ToursDashboard tours={tours} loadError={error} />
    </AppShell>
  );
}
