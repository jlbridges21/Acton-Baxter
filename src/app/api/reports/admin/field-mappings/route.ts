import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import {
  buildFieldMappingReport,
  mappingSchemaReady,
  queryMappings,
  resolveMappingReview,
  revalidateFieldMappings,
  setFieldReporting,
} from "@/lib/reports/field-mappings";
import { requireReportsAdmin } from "@/lib/reports/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Field Mapping Health: counts, search/filter, and one field's detail (?ref=). Admins only. */
export async function GET(request: Request) {
  try {
    await requireReportsAdmin();
    const url = new URL(request.url);
    const param = (k: string, max = 80) => url.searchParams.get(k)?.slice(0, max) || undefined;
    const [report, schemaReady] = await Promise.all([
      buildFieldMappingReport(),
      mappingSchemaReady(),
    ]);
    const ref = param("ref", 100);
    if (ref) {
      const result = report.results.find((r) => r.ref === ref);
      return jsonOk({ result: result ?? null, schemaReady, validatedAt: report.validatedAt });
    }
    const kind = param("kind");
    const page = queryMappings(report.results, {
      search: param("search"),
      entity: param("entity", 40),
      status: param("status", 40),
      exclusion: param("exclusion", 40),
      kind: kind === "field" || kind === "alias" ? kind : undefined,
      issuesOnly: url.searchParams.get("issues") === "1",
      offset: Number(url.searchParams.get("offset") ?? 0) || 0,
      limit: 100,
    });
    return jsonOk({
      ...page,
      summary: report.summary,
      validatedAt: report.validatedAt,
      organizationId: report.organizationId,
      schemaReady,
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/admin/field-mappings");
  }
}

const refSchema = z.string().regex(/^(cf|sem):[A-Za-z0-9_-]{1,80}$/);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revalidate") }),
  z.object({
    action: z.literal("set_reporting"),
    ref: refSchema,
    enabled: z.boolean(),
    note: z.string().max(300).nullish(),
  }),
  z.object({
    action: z.literal("resolve_review"),
    ref: refSchema,
    resolution: z.enum(["confirm", "repoint"]),
    fieldId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,80}$/)
      .nullish(),
    note: z.string().max(300).nullish(),
  }),
]);

/** Revalidate, include/exclude an eligible field, or resolve a review. Admins only; audited. */
export async function POST(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const body = bodySchema.parse(await request.json());
    const who = { userId: ctx.user.id, label: ctx.requester.label };
    if (body.action === "revalidate") {
      const r = await revalidateFieldMappings(who);
      return jsonOk({ summary: r.summary, validatedAt: r.validatedAt, persisted: r.persisted });
    }
    if (body.action === "set_reporting")
      return jsonOk({
        result: await setFieldReporting({
          ...who,
          ref: body.ref,
          enabled: body.enabled,
          note: body.note,
        }),
      });
    return jsonOk({
      result: await resolveMappingReview({
        ...who,
        ref: body.ref,
        action: body.resolution,
        fieldId: body.fieldId,
        note: body.note,
      }),
    });
  } catch (error) {
    return jsonError(error, "POST /api/reports/admin/field-mappings");
  }
}
