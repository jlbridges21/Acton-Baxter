/**
 * Tools, pages, and settings — read from the canonical page registry
 * (src/lib/navigation/registry.ts), so a page added there is searchable with no change here.
 * Role and `requires` checks run on the server before anything is returned.
 */

import "server-only";

import {
  getNavEntry,
  isExternalHref,
  navEntriesForRole,
  navTool,
  type NavEntry,
} from "@/lib/navigation/registry";
import type { SearchContext } from "../context";
import type { ProviderHit, SearchProvider } from "../provider";

async function visibleEntries(ctx: SearchContext): Promise<NavEntry[]> {
  const entries = navEntriesForRole(ctx.isAdmin);
  const checks = await Promise.all(entries.map((e) => ctx.meets(e.requires)));
  return entries.filter((_, i) => checks[i]);
}

function toHit(entry: NavEntry, isAdmin: boolean): ProviderHit {
  const tool = navTool(entry);
  const parent = entry.parentId ? getNavEntry(entry.parentId) : undefined;
  const description = (isAdmin && tool?.adminDescription) || tool?.description || entry.description;
  const external = isExternalHref(entry.href);
  return {
    recordId: entry.id,
    title: entry.label,
    subtitle: parent
      ? parent.label
      : tool && tool.name !== entry.label
        ? tool.name
        : entry.kind === "setting"
          ? "Settings"
          : entry.kind === "tool"
            ? "Tool"
            : "Page",
    description,
    breadcrumb: parent ? [parent.label, entry.label] : [entry.label],
    url: entry.href,
    icon: entry.icon,
    auth: entry.audience === "admin" || entry.requires ? "role" : "internal",
    actions: external
      ? [{ kind: "open", label: "Open in new tab", href: entry.href, external: true }]
      : [],
    match: {
      title: entry.label,
      subtitle: parent?.label ?? null,
      fields: [tool?.name],
      keywords: [...(entry.keywords ?? []), ...(tool?.aliases ?? [])],
      description,
    },
  };
}

function navigationProvider(kind: "tools" | "settings"): SearchProvider {
  const wanted = (e: NavEntry) =>
    kind === "settings" ? e.kind === "setting" : e.kind !== "setting";
  return {
    id: kind === "tools" ? "tools" : "settings",
    category: kind,
    name: kind === "tools" ? "Tools & pages" : "Settings",
    icon: kind === "tools" ? "layout-dashboard" : "settings",
    sourceSystem: "baxter",
    description:
      kind === "tools"
        ? "Baxter tools and pages from the canonical page registry."
        : "Settings and configuration pages from the canonical page registry.",
    searchableFields: [
      { key: "label", label: "Name", sensitivity: "standard", defaultEnabled: true },
      {
        key: "aliases",
        label: "Aliases & keywords",
        sensitivity: "standard",
        defaultEnabled: true,
      },
      { key: "description", label: "Description", sensitivity: "standard", defaultEnabled: true },
    ],
    optional: false,
    indexing: "registry",
    permissionSummary:
      "Role-based (admin pages only for admins) plus each page's own check (Reports access, Sam Operations role).",
    minQueryLength: 1,
    timeoutMs: 1500,
    async canUse() {
      return true;
    },
    async availability() {
      return { available: true };
    },
    async search(ctx, input) {
      const entries = (await visibleEntries(ctx)).filter(wanted);
      const hits = entries.map((e) => toHit(e, ctx.isAdmin));
      for (const h of hits) {
        if (!input.fields.has("aliases")) h.match.keywords = [];
        if (!input.fields.has("description")) h.match.description = null;
      }
      return { hits, freshness: { kind: "registry" } };
    },
    async lookup(ctx, ids) {
      const entries = (await visibleEntries(ctx)).filter(wanted);
      return entries.filter((e) => ids.includes(e.id)).map((e) => toHit(e, ctx.isAdmin));
    },
    async emptyState(ctx) {
      if (kind !== "tools") return [];
      return (await visibleEntries(ctx))
        .filter((e) => e.kind === "tool")
        .slice(0, 6)
        .map((e) => toHit(e, ctx.isAdmin));
    },
  };
}

export const toolsProvider = navigationProvider("tools");
export const settingsProvider = navigationProvider("settings");
