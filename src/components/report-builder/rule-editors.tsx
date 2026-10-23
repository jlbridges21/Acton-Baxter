"use client";

/**
 * Business-rule editors rendered inside reports: commission rates and project assignments.
 * Values live in Baxter (never JobTread). Every change is validated and audited server-side;
 * people without "Edit business rules" see the values read-only.
 */

import { useCallback, useMemo, useState } from "react";
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

type Detail = {
  key: string;
  name: string;
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
  salespeople: string[];
  rates: Array<{
    id: string;
    salesperson: string;
    jobId: string | null;
    jobName: string | null;
    ratePct: number;
    effectiveFrom: string;
    effectiveTo: string | null;
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
  }>;
};

const inputClass =
  "h-9 rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm text-[var(--acton-navy)]";
const today = () => new Date().toISOString().slice(0, 10);

function useRuleSet(key: string) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await aiFetch<Detail>(`/api/reports/rules/${key}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [key]);
  useLoad(load);
  const act = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      setData(
        await aiFetch<Detail>(`/api/reports/rules/${key}`, {
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
  return { data, error, act };
}

function HistoryList({ history }: { history: Detail["history"] }) {
  if (!history.length) return null;
  return (
    <details className="text-xs">
      <summary className="inline-flex cursor-pointer items-center gap-1 text-[var(--acton-muted)] hover:text-[var(--acton-navy)]">
        <History className="h-3.5 w-3.5" aria-hidden /> Change history ({history.length})
      </summary>
      <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto">
        {history.map((h) => (
          <li key={h.id} className="text-[var(--acton-muted)]">
            {formatDateTime(h.when)} · {h.who ?? "System"} · {h.entity} {h.action}
            {h.note ? ` — ${h.note}` : ""}
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
  return result.editor === "rates" ? (
    <RateEditor ruleKey={result.ruleSet} onChanged={onChanged} />
  ) : (
    <AssignmentEditor ruleKey={result.ruleSet} onChanged={onChanged} />
  );
}

function RateEditor({ ruleKey, onChanged }: { ruleKey: string; onChanged: () => void }) {
  const { data, error, act } = useRuleSet(ruleKey);
  const [form, setForm] = useState({
    salesperson: "",
    ratePct: "",
    effectiveFrom: today(),
    jobId: "",
    note: "",
  });
  const current = useMemo(() => {
    const t = today();
    return (data?.rates ?? []).filter(
      (r) => r.effectiveFrom <= t && (!r.effectiveTo || r.effectiveTo >= t),
    );
  }, [data]);
  if (!data)
    return error ? (
      <Notice tone="error">{error}</Notice>
    ) : (
      <p className="text-sm text-[var(--acton-muted)]">Loading rates…</p>
    );
  const save = async () => {
    const ok = await act({
      action: "set_rate",
      salesperson: form.salesperson,
      ratePct: Number(form.ratePct),
      effectiveFrom: form.effectiveFrom,
      jobId: form.jobId || null,
      note: form.note || undefined,
    });
    if (ok) {
      setForm((f) => ({ ...f, ratePct: "", jobId: "", note: "" }));
      onChanged();
    }
  };
  return (
    <div className="space-y-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="overflow-x-auto rounded-md border border-[var(--acton-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--acton-gray-50)] text-left text-xs text-[var(--acton-muted)]">
            <tr>
              <th className="px-3 py-2 font-semibold">Salesperson</th>
              <th className="px-3 py-2 font-semibold">Applies to</th>
              <th className="px-3 py-2 text-right font-semibold">Rate</th>
              <th className="px-3 py-2 font-semibold">Effective</th>
            </tr>
          </thead>
          <tbody>
            {data.rates.map((r) => {
              const live = current.includes(r);
              return (
                <tr
                  key={r.id}
                  className={
                    live
                      ? "border-t border-[var(--acton-gray-100)]"
                      : "border-t border-[var(--acton-gray-100)] text-[var(--acton-muted)]"
                  }
                >
                  <td className="px-3 py-1.5 font-medium">{r.salesperson}</td>
                  <td className="px-3 py-1.5 text-xs">{r.jobName ?? "All projects"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.ratePct}%</td>
                  <td className="px-3 py-1.5 text-xs">
                    {r.effectiveFrom} → {r.effectiveTo ?? "now"}{" "}
                    {live ? (
                      <span className="ml-1 rounded-full bg-emerald-50 px-1.5 text-emerald-800">
                        current
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {data.rates.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-center text-sm text-[var(--acton-muted)]">
                  No rates yet — commissions show “No rate set” until one is entered.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
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
          View only — changing rates needs “Edit business rules (Reports)” access.
        </p>
      )}
      <p className="text-xs text-[var(--acton-muted)]">
        A new rate starts on its effective date; earlier commissions keep the rate that applied
        then.
      </p>
      <HistoryList history={data.history.filter((h) => h.entity === "rate")} />
    </div>
  );
}

function AssignmentEditor({ ruleKey, onChanged }: { ruleKey: string; onChanged: () => void }) {
  const { data, error, act } = useRuleSet(ruleKey);
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
          View only — assigning projects needs “Edit business rules (Reports)” access.
        </p>
      )}
      <HistoryList history={data.history.filter((h) => h.entity === "assignment")} />
    </div>
  );
}
