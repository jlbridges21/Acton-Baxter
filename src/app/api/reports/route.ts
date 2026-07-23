import { requireUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { createReportRequestSchema } from "@/lib/address/schemas";
import {
  createPropertyReport,
  createPropertyReportFromAddress,
} from "@/lib/research/create-property-report";
import { getReportStore } from "@/lib/research/report-store";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const rate = checkRateLimit(`create-report:${user.id}`, { limit: 20, windowMs: 60_000 });
    if (!rate.allowed) {
      throw new RateLimitError();
    }

    const body = await request.json();
    const parsed = createReportRequestSchema.parse(body);

    const result =
      typeof parsed.address === "string"
        ? await createPropertyReport(parsed.address, user.id)
        : await createPropertyReportFromAddress(parsed.address, user.id);

    return jsonOk(result, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/reports");
  }
}

export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? undefined;
    const status = searchParams.get("status") ?? undefined;
    const reports = await getReportStore().listReports({ query, status });
    return jsonOk({ reports });
  } catch (error) {
    return jsonError(error, "GET /api/reports");
  }
}
