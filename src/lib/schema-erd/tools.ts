import { BAXTER_TOOLS, getEnabledBaxterTools, type BaxterTool } from "@/lib/baxter/tools";
import type { SchemaErd } from "@/lib/schema-erd/types";

/**
 * Seed tables are the records that unmistakably belong to one Baxter tool.
 * Expansion ({@link expandToolTables}) adds exactly one foreign-key hop in
 * both directions: tables a seed references, and tables that reference a seed.
 *
 * Stop there. Shared hubs such as `profiles` connect to nearly every tool, and
 * a second hop would pull the rest of the schema into every filter.
 *
 * Tools with no Baxter tables (an external app, a stateless generator, or a
 * read-only view over other tools' data) keep an empty seed list on purpose.
 * A new `BAXTER_TOOLS` key must be added here, even when the list is empty,
 * or `toolsMissingSeedEntry` fails.
 */
export const TOOL_SEED_TABLES: Record<string, readonly string[]> = {
  // Property research owns the report and the property records that hang off it
  // (001, 003). Connector configuration and its health checks have no foreign
  // key back to `reports`, so both have to be listed or they look unassigned.
  // Diagnostics such as `provider_call_logs` stay one hop away via `report_id`.
  "property-research": [
    "reports",
    "property_facts",
    "property_source_claims",
    "report_conflicts",
    "report_sources",
    "parcel_geometry",
    "site_observations",
    "pem_preparations",
    "jurisdiction_connectors",
    "connector_health_checks",
    "report_jobs",
  ],
  // PEM NEAT (025). `pem_preparations` is the property-research worksheet, not this tool.
  "pem-neat": ["pem_neats", "pem_neat_generations"],
  // New project setup (031).
  "project-setup": ["project_setup_settings", "project_setup_runs", "project_setup_steps"],
  // Receipt log (044). `expense_jobs` is the tool's job list (`receipts.job_id`),
  // created in the same migration, so it is a seed rather than a neighbor.
  "receipt-log": ["receipts", "expense_jobs"],
  // Site inspection templates (046) and the records filled in against them (047, 051).
  "site-inspections": [
    "inspection_templates",
    "inspection_template_sections",
    "inspection_template_items",
    "inspection_template_sub_questions",
    "inspection_template_sub_question_options",
    "site_inspections",
    "site_inspection_responses",
    "site_inspection_media",
    "site_inspection_item_summaries",
  ],
  // Customer Center reads GoHighLevel, PEM NEAT, and Project Setup. It has no tables of its own.
  "customer-dossier": [],
  // Knowledge Center records (006, 012, 016). Google sync and chat citations
  // that point at an entry arrive as one-hop neighbors.
  "knowledge-center": [
    "knowledge_entries",
    "knowledge_entry_revisions",
    "knowledge_sources",
    "knowledge_units",
    "knowledge_uploads",
  ],
  // Inventory (058).
  inventory: [
    "inventory_statuses",
    "inventory_storage_states",
    "inventory_orders",
    "inventory_items",
  ],
  // Floor Plan Library is a separate app (`FLOOR_PLAN_LIBRARY_URL`). No Baxter tables.
  "floor-plan-library": [],
  // QR codes are generated in the browser and never stored.
  "qr-code": [],
  // Virtual tours (060): the tour, its scenes, and the hotspots on those scenes.
  tours: ["tours", "scenes", "hotspots"],
};

export type ExpandedToolTables = {
  seeds: string[];
  neighbors: string[];
  tables: string[];
};

/** Seeds that exist, plus tables one foreign-key hop away. Hubs are not traversed. */
export function expandToolTables(schema: SchemaErd, seeds: readonly string[]): ExpandedToolTables {
  const publicNames = new Set(schema.tables.map((table) => table.name));
  const seedSet = new Set(seeds.filter((name) => publicNames.has(name)));
  const neighbors = new Set<string>();
  for (const key of schema.foreignKeys) {
    const sourcePublic = publicNames.has(key.sourceTable);
    const targetPublic = publicNames.has(key.targetTable);
    if (seedSet.has(key.sourceTable) && targetPublic && !seedSet.has(key.targetTable)) {
      neighbors.add(key.targetTable);
    }
    if (seedSet.has(key.targetTable) && sourcePublic && !seedSet.has(key.sourceTable)) {
      neighbors.add(key.sourceTable);
    }
  }
  return {
    seeds: [...seedSet].sort((a, b) => a.localeCompare(b)),
    neighbors: [...neighbors].sort((a, b) => a.localeCompare(b)),
    tables: [...seedSet, ...neighbors].sort((a, b) => a.localeCompare(b)),
  };
}

/** Enabled tools, including admin-only ones. Names and icons come from `BAXTER_TOOLS`. */
export function schemaToolButtons(): Array<
  Pick<BaxterTool, "key" | "name" | "icon"> & { seeds: readonly string[] }
> {
  return getEnabledBaxterTools({ isAdmin: true }).map((tool) => ({
    key: tool.key,
    name: tool.name,
    icon: tool.icon,
    seeds: TOOL_SEED_TABLES[tool.key] ?? [],
  }));
}

/** Tables that no enabled tool claims, after one-hop expansion. */
export function unassignedTables(schema: SchemaErd): string[] {
  const claimed = new Set<string>();
  for (const tool of getEnabledBaxterTools({ isAdmin: true })) {
    const seeds = TOOL_SEED_TABLES[tool.key] ?? [];
    for (const name of expandToolTables(schema, seeds).tables) claimed.add(name);
  }
  return schema.tables
    .map((table) => table.name)
    .filter((name) => !claimed.has(name))
    .sort((a, b) => a.localeCompare(b));
}

/** Seed names that are not tables in the schema being checked. */
export function missingSeedTables(tableNames: ReadonlySet<string>): string[] {
  const missing: string[] = [];
  for (const seeds of Object.values(TOOL_SEED_TABLES)) {
    for (const name of seeds) {
      if (!tableNames.has(name)) missing.push(name);
    }
  }
  return missing;
}

/** Mapping keys that are not a `BAXTER_TOOLS` key. */
export function toolMappingKeysUnknown(): string[] {
  const known = new Set(BAXTER_TOOLS.map((tool) => tool.key));
  return Object.keys(TOOL_SEED_TABLES).filter((key) => !known.has(key));
}

/** `BAXTER_TOOLS` keys with no seed entry, including tools that should map to `[]`. */
export function toolsMissingSeedEntry(): string[] {
  return BAXTER_TOOLS.map((tool) => tool.key).filter((key) => !(key in TOOL_SEED_TABLES));
}
