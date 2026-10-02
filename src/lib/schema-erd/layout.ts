import { Graph, layout as dagreLayout } from "@dagrejs/dagre";
import { foreignKeyColumns } from "@/lib/schema-erd/graph";
import type { SchemaErd, SchemaPoint } from "@/lib/schema-erd/types";

export const SCHEMA_CARD_WIDTH = 240;
const CARD_HEADER = 32;
const CARD_ROW = 22;
const GRID_COLUMNS = 8;
const GRID_GAP_X = SCHEMA_CARD_WIDTH + 64;
const GRID_GAP_Y = 180;

export type SchemaLayoutResult = {
  positions: Record<string, SchemaPoint>;
  /** Dagre's message when positions came from the name grid. */
  fallback: string | null;
  /** Unique ordered pairs sent to the ranker. Self-edges and outside targets are omitted. */
  layoutEdgeCount: number;
};

type LayoutEngine = (graph: Graph) => void;

function collapsedHeight(columnCount: number): number {
  return CARD_HEADER + Math.max(columnCount, 1) * CARD_ROW;
}

function tableNames(schema: SchemaErd): Set<string> {
  return new Set(schema.tables.map((table) => table.name));
}

/** One edge per ordered pair. Parallel foreign keys do not change card placement. */
export function layoutEdgePairs(schema: SchemaErd): Array<[string, string]> {
  const names = tableNames(schema);
  const seen = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (const key of schema.foreignKeys) {
    if (key.sourceTable === key.targetTable) continue;
    if (!names.has(key.sourceTable) || !names.has(key.targetTable)) continue;
    const id = `${key.sourceTable}\0${key.targetTable}`;
    if (seen.has(id)) continue;
    seen.add(id);
    pairs.push([key.sourceTable, key.targetTable]);
  }
  return pairs;
}

/** Stable rows ordered by table name. Used when the layout engine throws. */
export function gridLayout(schema: SchemaErd): Record<string, SchemaPoint> {
  const names = [...tableNames(schema)].sort((a, b) => a.localeCompare(b));
  const positions: Record<string, SchemaPoint> = {};
  names.forEach((name, index) => {
    positions[name] = {
      x: (index % GRID_COLUMNS) * GRID_GAP_X,
      y: Math.floor(index / GRID_COLUMNS) * GRID_GAP_Y,
    };
  });
  return positions;
}

function rankSchema(schema: SchemaErd, engine: LayoutEngine): Record<string, SchemaPoint> {
  const graph = new Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 64, marginx: 16, marginy: 16 });
  for (const table of schema.tables) {
    const keys = foreignKeyColumns(table.name, schema.foreignKeys);
    const keyColumns = new Set(keys);
    const rows = table.columns.filter(
      (column) => column.primaryKey || keyColumns.has(column.name),
    ).length;
    graph.setNode(table.name, { width: SCHEMA_CARD_WIDTH, height: collapsedHeight(rows) });
  }
  for (const [source, target] of layoutEdgePairs(schema)) {
    graph.setEdge(source, target);
  }
  engine(graph);
  const positions: Record<string, SchemaPoint> = {};
  for (const table of schema.tables) {
    const node = graph.node(table.name);
    const width = node?.width ?? SCHEMA_CARD_WIDTH;
    const height = node?.height ?? collapsedHeight(1);
    const x = node?.x;
    const y = node?.y;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      throw new Error(`Layout did not place ${table.name}.`);
    }
    positions[table.name] = { x: x - width / 2, y: y - height / 2 };
  }
  return positions;
}

/** One left-to-right pass. Callers must not invoke this on every render. */
export function layoutSchema(
  schema: SchemaErd,
  engine: LayoutEngine = dagreLayout,
): SchemaLayoutResult {
  const layoutEdgeCount = layoutEdgePairs(schema).length;
  try {
    return { positions: rankSchema(schema, engine), fallback: null, layoutEdgeCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automatic layout failed.";
    console.error("[schema-erd] automatic layout failed", error);
    return { positions: gridLayout(schema), fallback: message, layoutEdgeCount };
  }
}
