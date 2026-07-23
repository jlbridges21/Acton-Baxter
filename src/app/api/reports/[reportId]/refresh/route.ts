import { requireUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { NotFoundError, ValidationError, RateLimitError } from "@/lib/errors";
import { runPropertyResearch } from "@/lib/research/run-property-research";
import { getReportStore } from "@/lib/research/report-store";
import { checkRateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/utils";

type RouteContext = {
  params: Promise<{ reportId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const rate = checkRateLimit(`refresh-report:${user.id}`, { limit: 5, windowMs: 60_000 });
    if (!rate.allowed) throw new RateLimitError();

    const { reportId } = await context.params;
    if (!isUuid(reportId)) throw new ValidationError("Invalid report id");

    const existing = await getReportStore().getReport(reportId);
    if (!existing) throw new NotFoundError("Report not found");

    const child = await getReportStore().createReport({
      createdBy: user.id,
      inputAddress: existing.input_address,
      standardizedAddress: existing.standardized_address ?? existing.input_address,
      reportVersion: existing.report_version,
      googlePlaceId: existing.google_place_id ?? null,
      addressLine1: existing.address_line_1 ?? null,
      mailingLocality: existing.mailing_locality ?? null,
      zipCode: existing.zip_code ?? null,
      countryCode: existing.country_code ?? null,
      latitude: existing.latitude,
      longitude: existing.longitude,
      parentReportId: reportId,
      refreshReason: "Refresh live research",
    });

    void runPropertyResearch(child.id).catch((error) => {
      console.error("[refresh] failed", error);
    });

    return jsonOk({ reportId: child.id, status: "researching", parentReportId: reportId });
  } catch (error) {
    return jsonError(error, "POST /api/reports/[reportId]/refresh");
  }
}
