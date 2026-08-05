import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { buildGoogleStaticImageUrl } from "@/lib/providers/google/imagery";
import { getReportStore } from "@/lib/research/report-store";
import { isUuid } from "@/lib/utils";

type RouteContext = {
  params: Promise<{ reportId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireActiveUser();
    const { reportId } = await context.params;
    if (!isUuid(reportId)) {
      throw new ValidationError("Invalid report id");
    }

    const viewParam = new URL(request.url).searchParams.get("view") ?? "satellite";
    const view =
      viewParam === "street"
        ? "street"
        : viewParam === "roadmap"
          ? "roadmap"
          : viewParam === "parcel"
            ? "parcel"
            : "satellite";

    const store = getReportStore();
    const report = await store.getReport(reportId);
    if (!report) {
      return NextResponse.json({ error: { message: "Report not found" } }, { status: 404 });
    }

    const latitude = report.latitude;
    const longitude = report.longitude;
    if (latitude == null || longitude == null) {
      return NextResponse.json(
        { error: { message: "Report coordinates unavailable for imagery" } },
        { status: 404 },
      );
    }

    const parcelGeometry =
      view === "parcel" ? (await store.getFullReport(reportId))?.parcelGeometry : null;
    const upstream = buildGoogleStaticImageUrl({
      view,
      latitude,
      longitude,
      width: 640,
      height: 420,
      parcelGeometry:
        view === "parcel"
          ? (parcelGeometry?.geometry_geojson as { type?: unknown; coordinates?: unknown } | null)
          : null,
    });
    if (!upstream) {
      return NextResponse.json(
        {
          error: {
            message:
              view === "parcel"
                ? "Parcel geometry or Google Maps imagery is not configured"
                : "Google Maps imagery is not configured",
          },
        },
        { status: 503 },
      );
    }

    const imageResponse = await fetch(upstream, {
      // Cache aerials briefly; Street View can change but is fine for sales prep.
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: { message: "Unable to load Google property imagery" } },
        { status: 502 },
      );
    }

    const contentType = imageResponse.headers.get("content-type") ?? "image/jpeg";
    const bytes = await imageResponse.arrayBuffer();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/[reportId]/imagery");
  }
}
