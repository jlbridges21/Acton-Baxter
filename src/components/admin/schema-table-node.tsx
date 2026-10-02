"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { SchemaColumn } from "@/lib/schema-erd/types";

export type TableNodeData = {
  name: string;
  columns: SchemaColumn[];
  foreignKeyColumns: string[];
  expanded: boolean;
  focused: boolean;
  dimmed: boolean;
  hiddenColumnCount: number;
  linked: boolean;
};

export type TableFlowNode = Node<TableNodeData, "table">;

const handleClass = "!h-2 !w-2 !border-0 !bg-[var(--acton-navy)]";

export function SchemaTableNode({ data }: NodeProps<TableFlowNode>) {
  const foreignKeys = new Set(data.foreignKeyColumns);
  return (
    <div
      role="group"
      aria-label={data.linked ? `${data.name}, linked table` : data.name}
      className={`w-[240px] overflow-hidden rounded-md border bg-white text-left shadow-sm ${
        data.focused
          ? "border-[var(--acton-navy)] ring-2 ring-[var(--acton-navy)]"
          : data.linked
            ? "border-dashed border-[var(--acton-border)]"
            : "border-[var(--acton-border)]"
      } ${data.dimmed ? "opacity-20" : ""}`}
    >
      <Handle id="in" type="target" position={Position.Left} className={handleClass} />
      <Handle id="out" type="source" position={Position.Right} className={handleClass} />
      <Handle
        id="self-out"
        type="source"
        position={Position.Top}
        className={handleClass}
        style={{ left: "auto", right: 18 }}
      />
      <Handle
        id="self-in"
        type="target"
        position={Position.Bottom}
        className={handleClass}
        style={{ left: "auto", right: 18 }}
      />
      <div
        className={`flex min-w-0 items-center justify-between gap-2 px-2 py-1.5 ${
          data.linked
            ? "bg-[var(--acton-gray-50)] text-[var(--acton-navy)]"
            : "bg-[var(--acton-navy)] text-white"
        }`}
      >
        <span className="truncate text-xs font-semibold" title={data.name}>
          {data.name}
        </span>
        <span
          className={`shrink-0 text-[10px] font-medium ${data.linked ? "text-[var(--acton-muted)]" : "text-white/80"}`}
        >
          {data.linked ? "Linked · " : ""}
          {data.expanded
            ? "All columns"
            : data.hiddenColumnCount > 0
              ? `${data.hiddenColumnCount} more`
              : "Keys"}
        </span>
      </div>
      {data.columns.length === 0 ? (
        <p className="border-t border-[var(--acton-border)] px-2 py-1 text-[11px] text-[var(--acton-muted)]">
          No key columns
        </p>
      ) : (
        <ul>
          {data.columns.map((column) => {
            const foreignKey = foreignKeys.has(column.name);
            const badge = column.primaryKey ? "PK" : foreignKey ? "FK" : "";
            return (
              <li
                key={column.name}
                className="flex min-w-0 items-center gap-1 border-t border-[var(--acton-border)] px-2 py-0.5 text-[11px]"
                title={`${column.name} ${column.dataType}${column.nullable ? ", null" : ""}${column.primaryKey ? ", primary key" : ""}${foreignKey ? ", foreign key" : ""}`}
              >
                <span className="w-6 shrink-0 font-semibold text-[var(--acton-muted)]">
                  {badge}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-[var(--acton-navy)]">
                  {column.name}
                </span>
                <span className="max-w-[42%] shrink truncate text-[var(--acton-muted)]">
                  {column.dataType}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
