import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { findRecentDuplicateReceipt, parseAmountToCents } from "@/lib/receipts";

export const runtime = "nodejs";

const querySchema = z.object({
  vendor: z.string().trim().min(1).max(200),
  amount: z.string().min(1),
});

/** Soft duplicate warning — never blocks submit. */
export async function GET(request: Request) {
  try {
    const user = await requireActiveUser();
    const url = new URL(request.url);
    const parsed = querySchema.parse({
      vendor: url.searchParams.get("vendor") ?? "",
      amount: url.searchParams.get("amount") ?? "",
    });
    const amountCents = parseAmountToCents(parsed.amount);
    const duplicate = await findRecentDuplicateReceipt({
      userId: user.id,
      vendor: parsed.vendor,
      amountCents,
    });

    return jsonOk({
      duplicate: duplicate
        ? {
            id: duplicate.id,
            vendor: duplicate.vendor,
            amountCents: duplicate.amountCents,
            purchasedOn: duplicate.purchasedOn,
            createdAt: duplicate.createdAt,
          }
        : null,
    });
  } catch (error) {
    return jsonError(error, "GET /api/receipts/duplicates");
  }
}
