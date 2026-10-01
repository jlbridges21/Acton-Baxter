import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { TourEditor } from "@/components/tours/tour-editor";
import { requireActiveUser } from "@/lib/auth/session";
import { getViewerTour } from "@/lib/tours/store";

export const dynamic = "force-dynamic";

export default async function TourEditorPage({ params }: { params: Promise<{ tourId: string }> }) {
  const user = await requireActiveUser();
  const { tourId } = await params;
  const tour = await getViewerTour(tourId);
  if (!tour) notFound();

  return (
    <AppShell user={user} width="full">
      <TourEditor tour={tour} />
    </AppShell>
  );
}
