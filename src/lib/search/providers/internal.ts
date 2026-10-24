/**
 * Baxter-internal records indexed into global_search_index: Knowledge Center entries,
 * inventory items, and site inspections. Each lookup re-reads the source of truth, so a
 * deleted, archived, or no-longer-visible record never appears even before the next refresh.
 */

import "server-only";

import { isAdminRole } from "@/lib/auth/roles";
import type { KnowledgeEntry } from "@/lib/knowledge/types";
import type { InventoryItem } from "@/lib/inventory/types";
import type { SearchContext } from "../context";
import type { IndexDoc, ProviderHit, SearchProvider } from "../provider";
import { safeId, safeText, snippetAround } from "../safety";
import { indexedSearch } from "./indexed";

const UUID = /^[0-9a-f-]{36}$/i;
const ADMIN_ROLES = ["admin", "super_admin"];

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------

/** Index ACL mirroring canUserReadKnowledgeEntry (admins pass every clause). */
function knowledgeAcl(e: KnowledgeEntry): Pick<IndexDoc, "aclRoles" | "aclUsers"> {
  if (e.status === "approved" && e.visibility === "internal")
    return { aclRoles: null, aclUsers: null };
  if (e.status === "draft" && e.created_by) return { aclRoles: null, aclUsers: [e.created_by] };
  return { aclRoles: ADMIN_ROLES, aclUsers: null };
}

/** Body text the index and ranker see: plain text, capped (the index row holds 4,000 chars). */
const KNOWLEDGE_BODY_CHARS = 3000;

function knowledgeHit(
  ctx: SearchContext,
  e: KnowledgeEntry,
  fields: Set<string>,
  query = "",
): ProviderHit | null {
  const id = safeId(e.id, UUID);
  if (!id) return null;
  const status = e.status === "approved" ? null : e.status[0]!.toUpperCase() + e.status.slice(1);
  const body = fields.has("content") ? safeText(e.content, KNOWLEDGE_BODY_CHARS) : null;
  const summary = fields.has("summary") ? safeText(e.summary, 160) : null;
  // Show where a body match is when the summary doesn't already explain it.
  const summaryExplains =
    summary &&
    query
      .toLowerCase()
      .split(/\s+/)
      .some((w) => w.length >= 2 && summary.toLowerCase().includes(w));
  const excerpt = !summaryExplains && body && query ? snippetAround(body, query, 160) : null;
  return {
    recordId: id,
    title: e.title,
    subtitle: [e.category, status].filter(Boolean).join(" · ") || null,
    description: excerpt ?? summary,
    breadcrumb: ["Knowledge Center", e.category].filter(Boolean),
    url: ctx.isAdmin ? `/admin/knowledge/${id}` : `/knowledge/${id}`,
    icon: "book-open",
    updatedAt: e.updated_at,
    preview: [
      { label: "Tags", value: e.tags.length ? e.tags.slice(0, 4).join(", ") : null },
      { label: "Source", value: e.source_name },
    ],
    auth: e.status === "approved" && e.visibility === "internal" ? "internal" : "record",
    match: {
      title: e.title,
      subtitle: e.category,
      fields: [
        ...(fields.has("tags") ? e.tags : []),
        fields.has("source") ? e.source_name : null,
        e.doc_kind ? e.doc_kind.replace(/_/g, " ") : null,
      ],
      description: [summary, body].filter(Boolean).join(" ") || null,
    },
  };
}

export const knowledgeProvider: SearchProvider = {
  id: "knowledge",
  category: "knowledge",
  name: "Knowledge Center",
  icon: "book-open",
  sourceSystem: "knowledge",
  description: "Knowledge Center entries: title, category, tags, summary, and article text.",
  searchableFields: [
    { key: "title", label: "Title & category", sensitivity: "standard", defaultEnabled: true },
    { key: "tags", label: "Tags", sensitivity: "standard", defaultEnabled: true },
    { key: "summary", label: "Summary", sensitivity: "standard", defaultEnabled: true },
    { key: "source", label: "Source name", sensitivity: "standard", defaultEnabled: false },
    { key: "content", label: "Article text", sensitivity: "standard", defaultEnabled: true },
  ],
  optional: true,
  indexing: "index",
  permissionSummary:
    "Approved internal entries for everyone; drafts only for their author; admin-only and archived entries for admins. Article text is matched only for entries the viewer can open.",
  minQueryLength: 2,
  timeoutMs: 2500,
  async canUse() {
    return true;
  },
  async availability() {
    return { available: true };
  },
  search(ctx, input) {
    return indexedSearch(knowledgeProvider, ctx, input);
  },
  async lookup(ctx, ids, query) {
    const { getKnowledgeEntry } = await import("@/lib/knowledge/store");
    const { canUserReadKnowledgeEntry } = await import("@/lib/knowledge/permissions");
    const { effectiveFields, getProviderState } = await import("../settings");
    const fields = effectiveFields(knowledgeProvider, await getProviderState("knowledge"));
    const entries = await Promise.all(
      ids
        .filter((id) => UUID.test(id))
        .slice(0, 40)
        .map((id) => getKnowledgeEntry(id).catch(() => null)),
    );
    return entries
      .filter(
        (e): e is KnowledgeEntry =>
          Boolean(e) && canUserReadKnowledgeEntry(e!, ctx.user.id, ctx.user.role),
      )
      .map((e) => knowledgeHit(ctx, e, fields, query))
      .filter((h): h is ProviderHit => h !== null);
  },
  indexer: {
    refreshMinutes: 10,
    async fetchAll() {
      const { listKnowledgeEntries } = await import("@/lib/knowledge/store");
      const { effectiveFields, getProviderState } = await import("../settings");
      const fields = effectiveFields(knowledgeProvider, await getProviderState("knowledge"));
      const entries = await listKnowledgeEntries({ status: "all" });
      return entries
        .filter((e) => UUID.test(e.id))
        .map((e) => ({
          recordId: e.id,
          title: e.title,
          subtitle: e.category,
          // The row carries the same ACL as the entry, so body text only reaches readers.
          searchText: [
            e.category,
            ...(fields.has("tags") ? e.tags : []),
            fields.has("source") ? e.source_name : null,
            fields.has("summary") ? safeText(e.summary, 400) : null,
            fields.has("content") ? safeText(e.content, KNOWLEDGE_BODY_CHARS) : null,
          ]
            .filter(Boolean)
            .join(" "),
          url: `/knowledge/${e.id}`,
          ...knowledgeAcl(e),
          recordUpdatedAt: e.updated_at,
        }));
    },
  },
};

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

function inventoryHit(item: InventoryItem, fields: Set<string>): ProviderHit | null {
  const id = safeId(item.id, UUID);
  if (!id) return null;
  const q = item.sku || item.itemName;
  return {
    recordId: id,
    title: item.itemName,
    subtitle: [item.vendor, item.projectLabel].filter(Boolean).join(" · ") || null,
    description: fields.has("description") ? safeText(item.description, 140) : null,
    breadcrumb: ["Inventory"],
    url: `/inventory?q=${encodeURIComponent(q.slice(0, 80))}`,
    icon: "package",
    updatedAt: item.updatedAt,
    preview: [
      { label: "Status", value: item.statusLabel },
      { label: "Location", value: item.storageLabel },
      { label: "SKU", value: item.sku || null },
    ],
    auth: "internal",
    actions: item.sku ? [{ kind: "copy", label: "Copy SKU", value: item.sku }] : [],
    match: {
      title: item.itemName,
      subtitle: item.vendor,
      identifiers: [item.sku, item.orderNumber],
      fields: [item.projectLabel, item.category, item.statusLabel, item.storageLabel],
      description:
        [
          fields.has("description") ? item.description : null,
          fields.has("notes") ? item.notes : null,
        ]
          .filter(Boolean)
          .join(" ") || null,
    },
  };
}

export const inventoryProvider: SearchProvider = {
  id: "inventory",
  category: "inventory",
  name: "Inventory",
  icon: "package",
  sourceSystem: "inventory",
  description:
    "Inventory items: name, SKU, order number, vendor, project, category, status, location, description, and notes.",
  searchableFields: [
    {
      key: "name",
      label: "Item, SKU, order number",
      sensitivity: "standard",
      defaultEnabled: true,
    },
    { key: "description", label: "Description", sensitivity: "standard", defaultEnabled: true },
    { key: "notes", label: "Notes", sensitivity: "standard", defaultEnabled: true },
    { key: "cost", label: "Unit and total cost", sensitivity: "restricted", defaultEnabled: false },
  ],
  optional: true,
  indexing: "index",
  permissionSummary:
    "Any approved employee (same as the Inventory page). Costs are never searched or shown.",
  minQueryLength: 2,
  timeoutMs: 2500,
  async canUse() {
    return true;
  },
  async availability() {
    return { available: true };
  },
  search(ctx, input) {
    return indexedSearch(inventoryProvider, ctx, input);
  },
  async lookup(_ctx, ids) {
    const { listAllInventoryItems } = await import("@/lib/inventory/store");
    const { effectiveFields, getProviderState } = await import("../settings");
    const fields = effectiveFields(inventoryProvider, await getProviderState("inventory"));
    const wanted = new Set(ids);
    return (await listAllInventoryItems())
      .filter((i) => wanted.has(i.id))
      .map((i) => inventoryHit(i, fields))
      .filter((h): h is ProviderHit => h !== null);
  },
  indexer: {
    refreshMinutes: 5,
    async fetchAll() {
      const { listAllInventoryItems } = await import("@/lib/inventory/store");
      const { effectiveFields, getProviderState } = await import("../settings");
      const fields = effectiveFields(inventoryProvider, await getProviderState("inventory"));
      return (await listAllInventoryItems())
        .filter((i) => UUID.test(i.id))
        .map((i) => ({
          recordId: i.id,
          title: i.itemName,
          subtitle: i.vendor,
          searchText: [
            i.projectLabel,
            i.category,
            i.statusLabel,
            i.storageLabel,
            fields.has("description") ? safeText(i.description, 300) : null,
            fields.has("notes") ? safeText(i.notes, 300) : null,
          ]
            .filter(Boolean)
            .join(" "),
          identifiers: [i.sku, i.orderNumber ?? ""],
          url: "/inventory",
          recordUpdatedAt: i.updatedAt,
        }));
    },
  },
};

// ---------------------------------------------------------------------------
// Site inspections
// ---------------------------------------------------------------------------

type InspectionLite = {
  id: string;
  projectName: string;
  address: string;
  status: string;
  updatedAt: string;
  jobLabel: string | null;
  projectNumber: string | null;
  inspector: string | null;
  createdByName: string | null;
  templateName: string | null;
  /** Item notes joined, plain text, capped. */
  notes: string;
};

const INSPECTION_NOTES_CHARS = 2000;

function joinNotes(notes: Array<string | null | undefined>): string {
  return (safeText(notes.filter(Boolean).join(" · "), INSPECTION_NOTES_CHARS) ?? "").trim();
}

function inspectionsInMemory(env: { ENABLE_MOCK_RESEARCH?: boolean; NODE_ENV?: string }) {
  return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
}

async function listInspectionsLite(ids?: string[]): Promise<InspectionLite[]> {
  const { getEnv } = await import("@/lib/env");
  let memory = true;
  try {
    memory = inspectionsInMemory(getEnv());
  } catch {
    memory = true;
  }
  if (memory) {
    const [{ listSiteInspections, getSiteInspection }, { listExpenseJobs }] = await Promise.all([
      import("@/lib/inspections/records-store"),
      import("@/lib/receipts/store"),
    ]);
    const [rows, jobs] = await Promise.all([
      listSiteInspections(),
      listExpenseJobs({ includeInactive: true }).catch(() => []),
    ]);
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const wanted = rows.filter((r) => !ids || ids.includes(r.id));
    return Promise.all(
      wanted.map(async (r) => {
        const detail = await getSiteInspection(r.id).catch(() => null);
        const job = r.jobId ? jobById.get(r.jobId) : undefined;
        return {
          id: r.id,
          projectName: r.projectName,
          address: r.address,
          status: r.status,
          updatedAt: r.updatedAt,
          jobLabel: job?.label ?? null,
          projectNumber: job?.projectNumber ?? null,
          inspector: r.assignedToName,
          createdByName: r.createdByName,
          templateName: detail?.snapshot.sourceTemplateName ?? null,
          notes: joinNotes(detail?.responses.map((x) => x.notes) ?? []),
        };
      }),
    );
  }
  // Light read: the list view signs cover photos, which search never needs. Related rows
  // (job, people, notes) come in one query each, never per inspection.
  const { createServiceClient } = await import("@/lib/supabase/admin");
  const db = createServiceClient();
  let q = db
    .from("site_inspections")
    .select(
      "id, project_name, address, status, updated_at, job_id, assigned_to, created_by, template:snapshot_json->>sourceTemplateName",
    )
    .is("deleted_at", null);
  if (ids) q = q.in("id", ids);
  const { data, error } = await q.limit(5000);
  if (error) throw new Error(`site_inspections: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    project_name: string;
    address: string;
    status: string;
    updated_at: string;
    job_id: string | null;
    assigned_to: string | null;
    created_by: string | null;
    template: string | null;
  }>;
  if (!rows.length) return [];
  const jobIds = [...new Set(rows.map((r) => r.job_id).filter((v): v is string => Boolean(v)))];
  const userIds = [
    ...new Set(
      rows.flatMap((r) => [r.assigned_to, r.created_by]).filter((v): v is string => Boolean(v)),
    ),
  ];
  const inspectionIds = rows.map((r) => r.id);
  const [jobs, people, notes] = await Promise.all([
    jobIds.length
      ? db.from("expense_jobs").select("id, label, project_number").in("id", jobIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? db.from("profiles").select("id, full_name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("site_inspection_responses")
      .select("inspection_id, notes")
      .in("inspection_id", inspectionIds)
      .neq("notes", "")
      .limit(20_000),
  ]);
  // Related lookups enrich results; a failure there must not hide the inspections themselves.
  for (const [name, res] of [
    ["expense_jobs", jobs],
    ["profiles", people],
    ["site_inspection_responses", notes],
  ] as const) {
    if (res.error)
      console.warn("[search.inspections.related]", { table: name, message: res.error.message });
  }
  const jobById = new Map(
    ((jobs.data ?? []) as Array<{ id: string; label: string; project_number: string | null }>).map(
      (j) => [j.id, j],
    ),
  );
  const nameById = new Map(
    ((people.data ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [
      p.id,
      p.full_name,
    ]),
  );
  const notesById = new Map<string, string[]>();
  for (const n of (notes.data ?? []) as Array<{ inspection_id: string; notes: string }>) {
    const list = notesById.get(n.inspection_id) ?? [];
    list.push(n.notes);
    notesById.set(n.inspection_id, list);
  }
  return rows.map((r) => {
    const job = r.job_id ? jobById.get(r.job_id) : undefined;
    return {
      id: r.id,
      projectName: r.project_name,
      address: r.address,
      status: r.status,
      updatedAt: r.updated_at,
      jobLabel: job?.label ?? null,
      projectNumber: job?.project_number ?? null,
      inspector: (r.assigned_to && nameById.get(r.assigned_to)) || null,
      createdByName: (r.created_by && nameById.get(r.created_by)) || null,
      templateName: r.template,
      notes: joinNotes(notesById.get(r.id) ?? []),
    };
  });
}

function statusLabel(status: string) {
  const s = status.replace(/_/g, " ");
  return `${s[0]?.toUpperCase() ?? ""}${s.slice(1)}`;
}

function inspectionHit(r: InspectionLite, fields: Set<string>, query = ""): ProviderHit | null {
  const id = safeId(r.id, UUID);
  if (!id) return null;
  const status = statusLabel(r.status);
  const notes = fields.has("notes") ? r.notes : "";
  const noteExcerpt = notes && query ? snippetAround(notes, query, 140) : null;
  const job = [r.projectNumber, r.jobLabel].filter(Boolean).join(" · ") || null;
  return {
    recordId: id,
    title: r.projectName || "Site inspection",
    subtitle: ["Site inspection", status, r.templateName].filter(Boolean).join(" · "),
    description: noteExcerpt ? `Notes: ${noteExcerpt}` : r.address || null,
    breadcrumb: ["Site Inspections"],
    url: `/inspections/${id}`,
    icon: "clipboard-check",
    updatedAt: r.updatedAt,
    preview: [
      { label: "Job", value: job },
      { label: "Inspector", value: r.inspector ?? r.createdByName },
      { label: "Address", value: noteExcerpt ? r.address : null },
    ],
    auth: "internal",
    address: r.address ? { line1: r.address } : undefined,
    match: {
      title: r.projectName,
      subtitle: r.templateName,
      identifiers: [r.projectNumber],
      addresses: [r.address],
      fields: [status, r.jobLabel, r.inspector, r.createdByName],
      description: notes || null,
    },
  };
}

export const inspectionsProvider: SearchProvider = {
  id: "inspections",
  category: "inspections",
  name: "Site inspections",
  icon: "clipboard-check",
  sourceSystem: "inspections",
  description:
    "Site inspections by project, address, job, inspector, template, status, and item notes.",
  searchableFields: [
    {
      key: "project",
      label: "Project, address, job, inspector, template & status",
      sensitivity: "standard",
      defaultEnabled: true,
    },
    { key: "notes", label: "Inspection item notes", sensitivity: "standard", defaultEnabled: true },
    {
      key: "media",
      label: "Photos, videos & transcripts",
      sensitivity: "restricted",
      defaultEnabled: false,
    },
  ],
  optional: true,
  indexing: "index",
  permissionSummary: "Any approved employee (same as the Site Inspections page).",
  minQueryLength: 2,
  timeoutMs: 2500,
  async canUse(ctx) {
    return Boolean(ctx.user.id) && (isAdminRole(ctx.user.role) || ctx.user.role === "user");
  },
  async availability() {
    return { available: true };
  },
  search(ctx, input) {
    return indexedSearch(inspectionsProvider, ctx, input);
  },
  async lookup(_ctx, ids, query) {
    const valid = ids.filter((id) => UUID.test(id)).slice(0, 150);
    if (!valid.length) return [];
    const { effectiveFields, getProviderState } = await import("../settings");
    const fields = effectiveFields(inspectionsProvider, await getProviderState("inspections"));
    return (await listInspectionsLite(valid))
      .map((r) => inspectionHit(r, fields, query))
      .filter((h): h is ProviderHit => h !== null);
  },
  indexer: {
    refreshMinutes: 10,
    async fetchAll() {
      const { effectiveFields, getProviderState } = await import("../settings");
      const fields = effectiveFields(inspectionsProvider, await getProviderState("inspections"));
      return (await listInspectionsLite()).map((r) => ({
        recordId: r.id,
        title: r.projectName || "Site inspection",
        subtitle: r.templateName ?? r.address,
        searchText: [
          r.address,
          statusLabel(r.status),
          r.jobLabel,
          r.inspector,
          r.createdByName,
          fields.has("notes") ? r.notes : null,
        ]
          .filter(Boolean)
          .join(" "),
        identifiers: [r.projectNumber ?? ""],
        address: r.address,
        url: `/inspections/${r.id}`,
        recordUpdatedAt: r.updatedAt,
      }));
    },
  },
};
