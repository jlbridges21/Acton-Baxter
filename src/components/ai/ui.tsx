"use client";

/**
 * Shared AI Workspace UI pieces: fetch helper, portraits, status labels, form fields.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  LibraryBig,
  ListChecks,
  Building2,
  UsersRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function aiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers:
      init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json", ...(init.headers ?? {}) }
        : init?.headers,
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: string };
  };
  if (!response.ok) {
    throw new ApiError(
      payload.error?.message ?? "Something went wrong. Please try again.",
      response.status,
      payload.error?.code ?? null,
    );
  }
  return payload;
}

/**
 * Run an async loader on mount and whenever it changes. State updates happen in the
 * promise callback (not synchronously in the effect), matching React's effect guidance.
 */
export function useLoad(load: () => Promise<void>) {
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => (active ? load() : undefined));
    return () => {
      active = false;
    };
  }, [load]);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const TABS = [
  { href: "/ai", label: "AI Office", icon: Building2, exact: true },
  { href: "/ai/agents", label: "Agents", icon: UsersRound },
  { href: "/ai/knowledge", label: "Knowledge Hub", icon: LibraryBig },
  { href: "/ai/operations", label: "Sam Operations", icon: BriefcaseBusiness },
  { href: "/ai/onboarding", label: "Onboarding", icon: ListChecks },
  { href: "/ai/tasks", label: "Tasks", icon: ClipboardCheck },
  { href: "/ai/approvals", label: "Approvals", icon: CheckCircle2 },
  { href: "/ai/mission-control", label: "Mission Control", icon: Gauge },
];

export function WorkspaceTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="AI Workspace sections"
      className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-[var(--acton-border)] pb-px"
    >
      {TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium",
              active
                ? "border-[var(--acton-yellow)] text-[var(--acton-navy)]"
                : "border-transparent text-[var(--acton-muted)] hover:text-[var(--acton-navy)]",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portraits
// ---------------------------------------------------------------------------

export function AgentAvatar({
  name,
  url,
  size = 40,
  color,
  className,
}: {
  name: string;
  url: string | null | undefined;
  size?: number;
  color?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white",
          className,
        )}
        style={{
          width: size,
          height: size,
          fontSize: Math.max(10, size * 0.4),
          background: color ?? "var(--acton-navy)",
        }}
        role="img"
        aria-label={`${name} portrait`}
      >
        {name.slice(0, 1).toUpperCase() || <Bot className="h-1/2 w-1/2" />}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- runtime-uploaded or bundled portrait
    <img
      src={url}
      alt={`${name} portrait`}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full object-cover", className)}
      style={{ width: size, height: size }}
    />
  );
}

// ---------------------------------------------------------------------------
// Status labels (plain English; availability ≠ activity)
// ---------------------------------------------------------------------------

export const RUNTIME_STATE_LABELS: Record<string, { label: string; tone: string; dot: string }> = {
  idle: { label: "Available", tone: "bg-slate-100 text-slate-700", dot: "bg-slate-400" },
  receiving: { label: "Receiving assignment", tone: "bg-sky-100 text-sky-900", dot: "bg-sky-500" },
  working: { label: "Working", tone: "bg-amber-100 text-amber-900", dot: "bg-amber-500" },
  awaiting_result: {
    label: "Waiting on a specialist",
    tone: "bg-indigo-100 text-indigo-900",
    dot: "bg-indigo-500",
  },
  awaiting_approval: {
    label: "Waiting for approval",
    tone: "bg-violet-100 text-violet-900",
    dot: "bg-violet-500",
  },
  completed: {
    label: "Just finished",
    tone: "bg-emerald-100 text-emerald-900",
    dot: "bg-emerald-500",
  },
  blocked: { label: "Blocked", tone: "bg-red-100 text-red-800", dot: "bg-red-500" },
  failed: { label: "Recent task failed", tone: "bg-red-100 text-red-800", dot: "bg-red-500" },
};

export const TASK_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "bg-sky-100 text-sky-900" },
  running: { label: "In progress", tone: "bg-amber-100 text-amber-900" },
  awaiting_approval: { label: "Awaiting approval", tone: "bg-violet-100 text-violet-900" },
  completed: { label: "Completed", tone: "bg-emerald-100 text-emerald-900" },
  failed: { label: "Failed", tone: "bg-red-100 text-red-800" },
  cancelled: { label: "Cancelled", tone: "bg-slate-100 text-slate-700" },
};

export const AGENT_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "bg-emerald-100 text-emerald-900" },
  draft: { label: "Draft — not answering yet", tone: "bg-slate-100 text-slate-700" },
  paused: { label: "Paused", tone: "bg-amber-100 text-amber-900" },
  archived: { label: "Archived", tone: "bg-slate-200 text-slate-600" },
};

export function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function RuntimePill({ state }: { state: string | null | undefined }) {
  const s = RUNTIME_STATE_LABELS[state ?? "idle"] ?? RUNTIME_STATE_LABELS.idle!;
  return (
    <Pill className={s.tone}>
      <span className={cn("h-2 w-2 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </Pill>
  );
}

export function TaskStatusPill({ status }: { status: string }) {
  const s = TASK_STATUS_LABELS[status] ?? { label: status, tone: "bg-slate-100 text-slate-700" };
  return <Pill className={s.tone}>{s.label}</Pill>;
}

export function AgentStatusPill({ status }: { status: string }) {
  const s = AGENT_STATUS_LABELS[status] ?? { label: status, tone: "bg-slate-100" };
  return <Pill className={s.tone}>{s.label}</Pill>;
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export function Field({
  label,
  help,
  htmlFor,
  children,
  error,
}: {
  label: string;
  help?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  error?: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-[var(--acton-navy)]">
        {label}
      </label>
      {help ? <p className="text-xs text-[var(--acton-muted)]">{help}</p> : null}
      {children}
      {error ? <p className="text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  );
}

export const textareaClass =
  "block w-full rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-sm text-[var(--acton-navy)] shadow-sm placeholder:text-[var(--acton-muted)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none";

export const selectClass =
  "block h-11 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-navy)] shadow-sm focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none";

export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "warning" | "error" | "success";
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-md border px-3 py-2 text-sm", tones[tone], className)}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--acton-border)] bg-white px-6 py-10 text-center">
      <p className="text-base font-semibold text-[var(--acton-navy)]">{title}</p>
      {children ? (
        <div className="mx-auto mt-1 max-w-xl text-sm text-[var(--acton-muted)]">{children}</div>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}
