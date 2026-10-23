"use client";

/** Side drawers (drilldowns, record details) and the share / version-history dialogs. */

import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, History, Trash2, X } from "lucide-react";
import {
  aiFetch,
  errorMessage,
  formatDateTime,
  Notice,
  selectClass,
  useLoad,
} from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CellValue } from "@/lib/reports/compute";
import type { FieldMeta } from "@/lib/reports/result-types";
import type { ReportSpec } from "@/lib/reports/spec";
import { formatValue } from "./format";

export function Drawer({
  open,
  onClose,
  title,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 print:hidden">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute top-0 right-0 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--acton-border)] px-5 py-3">
          <h2 className="truncate text-base font-bold text-[var(--acton-navy)]">{title}</h2>
          <div className="flex items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 hover:bg-[var(--acton-gray-50)]"
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

export type DrillData = {
  title: string;
  total: number;
  columns: FieldMeta[];
  rows: Array<{ id: string; cells: Record<string, CellValue>; jobtreadUrl?: string }>;
};

export function DrillDrawer({
  open,
  loading,
  error,
  data,
  onClose,
  onExport,
  onOpenRow,
}: {
  open: boolean;
  loading: boolean;
  error: string | null;
  data: DrillData | null;
  onClose: () => void;
  onExport: () => void;
  onOpenRow: (row: DrillData["rows"][number], columns: FieldMeta[]) => void;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={data?.title ?? "Records"}
      actions={
        data?.rows.length ? (
          <Button size="sm" variant="secondary" onClick={onExport}>
            <Download className="h-3.5 w-3.5" aria-hidden /> CSV
          </Button>
        ) : null
      }
    >
      {loading ? <p className="text-sm text-[var(--acton-muted)]">Loading records…</p> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data ? (
        <>
          <p className="mb-3 text-sm text-[var(--acton-muted)]">
            {data.total.toLocaleString()} record{data.total === 1 ? "" : "s"}
            {data.total > data.rows.length ? ` (first ${data.rows.length} shown)` : ""}. Only fields
            your access allows are shown.
          </p>
          <div className="overflow-x-auto rounded-md border border-[var(--acton-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--acton-gray-50)] text-left text-xs text-[var(--acton-muted)]">
                <tr>
                  {data.columns.map((c) => (
                    <th key={c.key} className="px-3 py-2 font-semibold whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t border-[var(--acton-gray-100)] hover:bg-[var(--acton-gray-50)]"
                    onClick={() => onOpenRow(r, data.columns)}
                  >
                    {data.columns.map((c) => (
                      <td
                        key={c.key}
                        className="max-w-56 truncate px-3 py-1.5 text-[var(--acton-navy)]"
                      >
                        {formatValue(r.cells[c.key], c.type)}
                      </td>
                    ))}
                    <td className="px-3 py-1.5">
                      {r.jobtreadUrl ? (
                        <a
                          href={r.jobtreadUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Open in JobTread"
                          className="text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Drawer>
  );
}

export function RowDrawer({
  row,
  columns,
  onClose,
}: {
  row: { id: string; cells: Record<string, CellValue>; jobtreadUrl?: string } | null;
  columns: FieldMeta[];
  onClose: () => void;
}) {
  const first = columns[0];
  return (
    <Drawer
      open={Boolean(row)}
      onClose={onClose}
      title={row && first ? formatValue(row.cells[first.key], first.type) : "Record"}
    >
      {row ? (
        <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {columns.map((c) => (
              <div key={c.key}>
                <dt className="text-xs text-[var(--acton-muted)]" title={c.origin}>
                  {c.label}
                </dt>
                <dd className="text-sm font-medium break-words whitespace-pre-wrap text-[var(--acton-navy)]">
                  {formatValue(row.cells[c.key], c.type)}
                </dd>
              </div>
            ))}
          </dl>
          {row.jobtreadUrl ? (
            <a
              href={row.jobtreadUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-[var(--acton-navy)] hover:underline"
            >
              Open in JobTread <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

type Share = {
  id: string;
  principal_type: "user" | "department" | "role";
  principal_value: string;
  permission: "view" | "edit";
};
type Principals = {
  users: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  roles: Array<{ id: string; name: string }>;
};

export function ShareDialog({
  open,
  onClose,
  reportId,
  visibility,
  onVisibilityChange,
}: {
  open: boolean;
  onClose: () => void;
  reportId: string;
  visibility: "private" | "shared" | "company";
  onVisibilityChange: (v: "private" | "shared" | "company") => void;
}) {
  const [shares, setShares] = useState<Share[]>([]);
  const [principals, setPrincipals] = useState<Principals | null>(null);
  const [target, setTarget] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("view");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!open) return;
    try {
      const [s, p] = await Promise.all([
        aiFetch<{ shares: Share[]; visibility: "private" | "shared" | "company" }>(
          `/api/reports/${reportId}/shares`,
        ),
        aiFetch<Principals>("/api/reports/principals"),
      ]);
      setShares(s.shares);
      setPrincipals(p);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [open, reportId]);
  useLoad(load);

  const nameOf = (s: Share) =>
    (s.principal_type === "user"
      ? principals?.users
      : s.principal_type === "department"
        ? principals?.departments
        : principals?.roles
    )?.find((x) => x.id === s.principal_value)?.name ?? s.principal_value;

  const add = async () => {
    const [type, value] = target.split(":") as [Share["principal_type"], string];
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const res = await aiFetch<{ shares: Share[] }>(`/api/reports/${reportId}/shares`, {
        method: "POST",
        body: JSON.stringify({ principalType: type, principalValue: value, permission }),
      });
      setShares(res.shares);
      setTarget("");
      if (visibility === "private") onVisibilityChange("shared");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      const res = await aiFetch<{ shares: Share[] }>(`/api/reports/${reportId}/shares`, {
        method: "DELETE",
        body: JSON.stringify({ shareId: id }),
      });
      setShares(res.shares);
      if (!res.shares.length && visibility === "shared") onVisibilityChange("private");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const setCompany = async (company: boolean) => {
    const next = company ? "company" : shares.length ? "shared" : "private";
    try {
      await aiFetch(`/api/reports/${reportId}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: next }),
      });
      onVisibilityChange(next);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Share report</DialogTitle>
        <DialogCloseButton />
      </DialogHeader>
      <DialogBody className="space-y-4">
        <Notice tone="info">
          Sharing shares the report design, not data. Each person sees only the JobTread fields
          their own access allows.
        </Notice>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <label className="flex items-center gap-2 text-sm text-[var(--acton-navy)]">
          <input
            type="checkbox"
            checked={visibility === "company"}
            onChange={(e) => void setCompany(e.target.checked)}
          />
          Everyone with Reports access can view
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <select
            aria-label="Share with"
            className={`${selectClass} h-10 flex-1`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Choose a person, department, or role…</option>
            {principals ? (
              <>
                <optgroup label="People">
                  {principals.users.map((u) => (
                    <option key={u.id} value={`user:${u.id}`}>
                      {u.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Departments">
                  {principals.departments.map((d) => (
                    <option key={d.id} value={`department:${d.id}`}>
                      {d.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Roles">
                  {principals.roles.map((r) => (
                    <option key={r.id} value={`role:${r.id}`}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              </>
            ) : null}
          </select>
          <select
            aria-label="Permission"
            className={`${selectClass} h-10 w-28`}
            value={permission}
            onChange={(e) => setPermission(e.target.value as "view" | "edit")}
          >
            <option value="view">Can view</option>
            <option value="edit">Can edit</option>
          </select>
          <Button onClick={() => void add()} disabled={!target || busy}>
            Share
          </Button>
        </div>
        <ul className="divide-y divide-[var(--acton-gray-100)]">
          {shares.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-[var(--acton-navy)]">
                {nameOf(s)}{" "}
                <span className="text-xs text-[var(--acton-muted)]">
                  ({s.principal_type}, {s.permission === "edit" ? "can edit" : "can view"})
                </span>
              </span>
              <button
                type="button"
                onClick={() => void remove(s.id)}
                className="rounded p-1 text-[var(--acton-muted)] hover:text-red-700"
                aria-label={`Stop sharing with ${nameOf(s)}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
          {shares.length === 0 ? (
            <li className="py-2 text-sm text-[var(--acton-muted)]">Not shared with anyone yet.</li>
          ) : null}
        </ul>
      </DialogBody>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

type Revision = {
  version: number;
  title: string;
  summary: string | null;
  authorKind: string;
  authorName: string;
  createdAt: string;
  spec: ReportSpec;
};

export function HistoryDialog({
  open,
  onClose,
  reportId,
  canEdit,
  onRestored,
}: {
  open: boolean;
  onClose: () => void;
  reportId: string;
  canEdit: boolean;
  onRestored: () => void;
}) {
  const [data, setData] = useState<{ current: number; revisions: Revision[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(async () => {
    if (!open) return;
    try {
      setData(await aiFetch(`/api/reports/${reportId}/revisions`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [open, reportId]);
  useLoad(load);
  const restore = async (version: number) => {
    setBusy(version);
    try {
      await aiFetch(`/api/reports/${reportId}/revisions`, {
        method: "POST",
        body: JSON.stringify({ version }),
      });
      onRestored();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>
          <span className="inline-flex items-center gap-2">
            <History className="h-5 w-5" aria-hidden /> Version history
          </span>
        </DialogTitle>
        <DialogCloseButton />
      </DialogHeader>
      <DialogBody>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!data ? <p className="text-sm text-[var(--acton-muted)]">Loading…</p> : null}
        <ol className="divide-y divide-[var(--acton-gray-100)]">
          {data?.revisions.map((r) => (
            <li key={r.version} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--acton-navy)]">
                  Version {r.version}
                  {r.version === data.current ? (
                    <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                      Current
                    </span>
                  ) : null}
                </p>
                <p className="text-sm text-[var(--acton-navy)]">{r.summary || "Saved"}</p>
                <p className="text-xs text-[var(--acton-muted)]">
                  {r.authorName} · {formatDateTime(r.createdAt)} · {r.spec.widgets.length} widgets
                </p>
              </div>
              {canEdit && r.version !== data.current ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => void restore(r.version)}
                >
                  {busy === r.version ? "Restoring…" : "Restore"}
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      </DialogBody>
      <DialogFooter>
        <p className="text-xs text-[var(--acton-muted)]">
          Restoring copies an old version forward as a new version — nothing is lost.
        </p>
      </DialogFooter>
    </Dialog>
  );
}
