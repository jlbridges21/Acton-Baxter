"use client";

/**
 * Data settings → Financial data → PP# mapping. One draft config is the single source of
 * truth: the structured controls and the JSON view both edit it, it survives tab switches and
 * other saves on the page, and it's what preview and save send. Invalid JSON is never
 * replaced with defaults — it blocks preview/save until fixed. Saves carry the version that
 * was loaded (a newer version saved elsewhere is reported, not overwritten).
 */

import { useCallback, useMemo, useState } from "react";
import { Milestone, RefreshCw } from "lucide-react";
import { errorMessage, formatRelative, Notice, Pill, useLoad } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";

type FieldError = { path: string; message: string };
type Config = {
  schemaVersion: number;
  caseSensitive: boolean;
  classification: {
    mode: string;
    regex?: string;
    fieldId?: string;
    fallbackFieldId?: string | null;
  };
  link: {
    mode: string;
    template?: string;
    scope?: string;
    fieldId?: string;
    directFieldId?: string | null;
  };
  percentages: {
    standard: Record<string, number>;
    overrides: Array<{ jobId: string; split: Record<string, number>; note?: string | null }>;
  };
  autoAcceptUnique: boolean;
};
type Classification = {
  status: string;
  pp?: number;
  values?: string[];
  reason?: string;
  source?: string;
};
type Match = {
  status: string;
  taskId?: string;
  candidates?: Array<{ id: string; name: string | null }>;
  reason?: string;
};
type Item = {
  documentId: string;
  number: string | null;
  name: string | null;
  jobId: string | null;
  jobName: string | null;
  classification: Classification;
  pp: number | null;
  milestonePct: number | null;
  milestonePctSource: string | null;
  match: Match | null;
};
type LinkRow = {
  document_id: string;
  task_id: string | null;
  pp_number: string | null;
  status: string;
  conflict?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  match_method: string;
  classification_method?: string;
  jobName: string | null;
  taskName: string | null;
  document: { number: string | null; name: string | null } | null;
};
type Preview = {
  configured: boolean;
  inspected: number;
  classified: number;
  unclassified: Item[];
  ambiguousClassification: Item[];
  matched: Item[];
  ambiguous: Item[];
  unmatched: Item[];
  byNumber: Record<string, number>;
  approved: number;
  pendingApproval: number;
  conflicts: number;
};
type PpState = {
  ok: true;
  config: Config;
  saved: {
    version: number;
    updatedAt: string | null;
    updatedBy: string | null;
    storedErrors: FieldError[] | null;
  };
  migrated: boolean;
  preview: Preview;
  queues: { pending: LinkRow[]; approved: LinkRow[]; rejected: LinkRow[]; conflicts: LinkRow[] };
  projectTasks: Record<
    string,
    Array<{ id: string; name: string | null; start: string | null; end: string | null }>
  >;
  history: Array<{ version: number; updated_by: string | null; created_at: string }>;
  notes?: string[];
};

const NUMBERS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const TABS = ["Rules", "Percentages", "JSON", "Preview", "Review"] as const;
const input = "rounded-md border border-[var(--acton-border)] px-2 py-1 text-sm";
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

async function post(body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch("/api/reports/admin/financial", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

const apiMessage = (data: Record<string, unknown>) =>
  ((data.error as { message?: string } | undefined)?.message ?? "That didn't work.") as string;

export function PpMappingEditor() {
  const [state, setState] = useState<PpState | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Rules");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [status, setStatus] = useState<{
    tone: "info" | "success" | "error" | "warning";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picks, setPicks] = useState<Record<string, { pp: string; taskId: string }>>({});

  const adopt = useCallback((s: PpState, keepDraft = false) => {
    setState(s);
    if (!keepDraft) {
      setDraft(clone(s.config));
      setJsonText(JSON.stringify(s.config, null, 2));
      setJsonError(null);
    }
  }, []);

  /** keepDraft: refresh saved state and queues without touching unsaved rule edits. */
  const load = useCallback(
    async (keepDraft = false) => {
      const r = await post({ action: "get_pp" });
      if (r.status >= 400) setStatus({ tone: "error", text: apiMessage(r.data) });
      else adopt(r.data as unknown as PpState, keepDraft);
    },
    [adopt],
  );
  useLoad(useCallback(() => load(false), [load]));

  const dirty = useMemo(
    () => Boolean(state && draft && JSON.stringify(draft) !== JSON.stringify(state.config)),
    [state, draft],
  );

  const update = (fn: (c: Config) => void) => {
    if (!draft) return;
    const next = clone(draft);
    fn(next);
    setDraft(next);
    setJsonText(JSON.stringify(next, null, 2));
    setJsonError(null);
  };
  const onJson = (text: string) => {
    setJsonText(text);
    try {
      setDraft(JSON.parse(text) as Config);
      setJsonError(null);
    } catch (e) {
      setJsonError(
        `Invalid JSON: ${errorMessage(e)}. Fix it before previewing or saving — nothing is sent until it parses.`,
      );
    }
  };
  const errorFor = (prefix: string) =>
    errors
      .filter((e) => e.path === prefix || e.path.startsWith(`${prefix}.`))
      .map((e) => (
        <p key={e.path + e.message} role="alert" className="mt-1 text-xs text-rose-700">
          {e.path}: {e.message}
        </p>
      ));

  const run = async (
    body: Record<string, unknown>,
    onOk: (d: Record<string, unknown>) => void | Promise<void>,
  ) => {
    if (jsonError) {
      setStatus({ tone: "error", text: jsonError });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const r = await post(body);
      if (r.status === 422) {
        setErrors((r.data.errors as FieldError[]) ?? []);
        setStatus({ tone: "error", text: "Fix the highlighted fields. Your edits are kept." });
      } else if (r.status >= 400) {
        setStatus({ tone: "error", text: `${apiMessage(r.data)} Your edits are kept.` });
      } else {
        setErrors([]);
        await onOk(r.data);
      }
    } catch (e) {
      setStatus({ tone: "error", text: `${errorMessage(e)} Your edits are kept.` });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    void run(
      { action: "save_pp_config", config: draft, expectedVersion: state!.saved.version },
      (d) => {
        adopt(d as unknown as PpState);
        const rv = d.revalidation as { flagged: number } | undefined;
        setStatus({
          tone: "success",
          text: `Saved version ${(d as unknown as PpState).saved.version}.${rv?.flagged ? ` ${rv.flagged} existing link(s) now disagree with the rule and are flagged for review (not changed).` : ""}`,
        });
      },
    );
  const runPreview = () =>
    void run({ action: "preview_pp", config: draft }, (d) => {
      setPreview((d as unknown as PpState).preview);
      setTab("Preview");
      setStatus({ tone: "info", text: "Preview of your current edits (nothing saved)." });
    });
  const decide = (body: Record<string, unknown>) =>
    void run({ action: "decide_pp_link", ...body }, async () => {
      await load(true).catch(() => undefined);
      setStatus({ tone: "success", text: "Decision saved." });
    });
  const reload = () => {
    if (dirty && !window.confirm("Discard your unsaved PP# changes and reload the saved version?"))
      return;
    void load(false);
    setErrors([]);
    setStatus(null);
  };

  if (!state || !draft)
    return status ? (
      <Notice tone={status.tone}>{status.text}</Notice>
    ) : (
      <p className="text-sm text-[var(--acton-muted)]">Loading PP# mapping…</p>
    );
  const total = NUMBERS.reduce((t, n) => t + (Number(draft.percentages?.standard?.[n]) || 0), 0);
  const c = draft.classification ?? { mode: "none" };
  const l = draft.link ?? { mode: "none" };

  return (
    <section
      className="rounded-lg border border-[var(--acton-border)] bg-white p-5"
      aria-label="PP# mapping"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-[var(--acton-navy)]">
          <Milestone className="h-4 w-4" aria-hidden /> PP# milestone mapping
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <Pill className="bg-gray-100">Version {state.saved.version}</Pill>
          {dirty ? (
            <Pill className="bg-amber-50 text-amber-800">Unsaved changes</Pill>
          ) : (
            <Pill className="bg-emerald-50 text-emerald-700">Saved</Pill>
          )}
          <span className="text-[var(--acton-muted)]">
            {state.saved.updatedAt
              ? `Last updated ${formatRelative(state.saved.updatedAt)}${state.saved.updatedBy ? ` by ${state.saved.updatedBy}` : ""}`
              : "Never saved"}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={reload}
            aria-label="Reload saved PP# configuration"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>
      {!state.migrated ? (
        <Notice tone="warning" className="mt-2">
          Migration 084 isn&apos;t applied, so the PP# configuration can be previewed but not saved.
        </Notice>
      ) : null}
      {state.saved.storedErrors ? (
        <Notice tone="warning" className="mt-2">
          The saved configuration doesn&apos;t validate (
          {state.saved.storedErrors.map((e) => `${e.path}: ${e.message}`).join("; ")}); nothing is
          classified until it&apos;s fixed and saved.
        </Notice>
      ) : null}
      {status ? (
        <Notice tone={status.tone} className="mt-2">
          {status.text}
        </Notice>
      ) : null}

      <div role="tablist" className="mt-3 flex gap-1 border-b border-[var(--acton-border)]">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`px-3 py-1.5 text-sm ${tab === t ? "border-b-2 border-[var(--acton-navy)] font-semibold" : "text-[var(--acton-muted)]"}`}
            onClick={() => setTab(t)}
          >
            {t}
            {t === "Review"
              ? ` (${state.preview.unclassified.length + state.preview.ambiguousClassification.length + state.preview.ambiguous.length + state.preview.unmatched.length + state.queues.pending.length})`
              : ""}
          </button>
        ))}
      </div>

      {tab === "Rules" ? (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">1. Which invoices are PP# invoices</legend>
            <p className="text-xs text-[var(--acton-muted)]">
              Only customer invoices are ever classified. The PP number must be 1–10.
            </p>
            <label className="block text-sm">
              Classification mode
              <select
                aria-label="Classification mode"
                className={`${input} ml-2`}
                value={c.mode}
                onChange={(e) =>
                  update((d) => {
                    d.classification = {
                      mode: e.target.value,
                      ...(e.target.value.endsWith("pattern")
                        ? { regex: c.regex ?? "PP#(10|[1-9])\\b" }
                        : {}),
                      ...(e.target.value === "document_field" ? { fieldId: c.fieldId ?? "" } : {}),
                    };
                  })
                }
              >
                <option value="none">Off</option>
                <option value="name_pattern">Pattern on the invoice name</option>
                <option value="number_pattern">Pattern on the invoice number</option>
                <option value="document_field">JobTread document field</option>
              </select>
            </label>
            {errorFor("classification.mode")}
            {c.mode === "name_pattern" || c.mode === "number_pattern" ? (
              <>
                <label className="block text-sm">
                  Pattern (capture group 1 is the PP number)
                  <input
                    aria-label="Classification pattern"
                    className={`${input} mt-1 w-full font-mono`}
                    value={c.regex ?? ""}
                    onChange={(e) =>
                      update((d) => {
                        d.classification.regex = e.target.value;
                      })
                    }
                  />
                </label>
                {errorFor("classification.regex")}
                <p className="text-xs text-[var(--acton-muted)]">
                  Example: <code>PP#(10|[1-9])\b</code> reads PP#1→1, &quot;PP#2:
                  Foundation&quot;→2, &quot;Progress Payment PP#5&quot;→5, &quot;PP#10 - Final
                  Payment&quot;→10; PP#11 and &quot;Progress Invoice&quot; don&apos;t match (they go
                  to manual review). Names are trimmed and spaces collapsed; matching ignores case
                  unless &quot;Case-sensitive&quot; is on.
                </p>
              </>
            ) : null}
            {c.mode === "name_pattern" ? (
              <label className="block text-sm">
                Fallback document field id (optional, used when the name doesn&apos;t match)
                <input
                  aria-label="Fallback field id"
                  className={`${input} mt-1 w-full font-mono`}
                  value={c.fallbackFieldId ?? ""}
                  onChange={(e) =>
                    update((d) => {
                      d.classification.fallbackFieldId = e.target.value || null;
                    })
                  }
                />
              </label>
            ) : null}
            {c.mode === "document_field" ? (
              <label className="block text-sm">
                Document field id holding the PP number
                <input
                  aria-label="Classification field id"
                  className={`${input} mt-1 w-full font-mono`}
                  value={c.fieldId ?? ""}
                  onChange={(e) =>
                    update((d) => {
                      d.classification.fieldId = e.target.value;
                    })
                  }
                />
              </label>
            ) : null}
            {errorFor("classification.fieldId")}
            {errorFor("classification.fallbackFieldId")}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.caseSensitive}
                onChange={(e) =>
                  update((d) => {
                    d.caseSensitive = e.target.checked;
                  })
                }
              />{" "}
              Case-sensitive matching
            </label>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">
              2. How an invoice links to a task (same project only)
            </legend>
            <label className="block text-sm">
              Link mode
              <select
                aria-label="Link mode"
                className={`${input} ml-2`}
                value={l.mode}
                onChange={(e) =>
                  update((d) => {
                    d.link = {
                      mode: e.target.value,
                      ...(e.target.value === "task_name_pattern"
                        ? { template: l.template ?? "PP#{pp}:", scope: l.scope ?? "all_tasks" }
                        : {}),
                      ...(e.target.value === "document_field_task_id"
                        ? { fieldId: l.fieldId ?? "" }
                        : {}),
                    };
                  })
                }
              >
                <option value="none">Off</option>
                <option value="manual_only">Manual only</option>
                <option value="task_name_pattern">Task name template</option>
                <option value="document_field_task_id">Document field holding the task id</option>
              </select>
            </label>
            {errorFor("link.mode")}
            {l.mode === "task_name_pattern" ? (
              <>
                <label className="block text-sm">
                  Task name starts with
                  <input
                    aria-label="Task name template"
                    className={`${input} mt-1 w-full font-mono`}
                    value={l.template ?? ""}
                    onChange={(e) =>
                      update((d) => {
                        d.link.template = e.target.value;
                      })
                    }
                  />
                </label>
                {errorFor("link.template")}
                <p className="text-xs text-[var(--acton-muted)]">
                  <code>{"{pp}"}</code> becomes the PP number: <code>PP#{"{pp}"}:</code> matches
                  &quot;PP#3: Framing&quot;. A digit right after it never matches, so PP#1
                  can&apos;t link to PP#10. Only tasks in the invoice&apos;s own project are
                  considered; two matches go to review.
                </p>
                <label className="block text-sm">
                  Tasks to search
                  <select
                    aria-label="Task scope"
                    className={`${input} ml-2`}
                    value={l.scope ?? "all_tasks"}
                    onChange={(e) =>
                      update((d) => {
                        d.link.scope = e.target.value;
                      })
                    }
                  >
                    <option value="all_tasks">All tasks in the project</option>
                    <option value="milestone_groups">Milestone groups only</option>
                  </select>
                </label>
                <label className="block text-sm">
                  Direct task-id field (optional, checked first)
                  <input
                    aria-label="Direct task field id"
                    className={`${input} mt-1 w-full font-mono`}
                    value={l.directFieldId ?? ""}
                    onChange={(e) =>
                      update((d) => {
                        d.link.directFieldId = e.target.value || null;
                      })
                    }
                  />
                </label>
              </>
            ) : null}
            {l.mode === "document_field_task_id" ? (
              <label className="block text-sm">
                Document field id holding the JobTread task id
                <input
                  aria-label="Link field id"
                  className={`${input} mt-1 w-full font-mono`}
                  value={l.fieldId ?? ""}
                  onChange={(e) =>
                    update((d) => {
                      d.link.fieldId = e.target.value;
                    })
                  }
                />
              </label>
            ) : null}
            {errorFor("link.fieldId")}
            {errorFor("link.directFieldId")}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.autoAcceptUnique}
                onChange={(e) =>
                  update((d) => {
                    d.autoAcceptUnique = e.target.checked;
                  })
                }
              />{" "}
              Auto-approve unique matches (off: every link waits for approval)
            </label>
          </fieldset>
        </div>
      ) : null}

      {tab === "Percentages" ? (
        <div className="mt-3 text-sm">
          <p className="text-xs text-[var(--acton-muted)]">
            Standard PP#1–10 split (must total 100%). Percentages are reporting labels only: they
            never change invoice amounts or imply anything is paid.
          </p>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {NUMBERS.map((n) => (
              <label key={n} className="text-xs">
                PP#{n}
                <input
                  aria-label={`PP#${n} percent`}
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  className={`${input} mt-1 w-full`}
                  value={draft.percentages?.standard?.[n] ?? ""}
                  onChange={(e) =>
                    update((d) => {
                      d.percentages.standard[n] =
                        e.target.value === ""
                          ? (undefined as unknown as number)
                          : Number(e.target.value);
                    })
                  }
                />
              </label>
            ))}
          </div>
          <p
            className={`mt-1 text-xs ${Math.abs(total - 100) > 0.01 ? "text-rose-700" : "text-[var(--acton-muted)]"}`}
          >
            Total: {Math.round(total * 100) / 100}%
          </p>
          {errorFor("percentages")}
          <p className="mt-3 font-semibold">
            Project overrides ({draft.percentages?.overrides?.length ?? 0})
          </p>
          <p className="text-xs text-[var(--acton-muted)]">
            Shown in reports as &quot;project override&quot;, separate from the standard split. Edit
            them in the JSON tab (jobId, split, note).
          </p>
        </div>
      ) : null}

      {tab === "JSON" ? (
        <div className="mt-3">
          <p className="text-xs text-[var(--acton-muted)]">
            The same draft as the other tabs. Keys: classification.mode + regex (or fieldId),
            link.mode + template (or fieldId), percentages.standard, autoAcceptUnique.
          </p>
          <textarea
            aria-label="PP# configuration JSON"
            className={`${input} mt-1 h-72 w-full font-mono text-xs`}
            value={jsonText}
            onChange={(e) => onJson(e.target.value)}
          />
          {jsonError ? (
            <p role="alert" className="text-xs text-rose-700">
              {jsonError}
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "Preview" ? (
        <div className="mt-3 text-sm">
          {!preview ? (
            <p className="text-[var(--acton-muted)]">
              Click Preview to see how your current edits classify and link the synced invoices.
              Nothing is saved.
            </p>
          ) : (
            <>
              <p>
                {preview.inspected} customer invoices inspected · {preview.classified} classified ·{" "}
                {preview.unclassified.length} unclassified ·{" "}
                {preview.ambiguousClassification.length + preview.ambiguous.length} ambiguous ·{" "}
                {preview.matched.length} linked · {preview.unmatched.length} without a task
              </p>
              <p className="text-xs text-[var(--acton-muted)]">
                By PP#:{" "}
                {Object.entries(preview.byNumber)
                  .sort((a, b) => Number(a[0]) - Number(b[0]))
                  .map(([n, k]) => `PP#${n}: ${k}`)
                  .join(" · ") || "none"}
              </p>
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--acton-muted)]">
                    <th>Invoice</th>
                    <th>Project</th>
                    <th>PP#</th>
                    <th>Task</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...preview.matched,
                    ...preview.ambiguous,
                    ...preview.unmatched,
                    ...preview.ambiguousClassification,
                    ...preview.unclassified,
                  ]
                    .slice(0, 200)
                    .map((i) => (
                      <tr key={i.documentId} className="border-t border-[var(--acton-border)]">
                        <td className="py-1">
                          #{i.number ?? "?"} {i.name}
                        </td>
                        <td>{i.jobName ?? i.jobId ?? "—"}</td>
                        <td>
                          {i.pp ? (
                            `PP#${i.pp}`
                          ) : i.classification.status === "ambiguous" ? (
                            `ambiguous (${i.classification.values?.join(", ")})`
                          ) : (
                            <span className="text-[var(--acton-muted)]">
                              {i.classification.reason}
                            </span>
                          )}
                        </td>
                        <td>
                          {i.match
                            ? i.match.status === "matched"
                              ? "matched"
                              : i.match.status === "ambiguous"
                                ? `${i.match.candidates?.length} candidates`
                                : i.match.reason
                            : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      ) : null}

      {tab === "Review" ? (
        <div className="mt-3 space-y-4 text-sm">
          <p className="text-xs text-[var(--acton-muted)]">
            Queues use the saved rule (version {state.saved.version}). Decisions are stored per
            invoice with your name and the time, and survive syncs and rule changes.
          </p>
          <Queue
            title="Unclassified or ambiguous invoices — choose the PP number"
            items={[...state.preview.unclassified, ...state.preview.ambiguousClassification]}
            render={(i) => (
              <ManualPick
                item={i}
                tasks={i.jobId ? (state.projectTasks[i.jobId] ?? []) : []}
                pick={picks[i.documentId]}
                setPick={(p) => setPicks({ ...picks, [i.documentId]: p })}
                onSave={(p) =>
                  decide({
                    documentId: i.documentId,
                    decision: "manual",
                    ppNumber: Number(p.pp),
                    taskId: p.taskId || null,
                  })
                }
                disabled={busy}
              />
            )}
          />
          <Queue
            title="Ambiguous or missing task — assign one from the same project"
            items={[...state.preview.ambiguous, ...state.preview.unmatched]}
            render={(i) => (
              <ManualPick
                item={i}
                tasks={i.jobId ? (state.projectTasks[i.jobId] ?? []) : []}
                candidates={i.match?.candidates}
                pick={picks[i.documentId] ?? { pp: String(i.pp ?? ""), taskId: "" }}
                setPick={(p) => setPicks({ ...picks, [i.documentId]: p })}
                onSave={(p) =>
                  decide({
                    documentId: i.documentId,
                    decision: "manual",
                    ppNumber: Number(p.pp),
                    taskId: p.taskId || null,
                  })
                }
                disabled={busy}
              />
            )}
          />
          <div>
            <p className="font-semibold">Pending approval ({state.queues.pending.length})</p>
            {state.queues.pending.map((r) => (
              <div
                key={r.document_id}
                className="mt-1 flex flex-wrap items-center gap-2 border-t border-[var(--acton-border)] pt-1 text-xs"
              >
                <span>
                  #{r.document?.number ?? r.document_id} {r.document?.name}
                </span>
                <span>{r.jobName}</span>
                <span>
                  PP#{r.pp_number} → {r.taskName ?? "(no task)"}
                </span>
                {r.conflict ? <span className="text-amber-800">{r.conflict}</span> : null}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => decide({ documentId: r.document_id, decision: "approve" })}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => decide({ documentId: r.document_id, decision: "reject" })}
                >
                  Reject
                </Button>
              </div>
            ))}
          </div>
          <div>
            <p className="font-semibold">
              Approved ({state.queues.approved.length})
              {state.queues.conflicts.length
                ? ` · ${state.queues.conflicts.length} need review`
                : ""}
            </p>
            {state.queues.approved.map((r) => (
              <div
                key={r.document_id}
                className="mt-1 border-t border-[var(--acton-border)] pt-1 text-xs"
              >
                #{r.document?.number ?? r.document_id} {r.document?.name} · {r.jobName} · PP#
                {r.pp_number} → {r.taskName ?? "(no task)"} ·{" "}
                {r.classification_method === "manual" ? "manual" : "rule"} · {r.decided_by ?? "?"}{" "}
                {r.decided_at ? formatRelative(r.decided_at) : ""}
                {r.conflict ? (
                  <span className="ml-2 text-amber-800">Conflict: {r.conflict}</span>
                ) : null}
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !state.migrated}
            onClick={() =>
              void run({ action: "record_pp_suggestions" }, async (d) => {
                await load(true);
                setStatus({
                  tone: "success",
                  text: `Suggestions recorded: ${d.created ?? 0} new, ${d.refreshed ?? 0} refreshed, ${d.keptDecisions ?? 0} decisions kept.`,
                });
              })
            }
          >
            Record suggested links from the saved rule
          </Button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--acton-border)] pt-3">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || Boolean(jsonError)}
          onClick={runPreview}
        >
          Preview
        </Button>
        <Button
          size="sm"
          disabled={busy || Boolean(jsonError) || !dirty || !state.migrated}
          onClick={save}
        >
          Save version {state.saved.version + 1}
        </Button>
        {errors.length && !errors.some((e) => /^(classification|link|percentages)/.test(e.path)) ? (
          <span role="alert" className="text-xs text-rose-700">
            {errors.map((e) => `${e.path || "config"}: ${e.message}`).join("; ")}
          </span>
        ) : null}
        {state.history.length ? (
          <span className="text-xs text-[var(--acton-muted)]">
            History: {state.history.map((h) => `v${h.version} ${h.updated_by ?? ""}`).join(", ")}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function Queue({
  title,
  items,
  render,
}: {
  title: string;
  items: Item[];
  render: (i: Item) => React.ReactNode;
}) {
  return (
    <div>
      <p className="font-semibold">
        {title} ({items.length})
      </p>
      {items.slice(0, 100).map((i) => (
        <div key={i.documentId} className="mt-1 border-t border-[var(--acton-border)] pt-1 text-xs">
          <span className="font-semibold">#{i.number ?? "?"}</span> {i.name} ·{" "}
          {i.jobName ?? "no project"}
          {i.classification.reason ? (
            <span className="ml-1 text-[var(--acton-muted)]">({i.classification.reason})</span>
          ) : null}
          {i.match?.reason ? (
            <span className="ml-1 text-[var(--acton-muted)]">({i.match.reason})</span>
          ) : null}
          {render(i)}
        </div>
      ))}
    </div>
  );
}

function ManualPick({
  item,
  tasks,
  candidates,
  pick,
  setPick,
  onSave,
  disabled,
}: {
  item: Item;
  tasks: Array<{ id: string; name: string | null; start: string | null; end: string | null }>;
  candidates?: Array<{ id: string; name: string | null }>;
  pick: { pp: string; taskId: string } | undefined;
  setPick: (p: { pp: string; taskId: string }) => void;
  onSave: (p: { pp: string; taskId: string }) => void;
  disabled: boolean;
}) {
  const p = pick ?? { pp: item.pp ? String(item.pp) : "", taskId: "" };
  const options = candidates?.length
    ? tasks
        .filter((t) => candidates.some((c) => c.id === t.id))
        .concat(tasks.filter((t) => !candidates.some((c) => c.id === t.id)))
    : tasks;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <select
        aria-label={`PP number for invoice ${item.number ?? item.documentId}`}
        className={input}
        value={p.pp}
        onChange={(e) => setPick({ ...p, pp: e.target.value })}
      >
        <option value="">PP#…</option>
        {NUMBERS.map((n) => (
          <option key={n} value={n}>
            PP#{n}
          </option>
        ))}
      </select>
      <select
        aria-label={`Task for invoice ${item.number ?? item.documentId}`}
        className={`${input} max-w-xs`}
        value={p.taskId}
        onChange={(e) => setPick({ ...p, taskId: e.target.value })}
      >
        <option value="">No task yet</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {candidates?.some((c) => c.id === t.id) ? "★ " : ""}
            {t.name ?? t.id}
            {t.end ? ` (ends ${t.end})` : ""}
          </option>
        ))}
      </select>
      <Button size="sm" variant="secondary" disabled={disabled || !p.pp} onClick={() => onSave(p)}>
        Approve
      </Button>
    </div>
  );
}
