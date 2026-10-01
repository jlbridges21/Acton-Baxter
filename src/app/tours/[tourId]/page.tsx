import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { TourEditor } from "@/components/tours/tour-editor";
import { requireActiveUser } from "@/lib/auth/session";
import { getTour } from "@/lib/tours/store";

export const dynamic = "force-dynamic";

export default async function TourEditorPage({ params }: { params: Promise<{ tourId: string }> }) {
  const user = await requireActiveUser();
  const { tourId } = await params;
  const { tour, error } = await getTour(tourId);
  if (!tour) {
    if (error === "That tour was not found.") notFound();
    return (
      <AppShell user={user}>
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell user={user}>
      <TourEditor tour={tour} />
    </AppShell>
  );
}
