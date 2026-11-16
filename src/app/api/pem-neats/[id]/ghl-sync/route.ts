import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError, NotFoundError, RateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import { getContactById } from "@/lib/connectors/ghl/resources/contacts";
import { buildPemNeatGhlPayload, countFilledGhlFields } from "@/lib/pem-neat/ghl-sync-payload";
import { postPemNeatToGhlWebhook } from "@/lib/pem-neat/ghl-sync";
import { buildertrendFieldsSchema, type BuildertrendFields } from "@/lib/pem-neat/schemas";
import { getPemNeatStore } from "@/lib/pem-neat/store";
import type { PemNeatRecord } from "@/lib/pem-neat/types";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    contactId: z
      .string()
      .trim()
      .max(64)
      .regex(/^[A-Za-z0-9]*$/)
      .optional(),
    email: z.string().trim().email().max(200).optional().or(z.literal("")),
    phone: z.string().trim().max(40).optional(),
  })
  .refine((b) => Boolean(b.contactId || b.email || b.phone?.replace(/\D/g, "")), {
    message: "Choose a GoHighLevel contact, or enter the customer's email or phone.",
  });

function resolveFields(item: PemNeatRecord): BuildertrendFields {
  const structured = item.structured_result as { buildertrendFields?: unknown } | null;
  const raw = structured?.buildertrendFields ?? item.buildertrend_fields;
  const parsed = buildertrendFieldsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : buildertrendFieldsSchema.parse({});
}

/** Push the PEM NEAT's BuilderTrend handoff fields to the GHL contact via webhook. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireActiveUser();
    const rate = checkRateLimit(`pem-neat-ghl-sync:${user.id}`, { limit: 10, windowMs: 60_000 });
    if (!rate.allowed) throw new RateLimitError();

    const { id } = await context.params;
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const item = await getPemNeatStore().get(id);
    if (!item) throw new NotFoundError("PEM NEAT not found");
    if (item.status === "generating") {
      throw new AppError("Wait for generation to finish before syncing.", {
        code: "PEM_NEAT_GENERATING",
        statusCode: 409,
      });
    }

    const fields = resolveFields(item);
    if (countFilledGhlFields(fields) === 0) {
      throw new AppError("This PEM NEAT has no BuilderTrend field values to sync yet.", {
        code: "PEM_NEAT_NO_FIELDS",
        statusCode: 409,
      });
    }

    let email = parsed.data.email || null;
    let phone = parsed.data.phone?.trim() || null;
    let name: string | null = null;
    const contactId = parsed.data.contactId || null;

    // A picked contact is authoritative: re-read it so the webhook gets its real email/phone.
    if (contactId && isGhlConfigured()) {
      const contact = await getContactById(contactId);
      if (!contact) throw new NotFoundError("That contact was not found in GoHighLevel.");
      email = contact.email ?? email;
      phone = contact.phone ?? phone;
      name =
        contact.name?.trim() ||
        [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
        null;
    }

    const origin = new URL(request.url).origin;
    const payload = buildPemNeatGhlPayload({
      pemNeatId: item.id,
      pemNeatUrl: `${origin}/pem-neats/${item.id}`,
      prospectName: item.prospect_name,
      salesperson: item.salesperson_display_name,
      meetingDate: item.meeting_date,
      fields,
      contact: { contactId, email, phone, name },
      syncedBy: user.profile.full_name || user.email,
    });

    await postPemNeatToGhlWebhook(payload);

    console.info("[pem-neat] synced to GHL", {
      id: item.id,
      contactId,
      hasEmail: Boolean(email),
      hasPhone: Boolean(phone),
      filled: countFilledGhlFields(fields),
    });

    return jsonOk({
      synced: true,
      syncedAt: payload.synced_at,
      filledFields: countFilledGhlFields(fields),
      contact: { contactId, name, email, phone },
    });
  } catch (error) {
    return jsonError(error, "POST /api/pem-neats/[id]/ghl-sync");
  }
}
