import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TourStage } from "@/components/tours/tour-stage";
import { coverThumbUrl } from "@/lib/tours/map-tour";
import { getPublicTourBySlug } from "@/lib/tours/public-tour";
import { getPublicAppBaseUrl } from "@/lib/slack/config";

// Next.js reads this export statically and rejects an imported identifier.
// Keep the number equal to TOUR_PAGE_REVALIDATE_SECONDS (3600).
export const revalidate = 3600;

const OPEN_CHROME = {
  showTitle: true,
  showThumbs: true,
  showShare: true,
  showFullscreen: true,
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tour = await getPublicTourBySlug(slug);
  if (!tour) return { title: "Tour" };
  const thumb = coverThumbUrl(tour);
  const image = thumb ? `${getPublicAppBaseUrl()}${thumb}` : null;
  return {
    title: tour.title,
    description: tour.description ?? undefined,
    openGraph: {
      title: tour.title,
      description: tour.description ?? undefined,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: tour.title,
      description: tour.description ?? undefined,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function PublicTourPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tour = await getPublicTourBySlug(slug);
  if (!tour) notFound();
  return <TourStage tour={tour} chrome={OPEN_CHROME} />;
}
