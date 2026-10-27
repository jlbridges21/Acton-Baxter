import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { previewCalculation } from "@/lib/reports/calc-preview";
import { requireReportsContext } from "@/lib/reports/http";
import { calculationSchema } from "@/lib/reports/spec";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  calculation: z.unknown(),
  groupBy: z.string().max(80).optional(),
  ruleSet: z.string().max(60).optional(),
});

/** Validate and preview a calculation on real data (read-only). */
export async function POST(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const body = bodySchema.parse(await request.json());
    const parsed = calculationSchema.safeParse(body.calculation);
    if (!parsed.success)
      return jsonOk({ ok: false, problem: parsed.error.issues.map((i) => i.message).join(" ") });
    return jsonOk(
      await previewCalculation({
        calculation: parsed.data,
        access: ctx.access,
        groupBy: body.groupBy || undefined,
        ruleSet: body.ruleSet || undefined,
      }),
    );
  } catch (error) {
    return jsonError(error, "POST /api/reports/metrics/preview");
  }
}
