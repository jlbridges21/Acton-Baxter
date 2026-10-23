"use client";

/**
 * Shared pieces for Sam Operations Studio: the state hook (one GET, validated POST commands),
 * types derived from the server loaders, and small presentational helpers.
 */

import { createContext, useCallback, useContext, useState } from "react";
import { Pill, aiFetch, errorMessage, selectClass, useLoad } from "@/components/ai/ui";
import type { loadOpsState } from "@/lib/ops/commands";
import { cn } from "@/lib/utils";

export type OpsState = Awaited<ReturnType<typeof loadOpsState>>;
export type FullOpsState = Extract<OpsState, { limited: false }>;
export type ActionView = FullOpsState["actions"][number];
export type InstanceView = OpsState["myWorkflows"][number];
export type InboxStep = OpsState["inbox"][number];
export type TemplateView = FullOpsState["templates"][number];
export type Profile = FullOpsState["profiles"][number];

type OpsCtx = {
  state: OpsState | null;
  error: string | null;
  reload: () => Promise<void>;
  /** Run a command; returns the result or null (and sets a toast) on failure. */
  run: <T = unknown>(command: Record<string, unknown>, success?: string) => Promise<T | null>;
  busy: boolean;
  toast: { tone: "success" | "error"; text: string } | null;
  clearToast: () => void;
};

const Ctx = createContext<OpsCtx | null>(null);

export function useOps(): OpsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOps must be used inside <OpsProvider>");
  return v;
}

export function useFullOps(): OpsCtx & { full: FullOpsState | null } {
  const ctx = useOps();
  return { ...ctx, full: ctx.state && !ctx.state.limited ? (ctx.state as FullOpsState) : null };
}

export function OpsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OpsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<OpsCtx["toast"]>(null);

  const reload = useCallback(async () => {
    try {
      setState(await aiFetch<OpsState>("/api/ops"));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useLoad(reload);

  const run = useCallback(
    async <T,>(command: Record<string, unknown>, success?: string): Promise<T | null> => {
      setBusy(true);
      try {
        const res = await aiFetch<{ result: T }>("/api/ops", {
          method: "POST",
          body: JSON.stringify(command),
        });
        if (success) setToast({ tone: "success", text: success });
        await reload();
        return res.result;
      } catch (e) {
        setToast({ tone: "error", text: errorMessage(e) });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  return (
    <Ctx.Provider
      value={{ state, error, reload, run, busy, toast, clearToast: () => setToast(null) }}
    >
      {children}
    </Ctx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------
const TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  amber: "bg-amber-50 text-amber-900 ring-1 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-1 ring-red-200",
  blue: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
  gray: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
  violet: "bg-violet-50 text-violet-800 ring-1 ring-violet-200",
};

const STATUS_TONE: Record<string, [string, string]> = {
  // workflows
  pending_approval: ["Awaiting approval", "amber"],
  active: ["Active", "blue"],
  paused: ["Paused", "gray"],
  completed: ["Completed", "green"],
  cancelled: ["Cancelled", "gray"],
  failed: ["Failed", "red"],
  // steps
  blocked: ["Waiting on earlier steps", "gray"],
  ready: ["Ready", "blue"],
  in_progress: ["In progress", "blue"],
  awaiting_approval: ["Awaiting approval", "amber"],
  waiting: ["Scheduled", "violet"],
  skipped: ["Skipped (override)", "gray"],
  // actions
  approved: ["Approved — queued", "blue"],
  rejected: ["Declined", "red"],
  executing: ["Running", "blue"],
  succeeded: ["Done", "green"],
  superseded: ["Replaced by a newer request", "gray"],
  manual_required: ["Needs manual completion", "violet"],
  // templates
  draft: ["Draft", "gray"],
  published: ["Published", "green"],
  archived: ["Archived", "gray"],
  superseded_version: ["Superseded", "gray"],
  // integrations
  connected: ["Connected", "green"],
  configured_untested: ["Configured — not yet tested", "amber"],
  missing_credentials: ["Missing credentials", "red"],
  missing_permission: ["Missing permission", "amber"],
  unsupported: ["No supported API — manual", "violet"],
  error: ["Error", "red"],
  // decisions
  open: ["Needs a decision", "amber"],
  confirmed: ["Confirmed", "green"],
  not_applicable: ["Not applicable", "gray"],
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const [text, tone] = STATUS_TONE[status] ?? [status.replace(/_/g, " "), "gray"];
  return <Pill className={TONES[tone]}>{label ?? text}</Pill>;
}

export function TonePill({
  tone,
  children,
}: {
  tone: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return <Pill className={TONES[tone]}>{children}</Pill>;
}

export function ModePill({ mode }: { mode: string }) {
  return mode === "test" ? (
    <TonePill tone="violet">Test — nothing external happens</TonePill>
  ) : null;
}

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      className="h-2 w-full rounded-full bg-[var(--acton-gray-100)]"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-2 rounded-full bg-emerald-600 transition-all"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dueLabel(iso: string | null): { text: string; overdue: boolean } {
  if (!iso) return { text: "No due date", overdue: false };
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: `${-days} day${days === -1 ? "" : "s"} overdue`, overdue: true };
  if (days === 0) return { text: "Due today", overdue: false };
  return { text: `Due in ${days} day${days === 1 ? "" : "s"}`, overdue: false };
}

export function PersonSelect({
  value,
  onChange,
  profiles,
  id,
  placeholder = "Choose a person",
  disabled,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  profiles: Array<{ id: string; full_name: string }>;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      className={selectClass}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{placeholder}</option>
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {p.full_name}
        </option>
      ))}
    </select>
  );
}

export function nameOf(profiles: Profile[] | undefined, id: string | null | undefined): string {
  if (!id) return "Unassigned";
  return profiles?.find((p) => p.id === id)?.full_name ?? "Someone";
}

export function Stat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number | string;
  tone?: "amber" | "red" | "green";
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "rounded-lg border bg-white p-4 text-left shadow-sm",
        tone === "red"
          ? "border-red-200"
          : tone === "amber"
            ? "border-amber-200"
            : "border-[var(--acton-border)]",
        onClick &&
          "hover:bg-[var(--acton-gray-50)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none",
      )}
    >
      <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold",
          tone === "red"
            ? "text-red-700"
            : tone === "amber"
              ? "text-amber-700"
              : tone === "green"
                ? "text-emerald-700"
                : "text-[var(--acton-navy)]",
        )}
      >
        {value}
      </p>
    </Comp>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-[var(--acton-navy)]">{title}</h2>
        {description ? (
          <p className="mt-0.5 max-w-3xl text-sm text-[var(--acton-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Table({
  head,
  children,
  empty,
}: {
  head: string[];
  children: React.ReactNode;
  empty?: React.ReactNode;
}) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--acton-border)] bg-white shadow-sm">
      <table className="min-w-full divide-y divide-[var(--acton-border)] text-sm">
        <thead className="bg-[var(--acton-gray-50)]">
          <tr>
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="px-3 py-2 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-[var(--acton-muted)] uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--acton-border)]">
          {rows.length ? (
            children
          ) : (
            <tr>
              <td
                colSpan={head.length}
                className="px-3 py-8 text-center text-sm text-[var(--acton-muted)]"
              >
                {empty ?? "Nothing here yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export const td = "px-3 py-2.5 align-top text-[var(--acton-navy)]";

/** Simple controlled form state for register dialogs. */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const set = (k: keyof T, v: unknown) => setValues((prev) => ({ ...prev, [k]: v }));
  return { values, set, reset: setValues };
}
