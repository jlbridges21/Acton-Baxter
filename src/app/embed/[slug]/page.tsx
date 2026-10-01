import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TourStage } from "@/components/tours/tour-stage";
import { embedChrome } from "@/lib/tours/embed-chrome";
import { getPublicTourBySlug } from "@/lib/tours/public-tour";

// Next.js reads this export statically and rejects an imported identifier.
// Keep the number equal to TOUR_PAGE_REVALIDATE_SECONDS (3600).
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tour = await getPublicTourBySlug(slug);
  return {
    title: tour?.title ?? "Tour",
    robots: { index: false, follow: false },
  };
}

export default async function EmbedTourPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const tour = await getPublicTourBySlug(slug);
  if (!tour) notFound();
  return <TourStage tour={tour} chrome={embedChrome(await searchParams)} />;
}
