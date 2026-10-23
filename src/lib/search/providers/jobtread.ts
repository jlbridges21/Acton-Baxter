/**
 * JobTread jobs — from Baxter's JobTread cache (jt_jobs, filled by the Reports sync), indexed
 * into global_search_index. Never calls JobTread per keystroke.
 *
 * Access follows Reports: viewing jobs needs the "general" Reports category (Dexter access);
 * customer-category custom fields need "customer"; financial fields are never searched or shown.
 * Which custom fields are searchable comes from the semantic field mapping admins already
 * manage in Reports → Data settings (Phase, Status, Project Manager, Model, …).
 *
 * Results say "JobTread · Last synced …" from the row's own sync time — they are a cache.
 */

import "server-only";

import { agentDb, inList } from "@/lib/agents/store";
import type { CustomFieldRow, SemanticFieldRow } from "@/lib/jobtread/metadata";
import type { SearchContext } from "../context";
import { formatAddress } from "../normalize";
import type { IndexDoc, ProviderHit, SearchProvider } from "../provider";
import { safeId } from "../safety";
import { indexedSearch } from "./indexed";

const JT_ID = /^[A-Za-z0-9]{6,40}$/;

/** Semantic fields offered as searchable (admin-mapped to custom fields in Reports). */
const SEMANTIC_SEARCHABLE: Array<{ key: string; label: string; preview?: boolean; on: boolean }> = [
  { key: "phase", label: "Phase", preview: true, on: true },
  { key: "status", label: "Status", preview: true, on: true },
  { key: "project_manager", label: "Project Manager", preview: true, on: true },
  { key: "model", label: "Model", preview: true, on: true },
  { key: "job_type", label: "Job Type", on: true },
  { key: "sales_rep", label: "Sales Rep", on: true },
  { key: "site_supervisor", label: "Site Supervisor", on: false },
  { key: "design_coordinator", label: "Design Coordinator", on: false },
  { key: "permit_status", label: "Permit Status", on: false },
  { key: "contract_type", label: "Contract Type", on: false },
];

type JobRow = {
  id: string;
  number: string | null;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  customer_name: string | null;
  job_fields: Record<string, string[]>;
  location_fields: Record<string, string[]>;
  customer_fields: Record<string, string[]>;
  synced_at: string;
  removed_at: string | null;
};

type FieldMeta = {
  label: string;
  category: CustomFieldRow["category"];
  cfId: string;
  semantic: string;
};

async function semanticFieldMeta(): Promise<FieldMeta[]> {
  const db = agentDb();
  const [semantic, custom] = await Promise.all([
    db.select<SemanticFieldRow>("jt_semantic_fields", { limit: 500 }),
    db.select<CustomFieldRow>("jt_custom_fields", {
      filters: [{ col: "removed_at", op: "is_null" }],
      limit: 2000,
    }),
  ]);
  const byId = new Map(custom.map((c) => [c.id, c]));
  const out: FieldMeta[] = [];
  for (const s of semantic) {
    if (!s.custom_field_id) continue;
    const cf = byId.get(s.custom_field_id);
    if (!cf) continue;
    out.push({ label: s.label, category: cf.category, cfId: cf.id, semantic: s.key });
  }
  return out;
}

function fieldValue(row: JobRow, cfId: string): string | null {
  const v = row.job_fields?.[cfId] ?? row.location_fields?.[cfId] ?? row.customer_fields?.[cfId];
  return v && v.length ? v.join(", ").slice(0, 200) : null;
}

function enabledSemantic(fields: Set<string>) {
  return new Set(SEMANTIC_SEARCHABLE.filter((f) => fields.has(`sem:${f.key}`)).map((f) => f.key));
}

function jobHit(
  row: JobRow,
  meta: FieldMeta[],
  categories: Set<string>,
  fields: Set<string>,
): ProviderHit | null {
  const id = safeId(row.id, JT_ID);
  if (!id || row.removed_at) return null;
  const semantics = enabledSemantic(fields);
  const visible = meta.filter(
    (m) =>
      semantics.has(m.semantic) &&
      m.category !== "excluded" &&
      m.category !== "financial" &&
      categories.has(m.category),
  );
  const values = visible.map((m) => ({ m, value: fieldValue(row, m.cfId) })).filter((x) => x.value);
  const previewKeys = new Set(SEMANTIC_SEARCHABLE.filter((f) => f.preview).map((f) => f.key));
  const address = {
    line1: row.address,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
  };
  const display = fields.has("address") ? formatAddress(address) : null;
  const customer = fields.has("customer") ? row.customer_name : null;
  const number = row.number ? `#${row.number}` : null;
  return {
    recordId: id,
    title: row.name,
    subtitle: [number, customer].filter(Boolean).join(" · ") || null,
    description: display,
    breadcrumb: ["JobTread", "Jobs"],
    url: `https://app.jobtread.com/jobs/${encodeURIComponent(id)}`,
    icon: "folder-kanban",
    updatedAt: row.synced_at,
    freshness: { kind: "cached", syncedAt: row.synced_at, label: "Last synced" },
    preview: values
      .filter((x) => previewKeys.has(x.m.semantic))
      .map((x) => ({ label: x.m.label, value: x.value })),
    auth: "role",
    actions: [
      {
        kind: "open",
        label: "View JobTread source",
        href: `https://app.jobtread.com/jobs/${encodeURIComponent(id)}`,
        external: true,
      },
      ...(row.number
        ? [{ kind: "copy" as const, label: "Copy job number", value: row.number }]
        : []),
    ],
    address: display ? address : undefined,
    match: {
      title: row.name,
      subtitle: customer,
      identifiers: [row.number, row.id],
      addresses: [display],
      fields: [customer, ...values.map((x) => x.value)],
    },
  };
}

export const jobtreadJobsProvider: SearchProvider = {
  id: "jobtread-jobs",
  category: "jobs",
  name: "JobTread jobs",
  icon: "folder-kanban",
  sourceSystem: "jobtread",
  description:
    "Jobs from Baxter's JobTread sync: name, number, customer, address, and mapped fields.",
  searchableFields: [
    { key: "name", label: "Job name & number", sensitivity: "standard", defaultEnabled: true },
    { key: "customer", label: "Customer", sensitivity: "standard", defaultEnabled: true },
    { key: "address", label: "Address", sensitivity: "standard", defaultEnabled: true },
    ...SEMANTIC_SEARCHABLE.map((f) => ({
      key: `sem:${f.key}`,
      label: `${f.label} (mapped custom field)`,
      sensitivity: "standard" as const,
      defaultEnabled: f.on,
    })),
    {
      key: "financial",
      label: "Prices, costs & margins",
      sensitivity: "restricted",
      defaultEnabled: false,
    },
    {
      key: "internal",
      label: "Internal sales notes",
      sensitivity: "restricted",
      defaultEnabled: false,
    },
  ],
  optional: true,
  indexing: "index",
  permissionSummary:
    "Requires Reports access (Dexter). Customer-category fields need Customer details access; financial fields are never searchable.",
  minQueryLength: 1,
  timeoutMs: 2500,
  async canUse(ctx) {
    return Boolean((await ctx.reportsAccess())?.categories.has("general"));
  },
  async availability() {
    const [{ isJobTreadConfigured }, { isJobTreadFixtureEnabled }] = await Promise.all([
      import("@/lib/jobtread/client"),
      import("@/lib/jobtread/fixture"),
    ]);
    return isJobTreadConfigured() || isJobTreadFixtureEnabled()
      ? { available: true }
      : { available: false, reason: "JobTread isn't connected." };
  },
  search(ctx, input) {
    return indexedSearch(jobtreadJobsProvider, ctx, input);
  },
  async lookup(ctx: SearchContext, ids: string[]) {
    const access = await ctx.reportsAccess();
    if (!access?.categories.has("general")) return [];
    const valid = ids.filter((id) => JT_ID.test(id)).slice(0, 150);
    if (!valid.length) return [];
    const [rows, meta, state] = await Promise.all([
      agentDb().select<JobRow>("jt_jobs", {
        filters: [inList("id", valid), { col: "removed_at", op: "is_null" }],
        limit: 200,
      }),
      semanticFieldMeta(),
      import("../settings").then((m) => m.getProviderState("jobtread-jobs")),
    ]);
    const { effectiveFields } = await import("../settings");
    const fields = effectiveFields(jobtreadJobsProvider, state);
    const order = new Map(valid.map((id, i) => [id, i]));
    return rows
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((r) => jobHit(r, meta, access.categories as Set<string>, fields))
      .filter((h): h is ProviderHit => h !== null);
  },
  indexer: {
    refreshMinutes: 15,
    async fetchAll(): Promise<IndexDoc[]> {
      // Same first-use rule as Reports: if JobTread is connected but never synced, sync once.
      // (The sync's own index refresh is skipped by the lease this run holds.)
      await import("@/lib/reports/engine").then((m) => m.ensureJobTreadData()).catch(() => null);
      const [rows, meta, state] = await Promise.all([
        agentDb().select<JobRow>("jt_jobs", {
          filters: [{ col: "removed_at", op: "is_null" }],
          limit: 50_000,
        }),
        semanticFieldMeta(),
        import("../settings").then((m) => m.getProviderState("jobtread-jobs")),
      ]);
      const { effectiveFields } = await import("../settings");
      const semantics = enabledSemantic(effectiveFields(jobtreadJobsProvider, state));
      // Only "general" field values go into the index; customer-category values are matched
      // after the per-viewer re-read instead, so the index never holds them.
      const general = meta.filter((m) => m.category === "general" && semantics.has(m.semantic));
      return rows
        .filter((r) => JT_ID.test(r.id))
        .map((r) => {
          const address = formatAddress({
            line1: r.address,
            city: r.city,
            state: r.state,
            postalCode: r.postal_code,
          });
          return {
            recordId: r.id,
            title: r.name,
            subtitle: r.customer_name,
            searchText: [r.customer_name, address, ...general.map((m) => fieldValue(r, m.cfId))]
              .filter(Boolean)
              .join(" "),
            identifiers: [r.number ?? "", r.id],
            address,
            url: `https://app.jobtread.com/jobs/${encodeURIComponent(r.id)}`,
            aclCapabilities: ["reports:general"],
            recordUpdatedAt: r.synced_at,
          };
        });
    },
  },
};
