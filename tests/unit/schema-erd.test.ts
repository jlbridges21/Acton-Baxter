import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSchemaGraph, deriveSchemaGroups, visibleColumns } from "@/lib/schema-erd/graph";
import { layoutSchema } from "@/lib/schema-erd/layout";
import { parseErdPersisted, placedPositions, readErdView } from "@/lib/schema-erd/persist";
import type { SchemaErd, SchemaTable } from "@/lib/schema-erd/types";

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
    const positions = layoutSchema(schema);
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
