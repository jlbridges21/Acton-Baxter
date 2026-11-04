import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { isAdminPreview } from "@/lib/configurator/request-context";
import { loadPublicCatalog } from "@/lib/configurator/server";

export const dynamic = "force-dynamic";

/** Customer catalog (no prices). `?preview=draft` returns the draft for signed-in admins. */
export async function GET(request: Request) {
  try {
    const preview = await isAdminPreview(
      new URL(request.url).searchParams.get("preview") === "draft",
    );
    const catalog = await loadPublicCatalog({ preview });
    if (!catalog) {
      return NextResponse.json(
        {
          error: { code: "NOT_PUBLISHED", message: "The configurator has not been published yet." },
        },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(catalog, {
      headers: {
        "Cache-Control": preview
          ? "private, no-store"
          : "public, max-age=0, s-maxage=30, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    return jsonError(error, "GET /api/public/configurator/catalog");
  }
}
