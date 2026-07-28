import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError, AppError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { createPemNeatInputSchema } from "@/lib/pem-neat/schemas";
import { getPemNeatStore } from "@/lib/pem-neat/store";
import { startPemNeatGeneration } from "@/lib/pem-neat/run-generation";
import { resolveSalespersonDisplayName } from "@/lib/pem-neat/salespeople";

export const maxDuration = 800;

export async function GET(request: Request) {
  try {
    await requireActiveUser();
    const { searchParams } = new URL(request.url);
    const items = await getPemNeatStore().list({
      query: searchParams.get("q") ?? undefined,
      salespersonUserId: searchParams.get("salesperson") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      outcome: searchParams.get("outcome") ?? undefined,
    });
    return jsonOk({ items });
  } catch (error) {
    return jsonError(error, "GET /api/pem-neats");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser();
    const rate = checkRateLimit(`pem-neat-create:${user.id}`, { limit: 10, windowMs: 60_000 });
    if (!rate.allowed) {
      throw new RateLimitError();
    }

    const body = await request.json();
    const parsed = createPemNeatInputSchema.parse(body);
    const salesperson = await resolveSalespersonDisplayName(parsed.salespersonUserId);
    if (!salesperson) {
      throw new AppError("Select a valid salesperson from the Sales department", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const store = getPemNeatStore();
    const record = await store.create({
      prospectName: parsed.prospectName,
      salespersonUserId: parsed.salespersonUserId,
      salespersonDisplayName: salesperson.displayName,
      meetingDate: parsed.meetingDate ?? null,
      transcript: parsed.transcript,
      createdBy: user.id,
    });

    const started = await startPemNeatGeneration(record.id);
    return jsonOk({
      id: started.id,
      status: started.status,
      jobId: started.jobId,
    });
  } catch (error) {
    return jsonError(error, "POST /api/pem-neats");
  }
}
