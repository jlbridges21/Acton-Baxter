import { Graph, layout } from "@dagrejs/dagre";
import { foreignKeyColumns } from "@/lib/schema-erd/graph";
import type { SchemaErd, SchemaPoint } from "@/lib/schema-erd/types";

export const SCHEMA_CARD_WIDTH = 240;
const CARD_HEADER = 32;
const CARD_ROW = 22;

function collapsedHeight(columnCount: number): number {
  return CARD_HEADER + Math.max(columnCount, 1) * CARD_ROW;
}

/** One left-to-right pass. Callers must not invoke this on every render. */
export function layoutSchema(schema: SchemaErd): Record<string, SchemaPoint> {
  const graph = new Graph({ multigraph: true });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 64, marginx: 16, marginy: 16 });
  const names = new Set(schema.tables.map((table) => table.name));
  for (const table of schema.tables) {
    const keys = foreignKeyColumns(table.name, schema.foreignKeys);
    const keyColumns = new Set(keys);
    const rows = table.columns.filter(
      (column) => column.primaryKey || keyColumns.has(column.name),
    ).length;
    graph.setNode(table.name, { width: SCHEMA_CARD_WIDTH, height: collapsedHeight(rows) });
  }
  for (const key of schema.foreignKeys) {
    if (key.sourceTable === key.targetTable) continue;
    if (!names.has(key.sourceTable) || !names.has(key.targetTable)) continue;
    graph.setEdge(key.sourceTable, key.targetTable, {}, key.constraintName);
  }
  layout(graph);
  const positions: Record<string, SchemaPoint> = {};
  for (const table of schema.tables) {
    const node = graph.node(table.name);
    const width = node.width ?? SCHEMA_CARD_WIDTH;
    const height = node.height ?? collapsedHeight(1);
    positions[table.name] = { x: node.x - width / 2, y: node.y - height / 2 };
  }
  return positions;
}
