"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, RotateCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import type { TaskSummary } from "@/lib/agents/task-format";
import type { SpecialistResult } from "@/lib/agents/types";
import { cn } from "@/lib/utils";
import { ResultView } from "./studio-admin-sections";
import {
  AgentAvatar,
  EmptyState,
  Notice,
  Pill,
  TaskStatusPill,
  aiFetch,
  errorMessage,
  formatDateTime,
  formatUsd,
  selectClass,
  useLoad,
} from "./ui";

type AgentLite = {
  id: string;
  name: string;
  avatarUrl: string | null;
  departmentColor: string | null;
  slug: string;
};

const CHANNEL_LABELS: Record<string, string> = {
  web: "Baxter web chat",
  slack: "Baxter in Slack",
  direct: "Direct chat",
  sandbox: "Test run",
  office: "AI Office",
};

export function TaskList({ agents }: { agents: AgentLite[] }) {
  const router = useRouter();
  const search = useSearchParams();
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const agent = search.get("agent") ?? "";
  const status = search.get("status") ?? "";
  const days = search.get("days") ?? "30";
  const byId = new Map(agents.map((a) => [a.id, a]));

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ days });
      if (agent) params.set("agent", agent);
      if (status) params.set("status", status);
      setTasks((await aiFetch<{ tasks: TaskSummary[] }>(`/api/ai/tasks?${params}`)).tasks);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [agent, status, days]);

  useLoad(load);

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(search.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`?${params}`, { scroll: false });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <select
          aria-label="Agent"
          className={selectClass}
          value={agent}
          onChange={(e) => setParam("agent", e.target.value)}
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          className={selectClass}
          value={status}
          onChange={(e) => setParam("status", e.target.value)}
        >
          <option value="">Any status</option>
          <option value="queued">Queued</option>
          <option value="running">In progress</option>
          <option value="awaiting_approval">Awaiting approval</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          aria-label="Time period"
          className={selectClass}
          value={days}
          onChange={(e) => setParam("days", e.target.value)}
        >
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!tasks ? (
        <div className="h-40 animate-pulse rounded-lg bg-[var(--acton-gray-100)]" />
      ) : tasks.length === 0 ? (
        <EmptyState title="No tasks to show">
          Tasks appear when Baxter hands work to a specialist, when someone chats with an agent
          directly, or when a manager runs a test. You only see tasks you started or agents whose
          activity you&apos;re allowed to review.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--acton-border)] rounded-lg border border-[var(--acton-border)] bg-white">
          {tasks.map((t) => {
            const a = byId.get(t.assignedAgentId);
            const from = t.assigningAgentId ? byId.get(t.assigningAgentId) : null;
            return (
              <li key={t.id}>
                <Link
                  href={`/ai/tasks/${t.id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-[var(--acton-gray-50)]"
                >
                  <AgentAvatar
                    name={a?.name ?? "?"}
                    url={a?.avatarUrl}
                    size={32}
                    color={a?.departmentColor}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--acton-navy)]">
                      {t.title || "Untitled task"}
                    </p>
                    <p className="text-xs text-[var(--acton-muted)]">
                      {from ? `${from.name} → ` : ""}
                      {a?.name ?? "Agent"} · {CHANNEL_LABELS[t.channel] ?? t.channel} ·{" "}
                      {t.initiatingUserLabel ?? "Unknown"} · {formatDateTime(t.createdAt)}
                    </p>
                  </div>
                  {t.sensitivity === "confidential" ? (
                    <Pill className="bg-amber-100 text-amber-900">Confidential</Pill>
                  ) : null}
                  <TaskStatusPill status={t.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type TaskDetailData = {
  task: TaskSummary & {
    instructions: string;
    result: SpecialistResult | null;
    errorMessage: string | null;
    routing: Record<string, unknown>;
    cancelRequested: boolean;
    maxAttempts: number;
  };
  events: Array<{
    id: string;
    type: string;
    message: string;
    createdAt: string;
    data: Record<string, unknown>;
  }>;
  approvals: Array<{ id: string; title: string; status: string; actionType: string }>;
  can: { cancel: boolean; retry: boolean };
};

export function TaskDetail({ id, agents }: { id: string; agents: AgentLite[] }) {
  const [data, setData] = useState<TaskDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const byId = new Map(agents.map((a) => [a.id, a]));

  const load = useCallback(async () => {
    try {
      setData(await aiFetch<TaskDetailData>(`/api/ai/tasks/${id}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useLoad(load);

  // Refresh while the task is still moving (reads persisted state; no model calls).
  const active = data && ["queued", "running"].includes(data.task.status);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(t);
  }, [active, load]);

  async function act(kind: "cancel" | "retry") {
    setBusy(true);
    try {
      await aiFetch(`/api/ai/tasks/${id}/${kind}`, { method: "POST" });
      setConfirmCancel(false);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data)
    return error ? (
      <Notice tone="error">{error}</Notice>
    ) : (
      <div className="h-64 animate-pulse rounded-lg bg-[var(--acton-gray-100)]" />
    );
  const t = data.task;
  const agent = byId.get(t.assignedAgentId);
  const manager = t.assigningAgentId ? byId.get(t.assigningAgentId) : null;
  return (
    <div className="space-y-6">
      <Link
        href="/ai/tasks"
        className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
      >
        ← All tasks
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">{t.title || "Task"}</h1>
          <p className="text-sm text-[var(--acton-muted)]">
            Requested by {t.initiatingUserLabel ?? "unknown"} via{" "}
            {CHANNEL_LABELS[t.channel] ?? t.channel} · {formatDateTime(t.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TaskStatusPill status={t.status} />
          {data.can.cancel ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirmCancel(true)}
              disabled={t.cancelRequested}
            >
              <XCircle className="h-4 w-4" /> {t.cancelRequested ? "Stopping…" : "Cancel"}
            </Button>
          ) : null}
          {data.can.retry ? (
            <Button size="sm" onClick={() => act("retry")} disabled={busy}>
              <RotateCw className="h-4 w-4" /> Retry
            </Button>
          ) : null}
        </div>
      </header>
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card>
        <CardTitle>Assignment</CardTitle>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {manager ? (
            <>
              <span className="flex items-center gap-2">
                <AgentAvatar
                  name={manager.name}
                  url={manager.avatarUrl}
                  size={28}
                  color={manager.departmentColor}
                />{" "}
                {manager.name}
              </span>
              <ArrowRight className="h-4 w-4 text-[var(--acton-muted)]" aria-label="assigned to" />
            </>
          ) : null}
          {agent ? (
            <span className="flex items-center gap-2">
              <AgentAvatar
                name={agent.name}
                url={agent.avatarUrl}
                size={28}
                color={agent.departmentColor}
              />{" "}
              {agent.name}
            </span>
          ) : null}
        </div>
        {typeof t.routing?.explanation === "string" ? (
          <p className="mt-2 text-sm text-[var(--acton-muted)]">
            Why: {t.routing.explanation as string}
          </p>
        ) : null}
        <pre className="mt-3 rounded-md bg-[var(--acton-gray-50)] p-3 text-sm whitespace-pre-wrap text-[var(--acton-navy)]">
          {t.instructions}
        </pre>
      </Card>

      {t.result ? (
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <CardTitle>Result</CardTitle>
            <Pill className="bg-slate-100 text-slate-700">
              {t.result.outcome.replace(/_/g, " ")}
            </Pill>
          </div>
          <ResultView result={t.result} />
        </Card>
      ) : null}
      {t.status === "failed" ? (
        <Notice tone="error">
          <b>{t.errorCode}</b> — {t.errorMessage ?? "The task failed."}
        </Notice>
      ) : null}
      {data.approvals.length ? (
        <Card>
          <CardTitle>Approvals</CardTitle>
          <ul className="mt-2 space-y-1 text-sm">
            {data.approvals.map((a) => (
              <li key={a.id} className="flex justify-between gap-2">
                <Link href="/ai/approvals" className="underline">
                  {a.title}
                </Link>
                <Pill
                  className={
                    a.status === "pending"
                      ? "bg-violet-100 text-violet-900"
                      : "bg-slate-100 text-slate-700"
                  }
                >
                  {a.status}
                </Pill>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card>
          <CardTitle>Execution log</CardTitle>
          <p className="mt-1 text-xs text-[var(--acton-muted)]">
            What happened, step by step. Internal model reasoning is not recorded.
          </p>
          <ol className="mt-3 space-y-2 border-l-2 border-[var(--acton-border)] pl-4">
            {data.events.map((e) => (
              <li
                key={e.id}
                className={cn(
                  "text-sm",
                  e.type.includes("fail") || e.type.includes("blocked")
                    ? "text-red-800"
                    : "text-[var(--acton-navy)]",
                )}
              >
                <span className="text-xs text-[var(--acton-muted)]">
                  {formatDateTime(e.createdAt)}
                </span>{" "}
                — {e.message}
              </li>
            ))}
          </ol>
        </Card>
        <Card className="space-y-2 self-start text-sm">
          <CardTitle>Usage</CardTitle>
          <div className="flex justify-between">
            <span className="text-[var(--acton-muted)]">Model</span>
            <span>{t.model ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--acton-muted)]">Tokens in / out</span>
            <span>
              {t.inputTokens.toLocaleString()} / {t.outputTokens.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--acton-muted)]">Estimated cost</span>
            <span>{formatUsd(t.costUsd)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--acton-muted)]">Attempts</span>
            <span>
              {t.attempts} of {t.maxAttempts}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--acton-muted)]">Finished</span>
            <span>{formatDateTime(t.completedAt)}</span>
          </div>
        </Card>
      </div>
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => act("cancel")}
        busy={busy}
        title="Cancel this task?"
        description="If the agent is mid-step it stops at the next safe point. Nothing it already saved is undone."
        confirmLabel="Cancel task"
        destructive
      />
    </div>
  );
}
