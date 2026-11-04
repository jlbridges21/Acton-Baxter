import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { CONFIGURATOR_GHL_FIELDS, syncConfigurationToGhl } from "@/lib/configurator/ghl-sync";
import { enforceRateLimit } from "@/lib/configurator/request-context";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  contactId: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9]*$/)
    .optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  fields: z.record(z.enum(CONFIGURATOR_GHL_FIELDS), z.string().max(2000)),
});

/** Attach the configuration to the GHL contact that just submitted an embedded form. */
export async function POST(request: Request) {
  try {
    enforceRateLimit(request, "ghl-sync", 10);
    const body = bodySchema.parse(await request.json());
    const result = await syncConfigurationToGhl({
      contactId: body.contactId || undefined,
      email: body.email || undefined,
      phone: body.phone || undefined,
      fields: body.fields,
    });
    return NextResponse.json(
      { status: result.status },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error, "POST /api/public/configurator/ghl-sync");
  }
}
