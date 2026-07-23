import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveAddressInput } from "@/lib/address/resolve";
import { selectedAddressSchema } from "@/lib/address/schemas";

const resolveBodySchema = z.union([
  z.object({
    query: z.string().trim().min(5).max(300),
  }),
  z.object({
    address: z.union([z.string().trim().min(5).max(300), selectedAddressSchema]),
  }),
]);

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const rate = checkRateLimit(`address-resolve:${user.id}`, { limit: 40, windowMs: 60_000 });
    if (!rate.allowed) {
      throw new RateLimitError();
    }

    const body = await request.json();
    const parsed = resolveBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid address resolve request",
      );
    }

    const input =
      "query" in parsed.data
        ? parsed.data.query
        : typeof parsed.data.address === "string"
          ? parsed.data.address
          : parsed.data.address;

    const result = await resolveAddressInput(input);
    return jsonOk(result);
  } catch (error) {
    return jsonError(error, "POST /api/address/resolve");
  }
}
