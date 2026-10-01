import { NextResponse } from "next/server";
import { isAppAccessRole } from "@/lib/auth/roles";
import { getOptionalUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/admin";
import { TOUR_VIEWER_SIGNED_URL_SECONDS } from "@/lib/tours/constants";
import {
  parseTourImageVariant,
  sceneFileForVariant,
  tourImageCacheControl,
  tourImageDecision,
} from "@/lib/tours/image-access";
import { createTourPanoramaSignedUrl } from "@/lib/tours/storage";

export const dynamic = "force-dynamic";

type TourEmbed = { slug: string; is_public: boolean } | { slug: string; is_public: boolean }[];

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function missing(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; sceneId: string }> },
): Promise<NextResponse> {
  const { slug, sceneId } = await context.params;
  const variant = parseTourImageVariant(new URL(request.url).searchParams.get("variant"));
  if (!variant || !/^[0-9a-f-]{36}$/i.test(sceneId)) return missing();

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("scenes")
    .select(
      "id, storage_path, compat_path, thumbnail_path, tours!scenes_tour_id_fkey(slug, is_public)",
    )
    .eq("id", sceneId)
    .maybeSingle();
  if (error || !data) return missing();

  const tour = one(data.tours as TourEmbed | null);
  const isPublic = Boolean(tour?.is_public);
  let isAppUser = false;
  if (!isPublic) {
    const user = await getOptionalUser();
    isAppUser = Boolean(user && isAppAccessRole(user.profile.role));
  }
  if (
    tourImageDecision({
      found: true,
      slugMatches: tour?.slug === slug,
      isPublic,
      isAppUser,
    }) === "not-found"
  ) {
    return missing();
  }

  const file = sceneFileForVariant(variant, {
    storagePath: data.storage_path as string,
    compatPath: (data.compat_path as string | null) ?? null,
    thumbnailPath: (data.thumbnail_path as string | null) ?? null,
  });
  if (!file) return missing();

  const signed = await createTourPanoramaSignedUrl(file, TOUR_VIEWER_SIGNED_URL_SECONDS);
  if (!signed) return missing();

  const response = NextResponse.redirect(signed, 302);
  response.headers.set("Cache-Control", tourImageCacheControl(isPublic));
  return response;
}
