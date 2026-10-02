"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { SchemaTableNode, type TableFlowNode } from "@/components/admin/schema-table-node";
import { buildSchemaGraph, deriveSchemaGroups } from "@/lib/schema-erd/graph";
import { layoutSchema } from "@/lib/schema-erd/layout";
import { placedPositions, readErdView, writeErdView } from "@/lib/schema-erd/persist";
import type { SchemaEdgeSpec, SchemaErd, SchemaNodeSpec } from "@/lib/schema-erd/types";

const nodeTypes = { table: SchemaTableNode };
const edgeTypes = { self: SelfLoopEdge };

function toFlowNodes(nodes: SchemaNodeSpec[]): TableFlowNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: "table",
    position: node.position,
    hidden: node.hidden,
    sourcePosition: undefined,
    data: {
      name: node.id,
      columns: node.columns,
      foreignKeyColumns: node.foreignKeyColumns,
      expanded: node.expanded,
      focused: node.focused,
      dimmed: node.dimmed,
      hiddenColumnCount: node.hiddenColumnCount,
    },
  }));
}

function toFlowEdges(edges: SchemaEdgeSpec[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: edge.self ? "self" : "smoothstep",
    sourceHandle: edge.self ? "self-out" : "out",
    targetHandle: edge.self ? "self-in" : "in",
    hidden: edge.hidden,
    style: {
      stroke: "var(--acton-navy)",
      strokeWidth: 1.25,
      opacity: edge.dimmed ? 0.12 : 0.85,
    },
    labelStyle: { fill: "var(--acton-navy)", fontSize: 10, opacity: edge.dimmed ? 0.15 : 1 },
    labelBgStyle: { fill: "white", fillOpacity: edge.dimmed ? 0.2 : 0.92 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: "var(--acton-navy)",
    },
  }));
}

function SelfLoopEdge({ sourceX, sourceY, targetX, targetY, markerEnd, style, label }: EdgeProps) {
  const radius = 32;
  const path = `M ${sourceX} ${sourceY} C ${sourceX + radius} ${sourceY - radius}, ${targetX + radius} ${targetY + radius}, ${targetX} ${targetY}`;
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            style={{
              transform: `translate(-50%, -50%) translate(${sourceX + radius}px, ${sourceY - radius}px)`,
            }}
            className="nodrag nopan rounded bg-white/95 px-1 text-[10px] text-[var(--acton-navy)]"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function initialPositions(schema: SchemaErd, userId: string) {
  const groups = deriveSchemaGroups(schema.tables.map((table) => table.name));
  const automatic = layoutSchema(schema);
  const saved = readErdView(
    window.localStorage,
    userId,
    new Set(schema.tables.map((table) => table.name)),
    new Set(groups.map((group) => group.id)),
  );
  return {
    positions: placedPositions(automatic.positions, saved?.positions ?? null),
    layoutNotice: automatic.fallback,
    expanded: saved?.expanded ?? [],
    hiddenGroups: saved?.hiddenGroups ?? [],
    search: saved?.search ?? "",
    focus: saved?.focus ?? null,
  };
}

export function SchemaErdCanvas({ schema, userId }: { schema: SchemaErd; userId: string }) {
  const starting = useState(() => initialPositions(schema, userId))[0];
  const [positions, setPositions] = useState(starting.positions);
  const [expanded, setExpanded] = useState(starting.expanded);
  const [hiddenGroups, setHiddenGroups] = useState(starting.hiddenGroups);
  const [search, setSearch] = useState(starting.search);
  const [focus, setFocus] = useState<string | null>(starting.focus);
  const [layoutNotice, setLayoutNotice] = useState<string | null>(starting.layoutNotice);
  const groups = useMemo(
    () => deriveSchemaGroups(schema.tables.map((table) => table.name)),
    [schema],
  );
  const graph = useMemo(
    () =>
      buildSchemaGraph(schema, {
        positions,
        expanded: new Set(expanded),
        hiddenGroups: new Set(hiddenGroups),
        search,
        focus,
      }),
    [schema, positions, expanded, hiddenGroups, search, focus],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(graph.nodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(graph.edges));
  const flowRef = useRef<ReactFlowInstance<TableFlowNode> | null>(null);
  const fitAfterLayout = useRef(false);
  const visibleKey = graph.nodes
    .filter((node) => !node.hidden)
    .map((node) => node.id)
    .join("\n");
  const fittedKey = useRef<string | null>(null);

  useEffect(() => {
    setNodes(toFlowNodes(graph.nodes));
    setEdges(toFlowEdges(graph.edges));
    const shouldFit = fitAfterLayout.current || fittedKey.current !== visibleKey;
    fitAfterLayout.current = false;
    fittedKey.current = visibleKey;
    if (!shouldFit) return;
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        flowRef.current?.fitView({ padding: 0.12, duration: 0 });
      });
    });
    return () => cancelAnimationFrame(outer);
  }, [graph, setEdges, setNodes, visibleKey]);

  const persist = useCallback(() => {
    writeErdView(window.localStorage, userId, {
      positions,
      expanded,
      hiddenGroups,
      search,
      focus,
    });
  }, [expanded, focus, hiddenGroups, positions, search, userId]);

  useEffect(() => {
    persist();
  }, [persist]);

  const visibleCount = graph.nodes.filter((node) => !node.hidden).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--acton-border)] bg-white px-3 py-2">
        <label className="min-w-0 flex-1 basis-48 text-xs font-medium text-[var(--acton-navy)]">
          <span className="sr-only">Search tables</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tables"
            className="w-full max-w-sm rounded-md border border-[var(--acton-border)] px-2 py-1.5 text-sm"
          />
        </label>
        <p className="text-xs text-[var(--acton-muted)]">
          {schema.tables.length} tables · {schema.foreignKeys.length} relationships
          {visibleCount !== schema.tables.length ? ` · showing ${visibleCount}` : ""}
        </p>
        {layoutNotice ? (
          <p className="basis-full text-xs text-[var(--acton-muted)]" role="status">
            Automatic layout was unavailable ({layoutNotice}). Cards are on a name grid and can
            still be moved.
          </p>
        ) : null}
        <button
          type="button"
          className="rounded-md border border-[var(--acton-border)] px-2 py-1 text-xs font-semibold text-[var(--acton-navy)]"
          onClick={() => {
            const next = layoutSchema(schema);
            fitAfterLayout.current = true;
            setLayoutNotice(next.fallback);
            setPositions(next.positions);
          }}
        >
          Reset layout
        </button>
        {focus ? (
          <button
            type="button"
            className="rounded-md border border-[var(--acton-border)] px-2 py-1 text-xs font-semibold text-[var(--acton-navy)]"
            onClick={() => setFocus(null)}
          >
            Clear focus
          </button>
        ) : null}
        <div className="flex min-w-0 basis-full flex-wrap gap-1.5">
          {groups.map((group) => {
            const hidden = hiddenGroups.includes(group.id);
            return (
              <button
                key={group.id}
                type="button"
                aria-pressed={!hidden}
                className={`max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] ${
                  hidden
                    ? "border-[var(--acton-border)] text-[var(--acton-muted)]"
                    : "border-[var(--acton-navy)] bg-[var(--acton-gray-50)] font-semibold text-[var(--acton-navy)]"
                }`}
                onClick={() =>
                  setHiddenGroups((current) =>
                    current.includes(group.id)
                      ? current.filter((id) => id !== group.id)
                      : [...current, group.id],
                  )
                }
              >
                {group.label} ({group.tables.length})
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={(_event, node) => {
            setExpanded((current) =>
              current.includes(node.id)
                ? current.filter((id) => id !== node.id)
                : [...current, node.id],
            );
            setFocus(node.id);
          }}
          onNodeDragStop={(_event, node) =>
            setPositions((current) => ({ ...current, [node.id]: node.position }))
          }
          onPaneClick={() => setFocus(null)}
          onInit={(instance) => {
            flowRef.current = instance;
          }}
          nodesConnectable={false}
          onlyRenderVisibleElements
          fitView
          fitViewOptions={{ padding: 0.12 }}
          proOptions={{ hideAttribution: false }}
          minZoom={0.08}
          maxZoom={1.5}
        >
          <Background color="var(--acton-border)" gap={20} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            maskColor="rgba(11, 31, 58, 0.08)"
            nodeColor="var(--acton-navy)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
