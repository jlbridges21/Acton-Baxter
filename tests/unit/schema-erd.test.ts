import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Graph, layout } from "@dagrejs/dagre";
import { buildSchemaGraph, deriveSchemaGroups, visibleColumns } from "@/lib/schema-erd/graph";
import { gridLayout, layoutSchema } from "@/lib/schema-erd/layout";
import { parseErdPersisted, placedPositions, readErdView } from "@/lib/schema-erd/persist";
import type { SchemaErd, SchemaForeignKey, SchemaTable } from "@/lib/schema-erd/types";

function table(name: string, columns: SchemaTable["columns"]): SchemaTable {
  return { name, columns };
}

function column(
  name: string,
  extras: Partial<SchemaTable["columns"][number]> = {},
): SchemaTable["columns"][number] {
  return { name, dataType: "text", nullable: true, primaryKey: false, ...extras };
}

const schema: SchemaErd = {
  tables: [
    table("slack_channels", [column("id", { primaryKey: true, nullable: false })]),
    table("slack_messages", [
      column("id", { primaryKey: true, nullable: false }),
      column("channel_id"),
      column("body"),
    ]),
    table("site_inspection_media", [
      column("id", { primaryKey: true, nullable: false }),
      column("inspection_id"),
    ]),
    table("site_inspection_records", [column("id", { primaryKey: true, nullable: false })]),
    table("tours", [column("id", { primaryKey: true, nullable: false })]),
    table("scenes", [
      column("id", { primaryKey: true, nullable: false }),
      column("tour_id"),
      column("name"),
    ]),
  ],
  foreignKeys: [
    {
      constraintName: "slack_messages_channel_fkey",
      sourceTable: "slack_messages",
      sourceColumns: ["channel_id"],
      targetTable: "slack_channels",
      targetColumns: ["id"],
    },
    {
      constraintName: "scenes_tour_fkey",
      sourceTable: "scenes",
      sourceColumns: ["tour_id"],
      targetTable: "tours",
      targetColumns: ["id"],
    },
    {
      constraintName: "scenes_parent_fkey",
      sourceTable: "scenes",
      sourceColumns: ["parent_id"],
      targetTable: "scenes",
      targetColumns: ["id"],
    },
    {
      constraintName: "profiles_user_fkey",
      sourceTable: "tours",
      sourceColumns: ["owner_id"],
      targetTable: "auth.users",
      targetColumns: ["id"],
    },
  ],
};

describe("schema diagram", () => {
  it("groups tables by the longest shared prefix", () => {
    const groups = deriveSchemaGroups(schema.tables.map((item) => item.name));
    expect(groups.find((group) => group.id === "slack")?.tables).toEqual([
      "slack_channels",
      "slack_messages",
    ]);
    expect(groups.find((group) => group.id === "site_inspection")?.tables).toEqual([
      "site_inspection_media",
      "site_inspection_records",
    ]);
    expect(groups.find((group) => group.id === "other")?.tables).toEqual(["scenes", "tours"]);
  });

  it("keeps collapsed cards to keys, searches with neighbors, and loops a self foreign key", () => {
    const scenes = schema.tables.find((item) => item.name === "scenes");
    if (!scenes) throw new Error("missing scenes");
    expect(
      visibleColumns(scenes, ["tour_id", "parent_id"], false).map((item) => item.name),
    ).toEqual(["id", "tour_id"]);
    expect(visibleColumns(scenes, ["tour_id"], true).map((item) => item.name)).toEqual([
      "id",
      "tour_id",
      "name",
    ]);
    const graph = buildSchemaGraph(schema, {
      positions: {},
      expanded: new Set(["scenes"]),
      hiddenGroups: new Set(),
      search: "slack_messages",
      focus: "scenes",
    });
    expect(
      graph.nodes
        .filter((node) => !node.hidden)
        .map((node) => node.id)
        .sort(),
    ).toEqual(["slack_channels", "slack_messages"]);
    expect(
      graph.nodes.find((node) => node.id === "scenes")?.columns.map((item) => item.name),
    ).toEqual(["id", "tour_id", "name"]);
    const self = graph.edges.find((edge) => edge.id === "scenes_parent_fkey");
    expect(self).toMatchObject({
      self: true,
      source: "scenes",
      target: "scenes",
      label: "parent_id → id",
      hidden: true,
    });
    expect(graph.edges.find((edge) => edge.id === "profiles_user_fkey")).toBeUndefined();
    const focused = buildSchemaGraph(schema, {
      positions: { scenes: { x: 10, y: 20 } },
      expanded: new Set(),
      hiddenGroups: new Set(["slack"]),
      search: "",
      focus: "scenes",
    });
    expect(focused.nodes.find((node) => node.id === "slack_messages")?.hidden).toBe(true);
    expect(focused.nodes.find((node) => node.id === "scenes")).toMatchObject({
      hidden: false,
      focused: true,
      dimmed: false,
      position: { x: 10, y: 20 },
    });
    expect(focused.nodes.find((node) => node.id === "tours")?.dimmed).toBe(false);
    expect(focused.nodes.find((node) => node.id === "site_inspection_media")?.dimmed).toBe(true);
  });

  it("places a new table automatically and rejects a malformed or stale arrangement", () => {
    const tables = new Set(["tours", "scenes"]);
    const groups = new Set(["other"]);
    expect(parseErdPersisted({ positions: { gone: { x: 1, y: 2 } } }, tables, groups)).toBeNull();
    expect(
      parseErdPersisted({ positions: { tours: { x: Number.NaN, y: 1 } } }, tables, groups),
    ).toBeNull();
    expect(
      parseErdPersisted(
        {
          positions: { tours: { x: 4, y: 8 } },
          expanded: ["missing"],
          hiddenGroups: [],
          search: "",
          focus: null,
        },
        tables,
        groups,
      ),
    ).toBeNull();
    const saved = parseErdPersisted(
      {
        positions: { tours: { x: 4, y: 8 } },
        expanded: ["tours"],
        hiddenGroups: [],
        search: "tour",
        focus: "scenes",
      },
      tables,
      groups,
    );
    expect(saved?.positions.tours).toEqual({ x: 4, y: 8 });
    expect(
      placedPositions({ tours: { x: 1, y: 1 }, scenes: { x: 9, y: 9 } }, saved?.positions ?? null),
    ).toEqual({
      tours: { x: 4, y: 8 },
      scenes: { x: 9, y: 9 },
    });
    const throwing = {
      getItem() {
        throw new Error("blocked");
      },
    };
    expect(readErdView(throwing, "user", tables, groups)).toBeNull();
  });

  it("lays out distinct cards and skips a self-reference in the ranker", () => {
    const positions = layoutSchema(schema).positions;
    const tours = positions.tours;
    const scenes = positions.scenes;
    expect(tours).toBeTruthy();
    expect(scenes).toBeTruthy();
    expect(Number.isFinite(tours?.x)).toBe(true);
    expect(Number.isFinite(scenes?.y)).toBe(true);
    expect(tours).not.toEqual(scenes);
  });

  it("keeps schema metadata on the service role and the page behind the admin check", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/064_admin_schema_erd.sql"),
      "utf8",
    );
    expect(sql.toLowerCase()).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql.toLowerCase()).toContain(
      "revoke all on function public.admin_schema_erd() from authenticated",
    );
    expect(sql.toLowerCase()).not.toContain(
      "grant execute on function public.admin_schema_erd() to authenticated",
    );
    expect(sql.toLowerCase()).toContain(
      "grant execute on function public.admin_schema_erd() to service_role",
    );
    const page = readFileSync(path.join(process.cwd(), "src/app/admin/schema/page.tsx"), "utf8");
    expect(page).toContain("isAdminRole");
    expect(page).toContain('width="full"');
    expect(page).toContain("loadSchemaErd");
    const people = readFileSync(path.join(process.cwd(), "src/lib/baxter/admin-nav.ts"), "utf8");
    expect(people).toContain('href: "/admin/schema"');
    expect(people).toContain('label: "Schema"');
  });
});

function foreignKey(
  constraintName: string,
  sourceTable: string,
  sourceColumn: string,
  targetTable: string,
): SchemaForeignKey {
  return {
    constraintName,
    sourceTable,
    sourceColumns: [sourceColumn],
    targetTable,
    targetColumns: ["id"],
  };
}

/** The live shape that makes undeduplicated dagre throw. */
const parallelSchema: SchemaErd = {
  tables: [
    table("knowledge_entries", [
      column("id", { primaryKey: true, nullable: false }),
      column("approved_by"),
      column("created_by"),
      column("updated_by"),
    ]),
    table("process_role_assignments", [
      column("id", { primaryKey: true, nullable: false }),
      column("profile_id"),
    ]),
    table("profiles", [column("id", { primaryKey: true, nullable: false })]),
    table("scenes", [column("id", { primaryKey: true, nullable: false }), column("parent_id")]),
  ],
  foreignKeys: [
    foreignKey(
      "knowledge_entries_approved_by_fkey",
      "knowledge_entries",
      "approved_by",
      "profiles",
    ),
    foreignKey("knowledge_entries_created_by_fkey", "knowledge_entries", "created_by", "profiles"),
    foreignKey("knowledge_entries_updated_by_fkey", "knowledge_entries", "updated_by", "profiles"),
    foreignKey(
      "process_role_assignments_profile_fkey",
      "process_role_assignments",
      "profile_id",
      "profiles",
    ),
    foreignKey("scenes_parent_fkey", "scenes", "parent_id", "scenes"),
    foreignKey("profiles_user_fkey", "profiles", "id", "auth.users"),
  ],
};

function renderedEdges(input: SchemaErd) {
  return buildSchemaGraph(input, {
    positions: {},
    expanded: new Set(),
    hiddenGroups: new Set(),
    search: "",
    focus: null,
  }).edges;
}

describe("schema layout on the live relationship shape", () => {
  it("throws in dagre when three parallel edges share a target that has another source", () => {
    const graph = new Graph({ multigraph: true });
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: "LR" });
    for (const name of ["knowledge_entries", "process_role_assignments", "profiles"]) {
      graph.setNode(name, { width: 240, height: 80 });
    }
    graph.setEdge("knowledge_entries", "profiles", {}, "approved_by");
    graph.setEdge("knowledge_entries", "profiles", {}, "created_by");
    graph.setEdge("knowledge_entries", "profiles", {}, "updated_by");
    graph.setEdge("process_role_assignments", "profiles", {}, "profile_id");
    expect(() => layout(graph)).toThrow(/intersection inside of the rectangle/);
  });

  it("lays out three parallel foreign keys and a self-reference without throwing", () => {
    const result = layoutSchema(parallelSchema);
    expect(result.fallback).toBeNull();
    for (const item of parallelSchema.tables) {
      expect(Number.isFinite(result.positions[item.name]?.x)).toBe(true);
      expect(Number.isFinite(result.positions[item.name]?.y)).toBe(true);
    }
    const self = renderedEdges(parallelSchema).find((edge) => edge.id === "scenes_parent_fkey");
    expect(self).toMatchObject({ self: true, source: "scenes", target: "scenes" });
  });

  it("drops a foreign key whose target is outside public and still draws every public one", () => {
    const edges = renderedEdges(parallelSchema);
    const names = new Set(parallelSchema.tables.map((item) => item.name));
    const inside = parallelSchema.foreignKeys.filter(
      (key) => names.has(key.sourceTable) && names.has(key.targetTable),
    );
    expect(edges.find((edge) => edge.id === "profiles_user_fkey")).toBeUndefined();
    expect(edges.map((edge) => edge.id).sort()).toEqual(
      inside.map((key) => key.constraintName).sort(),
    );
    const result = layoutSchema(parallelSchema);
    expect(result.layoutEdgeCount).toBeLessThan(edges.length);
    expect(result.layoutEdgeCount).toBe(2);
    expect(edges).toHaveLength(5);
  });

  it("uses the name grid when the layout engine throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = layoutSchema(parallelSchema, () => {
      throw new Error("Not possible to find intersection inside of the rectangle");
    });
    expect(result.fallback).toBe("Not possible to find intersection inside of the rectangle");
    expect(result.positions).toEqual(gridLayout(parallelSchema));
    expect(result.positions.knowledge_entries).not.toEqual(result.positions.profiles);
    expect(spy).toHaveBeenCalledWith("[schema-erd] automatic layout failed", expect.any(Error));
    spy.mockRestore();
  });
});
