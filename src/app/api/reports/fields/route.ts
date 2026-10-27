import { jsonError, jsonOk } from "@/lib/api";
import { canSeeField } from "@/lib/reports/access";
import { getFieldCatalog, resolveField } from "@/lib/reports/fields";
import { requireReportsContext } from "@/lib/reports/http";
import type { ReportSource } from "@/lib/reports/spec";

export const dynamic = "force-dynamic";

/** Fields this user may put in a report (restricted categories are omitted entirely). */
export async function GET() {
  try {
    const ctx = await requireReportsContext();
    const catalog = await getFieldCatalog();
    const visible = (source: ReportSource) =>
      catalog.bySource[source]
        .filter((f) => canSeeField(ctx.access, f))
        .map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          multi: Boolean(f.multi),
          description: f.description ?? null,
          origin: f.origin,
        }));
    const business = [...catalog.semantic.entries()]
      .map(([key, s]) => {
        const r = resolveField(catalog, key);
        return r.ok && canSeeField(ctx.access, r.def)
          ? {
              key,
              label: s.label,
              type: r.def.type,
              multi: Boolean(r.def.multi),
              description: s.description,
              origin: r.def.origin,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.label.localeCompare(b.label));
    return jsonOk({
      jobs: { business, all: visible("jobs") },
      catalog_models: { business: [], all: visible("catalog_models") },
      cost_items: { business: [], all: visible("cost_items") },
      commissions: { business: [], all: visible("commissions") },
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/fields");
  }
}
