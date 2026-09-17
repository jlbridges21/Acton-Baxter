import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { createReceipt, parseAmountToCents, receiptSubmitSchema } from "@/lib/receipts";

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser();
    const rate = checkRateLimit(`receipt-create:${user.id}`, { limit: 30, windowMs: 60_000 });
    if (!rate.allowed) throw new RateLimitError();

    const body = await request.json();
    const parsed = receiptSubmitSchema.parse(body);
    const amountCents = parseAmountToCents(parsed.amount);

    const receipt = await createReceipt({
      jobId: parsed.jobId,
      amountCents,
      vendor: parsed.vendor,
      purchasedOn: parsed.purchasedOn,
      items: parsed.items ?? null,
      description: parsed.description ?? null,
      photoStoragePath: parsed.photoStoragePath ?? null,
      extraction: parsed.extraction ?? null,
      submittedBy: user.id,
    });

    return jsonOk({ receipt });
  } catch (error) {
    return jsonError(error, "POST /api/receipts");
  }
}
