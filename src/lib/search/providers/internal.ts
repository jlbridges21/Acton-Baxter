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
import { safeId, safeText } from "../safety";
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

function knowledgeHit(
  ctx: SearchContext,
  e: KnowledgeEntry,
  fields: Set<string>,
): ProviderHit | null {
  const id = safeId(e.id, UUID);
  if (!id) return null;
  const status = e.status === "approved" ? null : e.status[0]!.toUpperCase() + e.status.slice(1);
  return {
    recordId: id,
    title: e.title,
    subtitle: [e.category, status].filter(Boolean).join(" · ") || null,
    description: fields.has("summary") ? safeText(e.summary, 160) : null,
    breadcrumb: ["Knowledge Center", e.category].filter(Boolean),
    url: ctx.isAdmin ? `/admin/knowledge/${id}` : `/knowledge/${id}`,
    icon: "book-open",
    updatedAt: e.updated_at,
    auth: e.status === "approved" && e.visibility === "internal" ? "internal" : "record",
    match: {
      title: e.title,
      subtitle: e.category,
      fields: [...(fields.has("tags") ? e.tags : []), fields.has("source") ? e.source_name : null],
      description: fields.has("summary") ? e.summary : null,
    },
  };
}

export const knowledgeProvider: SearchProvider = {
  id: "knowledge",
  category: "knowledge",
  name: "Knowledge Center",
  icon: "book-open",
  sourceSystem: "knowledge",
  description: "Knowledge Center entries: title, category, tags, and summary (not full content).",
  searchableFields: [
    { key: "title", label: "Title & category", sensitivity: "standard", defaultEnabled: true },
    { key: "tags", label: "Tags", sensitivity: "standard", defaultEnabled: true },
    { key: "summary", label: "Summary", sensitivity: "standard", defaultEnabled: true },
    { key: "source", label: "Source name", sensitivity: "standard", defaultEnabled: false },
    {
      key: "content",
      label: "Full document text",
      sensitivity: "restricted",
      defaultEnabled: false,
    },
  ],
  optional: true,
  indexing: "index",
  permissionSummary:
    "Approved internal entries for everyone; drafts only for their author; admin-only and archived entries for admins.",
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
  async lookup(ctx, ids) {
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
      .map((e) => knowledgeHit(ctx, e, fields))
      .filter((h): h is ProviderHit => h !== null);
  },
  indexer: {
    refreshMinutes: 10,
    async fetchAll() {
      const { listKnowledgeEntries } = await import("@/lib/knowledge/store");
      const entries = await listKnowledgeEntries({ status: "all" });
      return entries
        .filter((e) => UUID.test(e.id))
        .map((e) => ({
          recordId: e.id,
          title: e.title,
          subtitle: e.category,
          // Never the document body: title, tags, source, and the short summary only.
          searchText: [e.category, ...e.tags, e.source_name, safeText(e.summary, 400)]
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
      description: fields.has("description") ? item.description : null,
    },
  };
}

export const inventoryProvider: SearchProvider = {
  id: "inventory",
  category: "inventory",
  name: "Inventory",
  icon: "package",
  sourceSystem: "inventory",
  description: "Inventory items: name, SKU, order number, vendor, project, status, location.",
  searchableFields: [
    {
      key: "name",
      label: "Item, SKU, order number",
      sensitivity: "standard",
      defaultEnabled: true,
    },
    { key: "description", label: "Description", sensitivity: "standard", defaultEnabled: true },
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
            safeText(i.description, 300),
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
};

async function listInspectionsLite(ids?: string[]): Promise<InspectionLite[]> {
  const { getEnv } = await import("@/lib/env");
  let memory = true;
  try {
    const env = getEnv();
    memory = Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    memory = true;
  }
  if (memory) {
    const { listSiteInspections } = await import("@/lib/inspections/records-store");
    const rows = await listSiteInspections();
    return rows
      .filter((r) => !ids || ids.includes(r.id))
      .map((r) => ({
        id: r.id,
        projectName: r.projectName,
        address: r.address,
        status: r.status,
        updatedAt: r.updatedAt,
      }));
  }
  // Light read: the list view signs cover photos, which search never needs.
  const { createServiceClient } = await import("@/lib/supabase/admin");
  let q = createServiceClient()
    .from("site_inspections")
    .select("id, project_name, address, status, updated_at")
    .is("deleted_at", null);
  if (ids) q = q.in("id", ids);
  const { data, error } = await q.limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    projectName: r.project_name as string,
    address: r.address as string,
    status: r.status as string,
    updatedAt: r.updated_at as string,
  }));
}

function inspectionHit(r: InspectionLite): ProviderHit | null {
  const id = safeId(r.id, UUID);
  if (!id) return null;
  const status = r.status.replace(/_/g, " ");
  return {
    recordId: id,
    title: r.projectName || "Site inspection",
    subtitle: `Site inspection · ${status[0]?.toUpperCase() ?? ""}${status.slice(1)}`,
    description: r.address || null,
    breadcrumb: ["Site Inspections"],
    url: `/inspections/${id}`,
    icon: "clipboard-check",
    updatedAt: r.updatedAt,
    auth: "internal",
    address: r.address ? { line1: r.address } : undefined,
    match: { title: r.projectName, addresses: [r.address], fields: [status] },
  };
}

export const inspectionsProvider: SearchProvider = {
  id: "inspections",
  category: "inspections",
  name: "Site inspections",
  icon: "clipboard-check",
  sourceSystem: "inspections",
  description: "Site inspections by project name, address, and status.",
  searchableFields: [
    {
      key: "project",
      label: "Project name & address",
      sensitivity: "standard",
      defaultEnabled: true,
    },
    {
      key: "notes",
      label: "Inspection notes & media",
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
  async lookup(_ctx, ids) {
    const valid = ids.filter((id) => UUID.test(id)).slice(0, 150);
    if (!valid.length) return [];
    return (await listInspectionsLite(valid))
      .map(inspectionHit)
      .filter((h): h is ProviderHit => h !== null);
  },
  indexer: {
    refreshMinutes: 10,
    async fetchAll() {
      return (await listInspectionsLite()).map((r) => ({
        recordId: r.id,
        title: r.projectName || "Site inspection",
        subtitle: r.address,
        searchText: [r.address, r.status].join(" "),
        address: r.address,
        url: `/inspections/${r.id}`,
        recordUpdatedAt: r.updatedAt,
      }));
    },
  },
};
