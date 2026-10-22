"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AgentCard } from "@/lib/agents/views";
import { AgentAvatar, RuntimePill } from "./ui";

type OrgNodeData = { agent: AgentCard };
type OrgNode = Node<OrgNodeData, "agent">;

function AgentNode({ data }: NodeProps<OrgNode>) {
  const a = data.agent;
  return (
    <div
      className="w-60 rounded-lg border-2 bg-white p-3 shadow-sm"
      style={{ borderColor: a.departmentColor ?? "#0b1f3a" }}
    >
      <Handle type="target" position={Position.Top} className="!bg-[var(--acton-navy)]" />
      <div className="flex items-center gap-3">
        <AgentAvatar name={a.name} url={a.avatarUrl} size={40} color={a.departmentColor} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[var(--acton-navy)]">{a.name}</p>
          <p className="truncate text-xs text-[var(--acton-muted)]">{a.title}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-[var(--acton-muted)]">
          {a.department ?? "No department"}
        </span>
        <RuntimePill state={a.runtime?.state} />
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-[var(--acton-navy)]" />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

/** Simple top-down tree from manager links (each level centered under the root). */
export function layoutOrgChart(agents: AgentCard[]): { nodes: OrgNode[]; edges: Edge[] } {
  const children = new Map<string | null, AgentCard[]>();
  const ids = new Set(agents.map((a) => a.id));
  for (const a of agents) {
    const parent = a.managerId && ids.has(a.managerId) ? a.managerId : null;
    children.set(parent, [...(children.get(parent) ?? []), a]);
  }
  const levels: AgentCard[][] = [];
  let frontier = children.get(null) ?? [];
  const seen = new Set<string>();
  while (frontier.length && levels.length < 10) {
    const fresh = frontier.filter((a) => !seen.has(a.id));
    fresh.forEach((a) => seen.add(a.id));
    levels.push(fresh);
    frontier = fresh.flatMap((a) => children.get(a.id) ?? []);
  }
  const W = 280;
  const H = 170;
  const widest = Math.max(...levels.map((l) => l.length), 1);
  const nodes: OrgNode[] = levels.flatMap((level, depth) =>
    level.map((agent, i) => ({
      id: agent.id,
      type: "agent" as const,
      position: { x: ((widest - level.length) / 2 + i) * W, y: depth * H },
      data: { agent },
      draggable: false,
    })),
  );
  const edges: Edge[] = agents
    .filter((a) => a.managerId && seen.has(a.id) && seen.has(a.managerId))
    .map((a) => ({
      id: `${a.managerId}-${a.id}`,
      source: a.managerId!,
      target: a.id,
      type: "smoothstep",
      style: { stroke: "#5b6b7c", strokeWidth: 2 },
    }));
  return { nodes, edges };
}

export function OrgChartCanvas({ agents }: { agents: AgentCard[] }) {
  const router = useRouter();
  const { nodes, edges } = useMemo(() => layoutOrgChart(agents), [agents]);
  return (
    <div className="h-[420px] rounded-lg border border-[var(--acton-border)] bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        nodesConnectable={false}
        onNodeClick={(_e, node) =>
          router.push(`/ai/agents/${(node.data as OrgNodeData).agent.slug}`)
        }
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} color="#e8edf3" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
