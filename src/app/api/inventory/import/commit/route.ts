import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { commitInventoryImport } from "@/lib/inventory/import-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const commitSchema = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    vendor: z.string().trim().min(1).max(200).default("build.com"),
    orderNumber: z.string().trim().max(80).nullable(),
    jobId: z.string().uuid().nullable(),
    customProjectLabel: z.string().trim().max(300).nullable(),
    allowDuplicate: z.boolean().default(false),
    lines: z
      .array(
        z.object({
          itemName: z.string().trim().min(1),
          sku: z.string().trim().min(1),
          description: z.string().trim().max(2000).nullable().optional(),
          quantity: z.number().int().min(1),
          unitCostCents: z.number().int().min(0),
          productUrl: z.string().trim().max(2000).nullable().optional(),
          photoStoragePath: z.string().trim().max(300).nullable().optional(),
        }),
      )
      .min(1),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser();
    const body = commitSchema.parse(await request.json());
    const result = await commitInventoryImport({ ...body, actorId: user.id });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/inventory/import/commit");
  }
}
