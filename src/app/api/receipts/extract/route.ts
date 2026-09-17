import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { extractReceiptFromStoragePath, extractionToFormPrefill } from "@/lib/receipts";

export const runtime = "nodejs";

const bodySchema = z.object({
  storagePath: z.string().trim().min(1).max(500),
});

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser();
    const rate = checkRateLimit(`receipt-extract:${user.id}`, { limit: 15, windowMs: 60_000 });
    if (!rate.allowed) throw new RateLimitError();

    const parsed = bodySchema.parse(await request.json());
    // Photos are stored under `${userId}/...` — reject cross-user paths.
    if (!parsed.storagePath.startsWith(`${user.id}/`)) {
      throw new ValidationError("Invalid receipt photo path");
    }

    const result = await extractReceiptFromStoragePath({
      storagePath: parsed.storagePath,
    });

    if (!result.ok) {
      return jsonOk({
        status: "failed" as const,
        error: result.error,
        extraction: null,
        prefill: null,
        usable: false,
      });
    }

    return jsonOk({
      status: result.usable ? ("ok" as const) : ("empty" as const),
      error: null,
      extraction: result.extraction,
      prefill: extractionToFormPrefill(result.extraction),
      usable: result.usable,
      correctionAttempted: result.correctionAttempted,
    });
  } catch (error) {
    return jsonError(error, "POST /api/receipts/extract");
  }
}
