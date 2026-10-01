import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TourStage } from "@/components/tours/tour-stage";
import { TOUR_PAGE_REVALIDATE_SECONDS } from "@/lib/tours/constants";
import { embedChrome } from "@/lib/tours/embed-chrome";
import { getPublicTourBySlug } from "@/lib/tours/public-tour";

export const revalidate = TOUR_PAGE_REVALIDATE_SECONDS;

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
