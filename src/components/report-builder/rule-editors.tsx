"use client";

/**
 * Business-rule editors rendered inside reports: commission rates and project assignments.
 * Values live in Baxter (never JobTread). Every change is validated, authorized, and audited
 * server-side; people without "Edit business rules" see the values read-only.
 *
 * The header shows which rule set this is (identity, scope, owner, who else uses it, how it was
 * attached), so a dashboard never silently shows someone else's rates. Rate lifecycle actions
 * (end, correct, void, restore, delete) always show an impact preview before they apply.
 */

import { useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { History, Plus, Trash2 } from "lucide-react";
import {
  aiFetch,
  errorMessage,
  formatDateTime,
  Notice,
  selectClass,
  useLoad,
} from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import type { RuleEditorResult } from "@/lib/reports/result-types";

type RateState = "current" | "scheduled" | "ended" | "voided" | "superseded";

type Detail = {
  id: string;
  key: string;
  name: string;
  scope: "dashboard" | "company" | "template";
  status: "active" | "archived" | "copying";
  version: number;
  needsReview: boolean;
  reviewNote: string | null;
  archiveReason: string | null;
  owner: { reportId: string | null; reportTitle: string | null };
  copiedFrom: { key: string; name: string } | null;
  consumers: {
    total: number;
    others: number;
    templates: number;
    reports: Array<{ reportId: string; title: string; attachedAs: string }>;
  };
  attachment: {
    mode: string | null;
    label: string;
    at: string | null;
    by: string | null;
    needsReview: boolean;
  } | null;
  lastChange: { when: string; who: string | null; action: string } | null;
  config: {
    basis: string;
    dateSource: string;
    useJobTreadSalesRep: boolean;
    negativeGrossProfit: "zero" | "include";
    salespeople: string[];
    confirmedAt?: string | null;
    confirmedBy?: string | null;
  };
  options: {
    basis: Array<{ value: string; label: string }>;
    dateSource: Array<{ value: string; label: string }>;
  };
  canEdit: boolean;
  canAdmin: boolean;
  canEditRules: boolean;
  editBlockedBecause: string | null;
  salespeople: string[];
  rates: Array<{
    id: string;
    salesperson: string;
    jobId: string | null;
    jobName: string | null;
    ratePct: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    status: "active" | "voided" | "superseded";
    state: RateState;
    version: number;
    voidReason: string | null;
    endReason: string | null;
    note: string | null;
  }>;
  assignments: Array<{
    id: string;
    jobId: string;
    jobName: string;
    salesperson: string;
    splitPct: number;
    paymentDate: string | null;
    note: string | null;
  }>;
  projects: Array<{ id: string; name: string; salesRep: string[]; phase: string | null }>;
  history: Array<{
    id: string;
    when: string;
    who: string | null;
    entity: string;
    action: string;
    note: string | null;
    reason: string | null;
    commissionsAffected: boolean | null;
  }>;
};

type Preview = {
  impactSummary?: string;
  warnings?: string[];
  otherReports?: Array<{ reportId: string; title: string }>;
  hardDeleteAllowed?: boolean;
  hardDeleteBlockedBecause?: string;
  impact?: {
    rows: Array<{
      jobName: string;
      salesperson: string;
      before: { ratePct: number | null; commission: number | null };
      after: { ratePct: number | null; commission: number | null };
    }>;
    truncated: boolean;
  } | null;
};

const inputClass =
  "h-9 rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm text-[var(--acton-navy)]";
const today = () => new Date().toISOString().slice(0, 10);
const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const SCOPE_LABEL: Record<Detail["scope"], string> = {
  dashboard: "This dashboard only",
  company: "Shared company rules",
  template: "Template rules",
};
const STATE_STYLE: Record<RateState, string> = {
  current: "bg-emerald-50 text-emerald-800",
  scheduled: "bg-sky-50 text-sky-800",
  ended: "bg-[var(--acton-gray-100)] text-[var(--acton-muted)]",
  voided: "bg-rose-50 text-rose-800",
  superseded: "bg-amber-50 text-amber-800",
};

/** The report this editor is rendered in (rule bindings are per report). */
function useReportId(): string | null {
  const params = useParams<{ reportId?: string }>();
  const id = params?.reportId;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function useRuleSet(key: string, reportId: string | null) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/reports/rules/${encodeURIComponent(key)}${reportId ? `?reportId=${reportId}` : ""}`;
  const load = useCallback(async () => {
    try {
      setData(await aiFetch<Detail>(url));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [url]);
  useLoad(load);
  const act = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      setData(
        await aiFetch<Detail>(url, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };
  /** Dry run: returns the impact preview (nothing is saved). */
  const preview = async (body: Record<string, unknown>) =>
    (
      await aiFetch<{ preview: Preview }>(url, {
        method: "POST",
        body: JSON.stringify({ ...body, dryRun: true }),
      })
    ).preview;
  return { data, error, act, preview };
}

function HistoryList({ history }: { history: Detail["history"] }) {
  if (!history.length) return null;
  return (
    <details className="text-xs" id="rule-history">
      <summary className="inline-flex cursor-pointer items-center gap-1 text-[var(--acton-muted)] hover:text-[var(--acton-navy)]">
        <History className="h-3.5 w-3.5" aria-hidden /> Change history ({history.length})
      </summary>
      <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto">
        {history.map((h) => (
          <li key={h.id} className="text-[var(--acton-muted)]">
            {formatDateTime(h.when)} · {h.entity} {h.action} · {h.who ?? "System"}
            {h.reason || h.note ? ` — ${h.reason ?? h.note}` : ""}
            {h.commissionsAffected === true
              ? " · commissions changed"
              : h.commissionsAffected === false
                ? " · no commissions changed"
                : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function RuleEditorWidget({
  result,
  onChanged,
}: {
  result: RuleEditorResult;
  onChanged: () => void;
}) {
  const reportId = useReportId();
  if (result.template)
    return (
      <Notice tone="info">
        {result.message ??
          "Templates have no rates. A dashboard created from this template starts with its own empty rule set."}
      </Notice>
    );
  return result.editor === "rates" ? (
    <RateEditor ruleKey={result.ruleSet} reportId={reportId} onChanged={onChanged} />
  ) : (
    <AssignmentEditor ruleKey={result.ruleSet} reportId={reportId} onChanged={onChanged} />
  );
}

/** Identity, scope, owner, consumers, attachment, last change — and the report-level choices. */
function RuleSetHeader({ data, reportId }: { data: Detail; reportId: string | null }) {
  const [choosing, setChoosing] = useState(false);
  return (
    <div className="space-y-2 rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-2 text-xs text-[var(--acton-muted)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-[var(--acton-navy)]">{data.name}</span>
        <span className="font-mono">{data.key}</span>
        <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-[var(--acton-border)]">
          {SCOPE_LABEL[data.scope]}
        </span>
        {data.status !== "active" ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">{data.status}</span>
        ) : null}
        <span>
          {data.consumers.others
            ? `Also used by ${data.consumers.others} other report${data.consumers.others === 1 ? "" : "s"}`
            : "Used by no other report"}
        </span>
        {data.attachment ? <span>{data.attachment.label}</span> : null}
        {data.copiedFrom ? <span>Copied from “{data.copiedFrom.name}”</span> : null}
        {data.lastChange ? (
          <span>
            Last change {formatDateTime(data.lastChange.when)} ({data.lastChange.action})
          </span>
        ) : (
          <span>No changes yet</span>
        )}
        <a href="#rule-history" className="underline hover:text-[var(--acton-navy)]">
          History
        </a>
        {reportId && data.canEditRules ? (
          <button
            type="button"
            className="underline hover:text-[var(--acton-navy)]"
            onClick={() => setChoosing((v) => !v)}
          >
            Change rules…
          </button>
        ) : null}
      </div>
      {data.needsReview ? (
        <Notice tone="warning">
          These rules were linked before rule-set ownership existed and are waiting for an
          administrator&apos;s review.
          {data.consumers.others
            ? ` ${data.consumers.others} other report(s) read the same rates: ${data.consumers.reports
                .filter((r) => r.reportId !== reportId)
                .map((r) => `“${r.title}”`)
                .join(", ")}.`
            : ""}
        </Notice>
      ) : null}
      {data.consumers.others > 0 && !data.needsReview ? (
        <p>
          Changes here apply to:{" "}
          {data.consumers.reports
            .filter((r) => r.reportId !== reportId)
            .map((r) => `“${r.title}”`)
            .join(", ")}
          .
        </p>
      ) : null}
      {choosing && reportId ? (
        <RulesChoice reportId={reportId} current={data} onDone={() => setChoosing(false)} />
      ) : null}
    </div>
  );
}

/** Start empty / copy / attach shared — each previewed, then applied deliberately. */
function RulesChoice({
  reportId,
  current,
  onDone,
}: {
  reportId: string;
  current: Detail;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"start_empty" | "copy" | "attach">("start_empty");
  const [source, setSource] = useState("");
  const [sets, setSets] = useState<
    Array<{ key: string; name: string; scope: string; status: string }>
  >([]);
  const [preview, setPreview] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opKey] = useState(newKey);
  const load = useCallback(async () => {
    try {
      const res = await aiFetch<{ ruleSets: typeof sets }>("/api/reports/rules");
      setSets(res.ruleSets.filter((r) => r.status === "active" && r.key !== current.key));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [current.key]);
  useLoad(load);
  const choices = sets.filter((s) => (mode === "attach" ? s.scope === "company" : true));
  const body = () => ({
    type: mode,
    replaceKey: current.key,
    ...(mode === "copy" ? { fromKey: source } : {}),
    ...(mode === "attach" ? { key: source, confirmShared: true } : {}),
  });
  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await aiFetch<{ preview: unknown }>(`/api/reports/${reportId}/rules`, {
        method: "POST",
        body: JSON.stringify({ ...body(), dryRun, ...(dryRun ? {} : { idempotencyKey: opKey }) }),
      });
      if (dryRun) setPreview(res.preview);
      else {
        onDone();
        window.location.reload();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-md bg-white p-2 ring-1 ring-[var(--acton-border)]">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col">
          This dashboard should
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as typeof mode);
              setPreview(null);
              setSource("");
            }}
            className={`${selectClass} h-9 w-56`}
          >
            <option value="start_empty">Start with empty rules</option>
            <option value="copy">Copy another rule set (independent)</option>
            <option value="attach">Use a shared company rule set</option>
          </select>
        </label>
        {mode !== "start_empty" ? (
          <label className="flex flex-col">
            Rule set
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setPreview(null);
              }}
              className={`${selectClass} h-9 w-64`}
            >
              <option value="">Choose…</option>
              {choices.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name} · {s.key} ({s.scope})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || (mode !== "start_empty" && !source)}
          onClick={() => void run(true)}
        >
          Preview
        </Button>
        <Button size="sm" disabled={busy || !preview} onClick={() => void run(false)}>
          Apply
        </Button>
      </div>
      {mode === "attach" ? (
        <p>
          Shared rules: every report attached to that rule set shows the same rates, and a change
          made from any of them affects all of them.
        </p>
      ) : null}
      {preview ? <PreviewBlock preview={preview} /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

function PreviewBlock({ preview }: { preview: unknown }) {
  const p = preview as Preview & {
    current?: { name: string; attachedAs: string; otherReports: number; note: string } | null;
    next?: { kind: string; from?: string; name?: string };
  };
  return (
    <div className="space-y-1 rounded-md bg-[var(--acton-gray-50)] p-2 text-xs text-[var(--acton-navy)]">
      {p.current ? (
        <p>
          Now: “{p.current.name}” ({p.current.attachedAs}). {p.current.note}
        </p>
      ) : null}
      {p.next ? (
        <p>
          After: {p.next.kind}
          {p.next.from ? ` of “${p.next.from}”` : p.next.name ? ` “${p.next.name}”` : ""}.
        </p>
      ) : null}
      {p.impactSummary ? <p className="font-semibold">{p.impactSummary}</p> : null}
      {p.impact?.rows.length ? (
        <ul className="max-h-32 overflow-auto">
          {p.impact.rows.map((r, i) => (
            <li key={i}>
              {r.jobName} · {r.salesperson}: {r.before.ratePct ?? "—"}% → {r.after.ratePct ?? "—"}%{" "}
              (${r.before.commission ?? "—"} → ${r.after.commission ?? "—"})
            </li>
          ))}
          {p.impact.truncated ? <li>…and more</li> : null}
        </ul>
      ) : null}
      {p.otherReports && p.otherReports.length > 1 ? (
        <p>Reports affected: {p.otherReports.map((r) => `“${r.title}”`).join(", ")}</p>
      ) : null}
      {(p.warnings ?? []).map((w) => (
        <p key={w} className="text-amber-800">
          {w}
        </p>
      ))}
      {p.hardDeleteBlockedBecause ? (
        <p className="text-rose-800">{p.hardDeleteBlockedBecause}</p>
      ) : null}
    </div>
  );
}

type RateAction = "end_rate" | "correct_rate" | "void_rate" | "restore_rate" | "delete_rate";
const ACTION_LABEL: Record<RateAction, string> = {
  end_rate: "End",
  correct_rate: "Correct",
  void_rate: "Void",
  restore_rate: "Restore",
  delete_rate: "Delete",
};

/** One rate lifecycle action: reason → impact preview → apply. */
function RateActionPanel({
  rate,
  action,
  preview,
  act,
  onClose,
  onChanged,
}: {
  rate: Detail["rates"][number];
  action: RateAction;
  preview: (body: Record<string, unknown>) => Promise<Preview>;
  act: (body: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState("");
  const [endDate, setEndDate] = useState(today());
  const [fix, setFix] = useState({
    ratePct: String(rate.ratePct),
    effectiveFrom: rate.effectiveFrom,
    effectiveTo: rate.effectiveTo ?? "",
  });
  const [confirmText, setConfirmText] = useState("");
  const [shown, setShown] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opKey] = useState(newKey);
  const body = () => ({
    action,
    rateId: rate.id,
    reason,
    expectedVersion: rate.version,
    ...(action === "end_rate" ? { endDate } : {}),
    ...(action === "correct_rate"
      ? {
          changes: {
            ...(Number(fix.ratePct) !== rate.ratePct ? { ratePct: Number(fix.ratePct) } : {}),
            ...(fix.effectiveFrom !== rate.effectiveFrom
              ? { effectiveFrom: fix.effectiveFrom }
              : {}),
            ...((fix.effectiveTo || null) !== rate.effectiveTo
              ? { effectiveTo: fix.effectiveTo || null }
              : {}),
          },
        }
      : {}),
    ...(action === "delete_rate" ? { confirm: confirmText } : {}),
  });
  const doPreview = async () => {
    setError(null);
    try {
      setShown(await preview(body()));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const apply = async () => {
    if (await act({ ...body(), idempotencyKey: opKey })) {
      onChanged();
      onClose();
    }
  };
  return (
    <div className="space-y-2 rounded-md bg-white p-2 text-xs ring-1 ring-[var(--acton-border)]">
      <p className="font-semibold text-[var(--acton-navy)]">
        {ACTION_LABEL[action]} {rate.salesperson} {rate.ratePct}% ({rate.jobName ?? "all projects"},{" "}
        {rate.effectiveFrom} → {rate.effectiveTo ?? "open"})
      </p>
      <p className="text-[var(--acton-muted)]">
        {action === "end_rate"
          ? "The rate stops applying after the end date. Earlier commissions keep it."
          : action === "void_rate"
            ? "The rate was entered in error: it is removed from every calculation, past and future. The record is kept."
            : action === "correct_rate"
              ? "Saves a corrected version; the original is kept as superseded."
              : action === "restore_rate"
                ? "Brings this rate back into calculations if nothing overlaps it."
                : "Permanently removes a rate that never applied. Administrators only."}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        {action === "end_rate" ? (
          <label className="flex flex-col text-[var(--acton-muted)]">
            Last day it applies
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={`${inputClass} w-36`}
            />
          </label>
        ) : null}
        {action === "correct_rate" ? (
          <>
            <label className="flex flex-col text-[var(--acton-muted)]">
              Rate %
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={fix.ratePct}
                onChange={(e) => setFix({ ...fix, ratePct: e.target.value })}
                className={`${inputClass} w-20`}
              />
            </label>
            <label className="flex flex-col text-[var(--acton-muted)]">
              From
              <input
                type="date"
                value={fix.effectiveFrom}
                onChange={(e) => setFix({ ...fix, effectiveFrom: e.target.value })}
                className={`${inputClass} w-36`}
              />
            </label>
            <label className="flex flex-col text-[var(--acton-muted)]">
              To (blank = open)
              <input
                type="date"
                value={fix.effectiveTo}
                onChange={(e) => setFix({ ...fix, effectiveTo: e.target.value })}
                className={`${inputClass} w-36`}
              />
            </label>
          </>
        ) : null}
        <label className="flex flex-col text-[var(--acton-muted)]">
          Reason (required)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why"
            className={`${inputClass} w-56`}
          />
        </label>
        {action === "delete_rate" ? (
          <label className="flex flex-col text-[var(--acton-muted)]">
            Type DELETE
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className={`${inputClass} w-24`}
            />
          </label>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={reason.trim().length < 3}
          onClick={() => void doPreview()}
        >
          Preview impact
        </Button>
        <Button
          size="sm"
          variant={action === "delete_rate" || action === "void_rate" ? "danger" : "primary"}
          disabled={
            !shown ||
            reason.trim().length < 3 ||
            (action === "delete_rate" && (confirmText !== "DELETE" || !shown.hardDeleteAllowed))
          }
          onClick={() => void apply()}
        >
          {ACTION_LABEL[action]}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {shown ? <PreviewBlock preview={shown} /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

function RateEditor({
  ruleKey,
  reportId,
  onChanged,
}: {
  ruleKey: string;
  reportId: string | null;
  onChanged: () => void;
}) {
  const { data, error, act, preview } = useRuleSet(ruleKey, reportId);
  const [form, setForm] = useState({
    salesperson: "",
    ratePct: "",
    effectiveFrom: today(),
    jobId: "",
    note: "",
  });
  const [showInactive, setShowInactive] = useState(false);
  const [acting, setActing] = useState<{ rateId: string; action: RateAction } | null>(null);
  const visible = useMemo(
    () =>
      (data?.rates ?? []).filter(
        (r) => showInactive || (r.state !== "voided" && r.state !== "superseded"),
      ),
    [data, showInactive],
  );
  if (!data)
    return error ? (
      <Notice tone="error">{error}</Notice>
    ) : (
      <p className="text-sm text-[var(--acton-muted)]">Loading rates…</p>
    );
  const inactiveCount = data.rates.filter((r) => r.status !== "active").length;
  const activeCount = data.rates.length - inactiveCount;
  const save = async () => {
    const ok = await act({
      action: "set_rate",
      salesperson: form.salesperson,
      ratePct: Number(form.ratePct),
      effectiveFrom: form.effectiveFrom,
      jobId: form.jobId || null,
      note: form.note || undefined,
      idempotencyKey: newKey(),
    });
    if (ok) {
      setForm((f) => ({ ...f, ratePct: "", jobId: "", note: "" }));
      onChanged();
    }
  };
  const actionsFor = (r: Detail["rates"][number]): RateAction[] => {
    if (!data.canEdit) return [];
    if (r.status === "active")
      return [
        "end_rate",
        "correct_rate",
        "void_rate",
        ...(data.canAdmin && r.state === "scheduled" ? (["delete_rate"] as const) : []),
      ];
    return ["restore_rate"];
  };
  return (
    <div className="space-y-3">
      <RuleSetHeader data={data} reportId={reportId} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {activeCount === 0 ? (
        <Notice tone="info">
          This dashboard has no commission rates yet. Every project shows “No rate set” until
          someone adds one.
        </Notice>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-[var(--acton-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--acton-gray-50)] text-left text-xs text-[var(--acton-muted)]">
            <tr>
              <th className="px-3 py-2 font-semibold">Salesperson</th>
              <th className="px-3 py-2 font-semibold">Applies to</th>
              <th className="px-3 py-2 text-right font-semibold">Rate</th>
              <th className="px-3 py-2 font-semibold">Effective</th>
              <th className="px-3 py-2 font-semibold">State</th>
              {data.canEdit ? <th className="px-3 py-2 font-semibold">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.id}
                className={
                  r.state === "current"
                    ? "border-t border-[var(--acton-gray-100)]"
                    : "border-t border-[var(--acton-gray-100)] text-[var(--acton-muted)]"
                }
              >
                <td className="px-3 py-1.5 font-medium">{r.salesperson}</td>
                <td className="px-3 py-1.5 text-xs">{r.jobName ?? "All projects"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.ratePct}%</td>
                <td className="px-3 py-1.5 text-xs">
                  {r.effectiveFrom} → {r.effectiveTo ?? "open"}
                </td>
                <td className="px-3 py-1.5 text-xs">
                  <span className={`rounded-full px-1.5 ${STATE_STYLE[r.state]}`}>{r.state}</span>
                  {r.voidReason ? <span className="ml-1">({r.voidReason})</span> : null}
                </td>
                {data.canEdit ? (
                  <td className="px-3 py-1.5 text-xs">
                    <div className="flex flex-wrap gap-1">
                      {actionsFor(r).map((a) => (
                        <button
                          key={a}
                          type="button"
                          className="rounded px-1.5 py-0.5 ring-1 ring-[var(--acton-border)] hover:bg-[var(--acton-gray-50)]"
                          onClick={() => setActing({ rateId: r.id, action: a })}
                        >
                          {a === "delete_rate" ? (
                            <Trash2 className="inline h-3 w-3" aria-label="Delete" />
                          ) : (
                            ACTION_LABEL[a]
                          )}
                        </button>
                      ))}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-center text-sm text-[var(--acton-muted)]">
                  No rates yet — commissions show “No rate set” until one is entered.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {inactiveCount ? (
        <button
          type="button"
          className="text-xs text-[var(--acton-muted)] underline"
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? "Hide" : "Show"} {inactiveCount} voided or superseded rate(s)
        </button>
      ) : null}
      {acting
        ? (() => {
            const rate = data.rates.find((r) => r.id === acting.rateId);
            return rate ? (
              <RateActionPanel
                key={`${acting.rateId}-${acting.action}`}
                rate={rate}
                action={acting.action}
                preview={preview}
                act={act}
                onClose={() => setActing(null)}
                onChanged={onChanged}
              />
            ) : null;
          })()
        : null}
      {data.canEdit ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-[var(--acton-gray-50)] p-2">
          <label className="flex flex-col text-xs text-[var(--acton-muted)]">
            Salesperson
            <input
              list={`sp-${ruleKey}`}
              value={form.salesperson}
              onChange={(e) => setForm({ ...form, salesperson: e.target.value })}
              className={`${inputClass} w-36`}
            />
            <datalist id={`sp-${ruleKey}`}>
              {data.salespeople.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col text-xs text-[var(--acton-muted)]">
            Rate %
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={form.ratePct}
              onChange={(e) => setForm({ ...form, ratePct: e.target.value })}
              className={`${inputClass} w-20`}
            />
          </label>
          <label className="flex flex-col text-xs text-[var(--acton-muted)]">
            Effective from
            <input
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              className={`${inputClass} w-36`}
            />
          </label>
          <label className="flex flex-col text-xs text-[var(--acton-muted)]">
            Only for project (optional)
            <select
              value={form.jobId}
              onChange={(e) => setForm({ ...form, jobId: e.target.value })}
              className={`${selectClass} h-9 w-48`}
            >
              <option value="">All projects</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-[var(--acton-muted)]">
            Note
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Why"
              className={`${inputClass} w-36`}
            />
          </label>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={!form.salesperson.trim() || form.ratePct === ""}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Set rate
          </Button>
        </div>
      ) : (
        <p className="text-xs text-[var(--acton-muted)]">
          View only —{" "}
          {data.editBlockedBecause ??
            "changing rates needs “Edit business rules (Reports)” access."}
        </p>
      )}
      <p className="text-xs text-[var(--acton-muted)]">
        A new rate starts on its effective date; earlier commissions keep the rate that applied
        then. Ending, voiding, and correcting keep the original record.
      </p>
      <HistoryList history={data.history} />
    </div>
  );
}

/**
 * What deleting a report does to its rules: shared rule sets are only detached; a private,
 * otherwise unused one may be archived too. Renders nothing for people without rule access.
 */
export function ReportRulesDeleteNotice({
  reportId,
  archive,
  onArchiveChange,
}: {
  reportId: string;
  archive: boolean;
  onArchiveChange: (v: boolean) => void;
}) {
  const [items, setItems] = useState<Array<{
    key: string;
    name: string;
    scope: string;
    otherConsumers: number;
    archivable: boolean;
  }> | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await aiFetch<{ deleteImpact: NonNullable<typeof items> }>(
        `/api/reports/${reportId}/rules`,
      );
      setItems(res.deleteImpact);
    } catch {
      setItems([]);
    }
  }, [reportId]);
  useLoad(load);
  if (!items?.length) return null;
  const archivable = items.filter((i) => i.archivable);
  return (
    <div className="mt-2 space-y-1 text-sm">
      {items.map((i) => (
        <p key={i.key}>
          Commission rules “{i.name}” ({i.key}) will be detached.{" "}
          {i.otherConsumers
            ? `${i.otherConsumers} other report(s) keep using them unchanged.`
            : i.archivable
              ? "No other report uses them."
              : ""}
        </p>
      ))}
      {archivable.length ? (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={archive}
            onChange={(e) => onArchiveChange(e.target.checked)}
          />
          Also archive this dashboard&apos;s private rules (rates and history are kept)
        </label>
      ) : null}
    </div>
  );
}

function AssignmentEditor({
  ruleKey,
  reportId,
  onChanged,
}: {
  ruleKey: string;
  reportId: string | null;
  onChanged: () => void;
}) {
  const { data, error, act } = useRuleSet(ruleKey, reportId);
  const [form, setForm] = useState({
    jobId: "",
    salesperson: "",
    splitPct: "100",
    paymentDate: "",
  });
  const [query, setQuery] = useState("");
  const projects = useMemo(() => {
    const q = query.toLowerCase();
    return (data?.projects ?? [])
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 200);
  }, [data, query]);
  if (!data)
    return error ? (
      <Notice tone="error">{error}</Notice>
    ) : (
      <p className="text-sm text-[var(--acton-muted)]">Loading assignments…</p>
    );
  const save = async () => {
    const ok = await act({
      action: "assign",
      jobId: form.jobId,
      salesperson: form.salesperson,
      splitPct: Number(form.splitPct) || 100,
      paymentDate: form.paymentDate || null,
    });
    if (ok) {
      setForm({ jobId: "", salesperson: form.salesperson, splitPct: "100", paymentDate: "" });
      onChanged();
    }
  };
  const remove = async (id: string) => {
    if (await act({ action: "unassign", assignmentId: id })) onChanged();
  };
  const setDate = async (a: Detail["assignments"][number], paymentDate: string) => {
    if (
      await act({
        action: "assign",
        jobId: a.jobId,
        salesperson: a.salesperson,
        splitPct: a.splitPct,
        paymentDate: paymentDate || null,
      })
    )
      onChanged();
  };
  return (
    <div className="space-y-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data.config.useJobTreadSalesRep ? (
        <p className="text-xs text-[var(--acton-muted)]">
          Projects without an assignment here use JobTread&apos;s Sales Rep field. An assignment
          here overrides it for that project.
        </p>
      ) : null}
      <div className="max-h-80 overflow-auto rounded-md border border-[var(--acton-border)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--acton-gray-50)] text-left text-xs text-[var(--acton-muted)]">
            <tr>
              <th className="px-3 py-2 font-semibold">Project</th>
              <th className="px-3 py-2 font-semibold">Salesperson</th>
              <th className="px-3 py-2 text-right font-semibold">Split</th>
              <th className="px-3 py-2 font-semibold">Payment date</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.assignments.map((a) => (
              <tr key={a.id} className="border-t border-[var(--acton-gray-100)]">
                <td className="px-3 py-1.5">{a.jobName}</td>
                <td className="px-3 py-1.5">{a.salesperson}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{a.splitPct}%</td>
                <td className="px-3 py-1.5">
                  {data.canEdit ? (
                    <input
                      type="date"
                      aria-label={`Payment date for ${a.jobName}`}
                      defaultValue={a.paymentDate ?? ""}
                      onBlur={(e) =>
                        e.target.value !== (a.paymentDate ?? "") && void setDate(a, e.target.value)
                      }
                      className={`${inputClass} h-8 w-36`}
                    />
                  ) : (
                    (a.paymentDate ?? "—")
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {data.canEdit ? (
                    <button
                      type="button"
                      onClick={() => void remove(a.id)}
                      className="rounded p-1 text-[var(--acton-muted)] hover:text-red-700"
                      aria-label={`Remove ${a.salesperson} from ${a.jobName}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {data.assignments.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-center text-sm text-[var(--acton-muted)]">
                  No projects assigned in Baxter yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {data.canEdit ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-[var(--acton-gray-50)] p-2">
          <label className="flex flex-col text-xs text-[var(--acton-muted)]">
            Find project
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or number"
              className={`${inputClass} w-40`}
            />
          </label>
          <label className="flex flex-col text-xs text-[var(--acton-muted)]">
            Project
            <select
              value={form.jobId}
              onChange={(e) => setForm({ ...form, jobId: e.target.value })}
              className={`${selectClass} h-9 w-56`}
            >
              <option value="">Choose…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.salesRep.length ? ` (JobTread: ${p.salesRep.join(", ")})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-[var(--acton-muted)]">
            Salesperson
            <input
              list={`spa-${ruleKey}`}
              value={form.salesperson}
              onChange={(e) => setForm({ ...form, salesperson: e.target.value })}
              className={`${inputClass} w-36`}
            />
            <datalist id={`spa-${ruleKey}`}>
              {data.salespeople.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col text-xs text-[var(--acton-muted)]">
            Split %
            <input
              type="number"
              min={1}
              max={100}
              value={form.splitPct}
              onChange={(e) => setForm({ ...form, splitPct: e.target.value })}
              className={`${inputClass} w-20`}
            />
          </label>
          <label className="flex flex-col text-xs text-[var(--acton-muted)]">
            Payment date
            <input
              type="date"
              value={form.paymentDate}
              onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
              className={`${inputClass} w-36`}
            />
          </label>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={!form.jobId || !form.salesperson.trim()}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Assign
          </Button>
        </div>
      ) : (
        <p className="text-xs text-[var(--acton-muted)]">
          View only —{" "}
          {data.editBlockedBecause ??
            "assigning projects needs “Edit business rules (Reports)” access."}
        </p>
      )}
      <HistoryList history={data.history.filter((h) => h.entity === "assignment")} />
    </div>
  );
}
