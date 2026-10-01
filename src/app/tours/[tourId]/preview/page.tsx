import { notFound } from "next/navigation";
import { TourStage } from "@/components/tours/tour-stage";
import { requireActiveUser } from "@/lib/auth/session";
import { getViewerTour } from "@/lib/tours/store";

export const dynamic = "force-dynamic";

const OPEN_CHROME = {
  showTitle: true,
  showThumbs: true,
  showShare: true,
  showFullscreen: true,
};

export default async function TourPreviewPage({ params }: { params: Promise<{ tourId: string }> }) {
  await requireActiveUser();
  const { tourId } = await params;
  const tour = await getViewerTour(tourId);
  if (!tour) notFound();
  return <TourStage tour={tour} chrome={OPEN_CHROME} preview />;
}
