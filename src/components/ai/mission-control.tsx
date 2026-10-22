"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { TaskSummary } from "@/lib/agents/task-format";
import type { AgentCard } from "@/lib/agents/views";
import {
  AgentAvatar,
  AgentStatusPill,
  EmptyState,
  Notice,
  RuntimePill,
  TaskStatusPill,
  aiFetch,
  errorMessage,
  formatDateTime,
  formatUsd,
  selectClass,
  useLoad,
} from "./ui";

type MissionData = {
  agents: { registered: number; active: number; busy: number };
  tasks: {
    total: number;
    running: number;
    awaitingApproval: number;
    completed: number;
    failed: number;
    cancelled: number;
    delegated: number;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    byModel: Array<{
      provider: string;
      model: string;
      tasks: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      costKnown: boolean;
    }>;
  };
  pendingApprovals: number;
  recent: TaskSummary[];
  failures: TaskSummary[];
  cards: AgentCard[];
};

function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
}) {
  const body = (
    <div className="rounded-lg border border-[var(--acton-border)] bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-[var(--acton-navy)] tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-[var(--acton-muted)]">{hint}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

export function MissionControl({
  departments,
}: {
  departments: Array<{ id: string; name: string }>;
}) {
  const [filters, setFilters] = useState({ days: "7", agent: "", department: "", status: "" });
  const [data, setData] = useState<MissionData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
      setData(await aiFetch<MissionData>(`/api/ai/mission-control?${params}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [filters]);

  useLoad(load);

  const agentName = (id: string) => data?.cards.find((c) => c.id === id)?.name ?? "Agent";

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <select
          aria-label="Time period"
          className={selectClass}
          value={filters.days}
          onChange={(e) => setFilters({ ...filters, days: e.target.value })}
        >
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <select
          aria-label="Agent"
          className={selectClass}
          value={filters.agent}
          onChange={(e) => setFilters({ ...filters, agent: e.target.value })}
        >
          <option value="">All agents</option>
          {data?.cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Department"
          className={selectClass}
          value={filters.department}
          onChange={(e) => setFilters({ ...filters, department: e.target.value })}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Task status"
          className={selectClass}
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="">Any status</option>
          <option value="running">In progress</option>
          <option value="awaiting_approval">Awaiting approval</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!data ? (
        <div className="h-64 animate-pulse rounded-lg bg-[var(--acton-gray-100)]" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Stat
              label="Agents"
              value={data.agents.registered}
              hint={`${data.agents.active} active`}
              href="/ai/agents"
            />
            <Stat label="Busy now" value={data.agents.busy} hint="Doing real work" href="/ai" />
            <Stat label="In progress" value={data.tasks.running} href="/ai/tasks?status=running" />
            <Stat
              label="Completed"
              value={data.tasks.completed}
              href="/ai/tasks?status=completed"
            />
            <Stat label="Failed" value={data.tasks.failed} href="/ai/tasks?status=failed" />
            <Stat label="Approvals waiting" value={data.pendingApprovals} href="/ai/approvals" />
            <Stat
              label="Est. AI cost"
              value={formatUsd(data.usage.costUsd)}
              hint={`${(data.usage.inputTokens + data.usage.outputTokens).toLocaleString()} tokens`}
            />
          </div>

          <Card>
            <CardTitle>Agents: configuration, availability, and activity</CardTitle>
            <CardDescription>
              An agent can be available without doing anything — “Right now” only changes when there
              is real work.
            </CardDescription>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-[var(--acton-muted)] uppercase">
                  <tr>
                    <th className="py-2">Agent</th>
                    <th className="py-2">Configuration</th>
                    <th className="py-2">Availability</th>
                    <th className="py-2">Right now</th>
                    <th className="py-2">Model</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cards.map((c) => (
                    <tr key={c.id} className="border-t border-[var(--acton-border)]">
                      <td className="py-2">
                        <Link
                          href={`/ai/agents/${c.slug}`}
                          className="flex items-center gap-2 font-medium text-[var(--acton-navy)] hover:underline"
                        >
                          <AgentAvatar
                            name={c.name}
                            url={c.avatarUrl}
                            size={28}
                            color={c.departmentColor}
                          />{" "}
                          {c.name}
                        </Link>
                      </td>
                      <td className="py-2">
                        {c.configValid ? (
                          `Published v${c.versionNumber}`
                        ) : (
                          <span className="text-red-700">Not published</span>
                        )}
                      </td>
                      <td className="py-2">
                        <AgentStatusPill status={c.status} />
                      </td>
                      <td className="py-2">
                        <RuntimePill state={c.runtime?.state} />
                      </td>
                      <td className="py-2 text-[var(--acton-muted)]">{c.model}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardTitle>Usage by model</CardTitle>
              <CardDescription>
                Costs are estimates from list prices; check provider invoices for actual spend.
              </CardDescription>
              {data.usage.byModel.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--acton-muted)]">
                  No model usage in this period.
                </p>
              ) : (
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="text-xs text-[var(--acton-muted)] uppercase">
                    <tr>
                      <th className="py-1">Model</th>
                      <th className="py-1 text-right">Tasks</th>
                      <th className="py-1 text-right">Tokens</th>
                      <th className="py-1 text-right">Est. cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.usage.byModel.map((m) => (
                      <tr
                        key={`${m.provider}:${m.model}`}
                        className="border-t border-[var(--acton-border)]"
                      >
                        <td className="py-1.5">
                          {m.model}{" "}
                          <span className="text-xs text-[var(--acton-muted)]">({m.provider})</span>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{m.tasks}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {(m.inputTokens + m.outputTokens).toLocaleString()}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {m.costKnown ? formatUsd(m.costUsd) : "unknown"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card>
              <CardTitle>Errors and warnings</CardTitle>
              {data.failures.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--acton-muted)]">
                  No failed tasks in this period.
                </p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {data.failures.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/ai/tasks/${t.id}`}
                        className="flex justify-between gap-2 hover:underline"
                      >
                        <span className="truncate">
                          {agentName(t.assignedAgentId)}: {t.title}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-red-700">
                          {t.errorCode}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <CardTitle>Recent delegation activity</CardTitle>
            {data.recent.length === 0 ? (
              <EmptyState title="No activity in this period" />
            ) : (
              <ul className="mt-3 divide-y divide-[var(--acton-border)]">
                {data.recent.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/ai/tasks/${t.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm hover:bg-[var(--acton-gray-50)]"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {t.assigningAgentId ? `${agentName(t.assigningAgentId)} → ` : ""}
                        {agentName(t.assignedAgentId)}: {t.title}
                      </span>
                      <span className="text-xs text-[var(--acton-muted)]">
                        {formatDateTime(t.createdAt)}
                      </span>
                      <TaskStatusPill status={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
