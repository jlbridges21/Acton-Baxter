"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Network, Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { AgentCard } from "@/lib/agents/views";
import {
  AgentAvatar,
  AgentStatusPill,
  EmptyState,
  RuntimePill,
  formatRelative,
  selectClass,
} from "./ui";

const OrgChartCanvas = dynamic(() => import("./org-chart-canvas").then((m) => m.OrgChartCanvas), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-lg bg-[var(--acton-gray-100)]" />,
});

export function AgentDirectory({ agents, isAdmin }: { agents: AgentCard[]; isAdmin: boolean }) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("visible");
  const [showChart, setShowChart] = useState(true);

  const departments = useMemo(
    () => [...new Set(agents.map((a) => a.department).filter(Boolean))] as string[],
    [agents],
  );
  const filtered = agents.filter((a) => {
    if (status === "visible" ? a.status === "archived" : status !== "all" && a.status !== status)
      return false;
    if (department !== "all" && a.department !== department) return false;
    const q = query.trim().toLowerCase();
    return (
      !q ||
      [a.name, a.title, a.description, a.department ?? ""].some((v) => v.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="relative flex-1">
          <span className="sr-only">Search agents</span>
          <Search
            className="absolute top-3.5 left-3 h-4 w-4 text-[var(--acton-muted)]"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, role, or department"
            className="pl-9"
          />
        </label>
        <label className="sm:w-56">
          <span className="sr-only">Department</span>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={selectClass}
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="sm:w-48">
          <span className="sr-only">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={selectClass}
          >
            <option value="visible">All except archived</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
            <option value="all">Everything</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setShowChart((v) => !v)}
          className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm font-medium text-[var(--acton-navy)]"
          aria-pressed={showChart}
        >
          <Network className="h-4 w-4" aria-hidden /> Org chart
        </button>
      </div>

      {showChart ? <OrgChartCanvas agents={agents.filter((a) => a.status !== "archived")} /> : null}

      {filtered.length === 0 ? (
        <EmptyState
          title="No agents match"
          action={
            isAdmin ? (
              <Link
                href="/ai/agents/new"
                className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white"
              >
                <Plus className="h-4 w-4" /> New agent
              </Link>
            ) : null
          }
        >
          Try a different search or filter.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((agent) => (
            <li key={agent.id}>
              <Link
                href={`/ai/agents/${agent.slug}`}
                className="flex h-full flex-col rounded-lg border border-[var(--acton-border)] bg-white p-5 shadow-sm transition hover:border-[var(--acton-navy)]"
              >
                <div className="flex items-start gap-4">
                  <AgentAvatar
                    name={agent.name}
                    url={agent.avatarUrl}
                    size={56}
                    color={agent.departmentColor}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-bold text-[var(--acton-navy)]">{agent.name}</p>
                    <p className="text-sm text-[var(--acton-muted)]">{agent.title}</p>
                    <p className="mt-1 text-xs text-[var(--acton-muted)]">
                      {agent.department ?? "No department"}
                      {agent.managerName ? ` · Reports to ${agent.managerName}` : ""}
                    </p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-3 text-sm text-[var(--acton-navy)]">
                  {agent.description}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                  <AgentStatusPill status={agent.status} />
                  <RuntimePill state={agent.runtime?.state} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--acton-border)] pt-3 text-xs">
                  <div>
                    <dt className="text-[var(--acton-muted)]">AI model</dt>
                    <dd className="truncate font-medium text-[var(--acton-navy)]">{agent.model}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--acton-muted)]">Last activity</dt>
                    <dd className="font-medium text-[var(--acton-navy)]">
                      {formatRelative(agent.runtime?.last_completed_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--acton-muted)]">Configuration</dt>
                    <dd className="font-medium text-[var(--acton-navy)]">
                      {agent.configValid ? `Version ${agent.versionNumber}` : "Needs setup"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--acton-muted)]">Your access</dt>
                    <dd className="font-medium text-[var(--acton-navy)]">
                      {agent.access.includes("manage")
                        ? "Manage"
                        : agent.access.includes("use_via_baxter")
                          ? "Can ask"
                          : "View only"}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
