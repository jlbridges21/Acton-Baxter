"use client";

/**
 * Business fields (Reports → Data settings, admins): the names reports and Dexter use, each
 * mapped to one JobTread custom field by id. Add, rename, remove (archive), search, and map —
 * no code changes needed. Mappings are only automatic on a verified exact match.
 */

import { useCallback, useMemo, useState } from "react";
import { ArchiveRestore, Plus, Trash2, Wand2 } from "lucide-react";
import { aiFetch, errorMessage, Notice, Pill, selectClass, useLoad } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Status =
  | "mapped"
  | "mapped_not_reportable"
  | "needs_review"
  | "unmapped"
  | "not_in_jobtread"
  | "invalid"
  | "mismatch"
  | "excluded"
  | "archived";

type JtField = {
  id: string;
  name: string;
  target: string;
  type: string;
  category: string;
  reportable: boolean;
};

type BusinessField = {
  key: string;
  label: string;
  description: string | null;
  source: string;
  sourceCategory: string | null;
  sourceName: string | null;
  requestedType: string | null;
  requestedOptions: string[];
  customFieldId: string | null;
  mappedBy: string | null;
  mapped: { id: string; name: string; target: string; type: string } | null;
  status: Status;
  level: "ok" | "info" | "warning" | "error";
  issues: string[];
  candidates: Array<{ id: string; name: string; target: string; type: string }>;
  usedByReports: number;
  archivedAt: string | null;
};

type Overview = {
  fieldsSynced: boolean;
  summary: {
    total: number;
    mapped: number;
    mappedNotReportable: number;
    needsReview: number;
    notInJobTread: number;
    invalid: number;
    archived: number;
    spreadsheetRequested: number;
    spreadsheetImported: number;
  };
  fields: BusinessField[];
  jobtreadFields: JtField[];
  categories: string[];
  message?: string | null;
};

const STATUS: Record<Status, { label: string; tone: string }> = {
  mapped: { label: "Mapped", tone: "bg-emerald-50 text-emerald-800" },
  mapped_not_reportable: { label: "Mapped · not in reports", tone: "bg-sky-50 text-sky-800" },
  needs_review: { label: "Needs review", tone: "bg-amber-50 text-amber-900" },
  unmapped: { label: "Unmapped", tone: "bg-amber-50 text-amber-900" },
  not_in_jobtread: { label: "Not in JobTread", tone: "bg-slate-100 text-slate-700" },
  invalid: { label: "Invalid mapping", tone: "bg-red-50 text-red-800" },
  mismatch: { label: "Mapping mismatch", tone: "bg-red-50 text-red-800" },
  excluded: { label: "Field excluded", tone: "bg-red-50 text-red-800" },
  archived: { label: "Removed", tone: "bg-slate-100 text-slate-600" },
};

const FILTERS: Array<{ value: string; label: string; match: (f: BusinessField) => boolean }> = [
  { value: "active", label: "All active", match: (f) => !f.archivedAt },
  {
    value: "attention",
    label: "Needs attention",
    match: (f) => !f.archivedAt && (f.level === "warning" || f.level === "error"),
  },
  { value: "mapped", label: "Mapped", match: (f) => f.status === "mapped" },
  {
    value: "unmapped",
    label: "Unmapped / needs review",
    match: (f) => f.status === "unmapped" || f.status === "needs_review",
  },
  { value: "missing", label: "Not in JobTread", match: (f) => f.status === "not_in_jobtread" },
  {
    value: "invalid",
    label: "Invalid or mismatched",
    match: (f) => ["invalid", "mismatch", "excluded"].includes(f.status),
  },
  {
    value: "notreportable",
    label: "Not usable in reports",
    match: (f) => f.status === "mapped_not_reportable",
  },
  { value: "archived", label: "Removed", match: (f) => Boolean(f.archivedAt) },
];

const URL_BASE = "/api/reports/admin/business-fields";

export function BusinessFields() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [category, setCategory] = useState("all");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: "", category: "", customFieldId: "" });
  const [confirmRemove, setConfirmRemove] = useState<BusinessField | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await aiFetch<Overview>(URL_BASE));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useLoad(load);

  const send = async (key: string, method: string, body?: unknown, search = "") => {
    setBusy(key);
    setError(null);
    try {
      const next = await aiFetch<Overview>(`${URL_BASE}${search}`, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setData(next);
      setMessage(next.message ?? null);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const byTarget = useMemo(() => {
    const groups = new Map<string, JtField[]>();
    for (const f of data?.jobtreadFields ?? [])
      groups.set(f.target, [...(groups.get(f.target) ?? []), f]);
    return [...groups.entries()];
  }, [data]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rule = FILTERS.find((f) => f.value === filter) ?? FILTERS[0]!;
    return (data?.fields ?? []).filter(
      (f) =>
        rule.match(f) &&
        (category === "all" || (f.sourceCategory ?? "Other") === category) &&
        (!q ||
          `${f.label} ${f.key} ${f.sourceName ?? ""} ${f.mapped?.name ?? ""}`
            .toLowerCase()
            .includes(q)),
    );
  }, [data, query, filter, category]);

  const fieldSelect = (value: string, onChange: (id: string) => void, label: string) => (
    <select
      aria-label={label}
      className={cn(selectClass, "h-9", !value && "text-[var(--acton-muted)]")}
      value={value}
      disabled={busy !== null}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Not mapped</option>
      {byTarget.map(([target, fields]) => (
        <optgroup key={target} label={target}>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.target}, {f.type})
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  const s = data?.summary;

  return (
    <section
      aria-labelledby="business-fields-title"
      className="rounded-lg border border-[var(--acton-border)] bg-white p-5"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 id="business-fields-title" className="font-semibold text-[var(--acton-navy)]">
            Business fields
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">
            Reports and Dexter use these names. Each points to one JobTread field by its stable id,
            so renaming a field here or in JobTread doesn&apos;t break reports. Matches are only
            automatic when name, record type, and field type agree exactly.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null || !data?.fieldsSynced}
            onClick={() => void send("automap", "POST", { action: "automap" })}
          >
            <Wand2 className="h-3.5 w-3.5" aria-hidden />
            {busy === "automap" ? "Matching…" : "Map verified matches"}
          </Button>
          <Button size="sm" disabled={busy !== null} onClick={() => setAdding((v) => !v)}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add field
          </Button>
        </div>
      </div>

      {error ? (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      ) : null}
      {message ? (
        <Notice tone="success" className="mt-3">
          {message}
        </Notice>
      ) : null}
      {!data && !error ? <p className="mt-3 text-sm text-[var(--acton-muted)]">Loading…</p> : null}

      {data && s ? (
        <>
          {!data.fieldsSynced ? (
            <Notice tone="warning" className="mt-3">
              JobTread fields haven&apos;t been synced yet, so nothing can be mapped. Run a sync
              first.
            </Notice>
          ) : s.spreadsheetImported < s.spreadsheetRequested ? (
            <Notice tone="info" className="mt-3">
              {s.spreadsheetImported} of {s.spreadsheetRequested} fields from the custom-fields
              spreadsheet are in this list.{" "}
              <button
                type="button"
                className="font-semibold underline"
                disabled={busy !== null}
                onClick={() => void send("import", "POST", { action: "import" })}
              >
                {busy === "import" ? "Importing…" : "Import the rest"}
              </button>
            </Notice>
          ) : null}

          <dl className="mt-4 flex flex-wrap gap-2 text-xs">
            {[
              ["Fields", s.total, "bg-slate-100 text-slate-800"],
              ["Mapped", s.mapped, STATUS.mapped.tone],
              ["Needs review", s.needsReview, STATUS.needs_review.tone],
              ["Not in JobTread", s.notInJobTread, STATUS.not_in_jobtread.tone],
              ["Invalid / mismatched", s.invalid, STATUS.invalid.tone],
              ["Not usable in reports", s.mappedNotReportable, STATUS.mapped_not_reportable.tone],
            ].map(([label, n, tone]) => (
              <div key={label as string} className={cn("rounded-md px-2.5 py-1", tone as string)}>
                <dt className="inline">{label}: </dt>
                <dd className="inline font-semibold tabular-nums">{n}</dd>
              </div>
            ))}
          </dl>

          {adding ? (
            <form
              className="mt-4 grid gap-2 rounded-md bg-[var(--acton-gray-50)] p-3 md:grid-cols-[1fr_12rem_1fr_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                void send("create", "POST", {
                  action: "create",
                  label: draft.label,
                  category: draft.category || null,
                  customFieldId: draft.customFieldId || null,
                }).then((ok) => {
                  if (ok) {
                    setDraft({ label: "", category: "", customFieldId: "" });
                    setAdding(false);
                  }
                });
              }}
            >
              <input
                aria-label="Business field name"
                required
                maxLength={120}
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="Business field name"
                className="h-9 rounded-md border border-[var(--acton-border)] px-3 text-sm"
              />
              <select
                aria-label="Record type"
                className={`${selectClass} h-9`}
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              >
                <option value="">Any record type</option>
                {data.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {fieldSelect(
                draft.customFieldId,
                (id) => setDraft({ ...draft, customFieldId: id }),
                "JobTread field for the new business field",
              )}
              <Button size="sm" type="submit" className="h-9" disabled={busy !== null}>
                Add
              </Button>
            </form>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <input
              aria-label="Search business fields"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search business fields"
              className="h-9 w-64 rounded-md border border-[var(--acton-border)] px-3 text-sm"
            />
            <div className="w-52">
              <select
                aria-label="Status filter"
                className={`${selectClass} h-9`}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-48">
              <select
                aria-label="Record type filter"
                className={`${selectClass} h-9`}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">All record types</option>
                {[...data.categories, "Other"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <span className="self-center text-xs text-[var(--acton-muted)]">
              {shown.length} shown
            </span>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-left text-xs text-[var(--acton-muted)]">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Business field</th>
                  <th className="py-2 pr-3 font-semibold">JobTread field</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 text-right font-semibold">Reports</th>
                  <th className="py-2 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => (
                  <tr key={f.key} className="border-t border-[var(--acton-gray-100)] align-top">
                    <td className="py-2 pr-3">
                      <input
                        aria-label={`Name of ${f.label}`}
                        defaultValue={f.label}
                        key={`${f.key}-${f.label}`}
                        disabled={busy !== null || Boolean(f.archivedAt)}
                        maxLength={120}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== f.label)
                            void send(`label-${f.key}`, "PATCH", { key: f.key, label: v });
                          else e.target.value = f.label;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        className="w-full rounded border border-transparent px-1 py-0.5 font-medium text-[var(--acton-navy)] hover:border-[var(--acton-border)] focus:border-[var(--acton-border)]"
                      />
                      <p className="px-1 text-xs text-[var(--acton-muted)]">
                        {f.sourceCategory ? `${f.sourceCategory}` : "Any record type"}
                        {f.requestedType ? ` · ${f.requestedType}` : ""} · sem:{f.key}
                        {f.source === "spreadsheet" ? " · from spreadsheet" : ""}
                      </p>
                    </td>
                    <td className="py-2 pr-3">
                      {f.archivedAt ? (
                        <span className="text-[var(--acton-muted)]">{f.mapped?.name ?? "—"}</span>
                      ) : (
                        <>
                          {fieldSelect(
                            f.customFieldId ?? "",
                            (id) =>
                              void send(`map-${f.key}`, "PATCH", {
                                key: f.key,
                                customFieldId: id || null,
                              }),
                            `JobTread field for ${f.label}`,
                          )}
                          {f.mappedBy ? (
                            <p className="mt-0.5 text-xs text-[var(--acton-muted)]">
                              {f.mappedBy === "auto"
                                ? "Matched automatically (exact)"
                                : "Chosen by an administrator"}
                            </p>
                          ) : null}
                          {f.candidates.length && !f.customFieldId ? (
                            <p className="mt-1 flex flex-wrap gap-1 text-xs">
                              {f.candidates.slice(0, 4).map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  disabled={busy !== null}
                                  onClick={() =>
                                    void send(`map-${f.key}`, "PATCH", {
                                      key: f.key,
                                      customFieldId: c.id,
                                    })
                                  }
                                  className="rounded bg-[var(--acton-gray-50)] px-1.5 py-0.5 text-[var(--acton-navy)] hover:bg-[var(--acton-gray-100)]"
                                >
                                  Use {c.name} ({c.target}, {c.type})
                                </button>
                              ))}
                            </p>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <Pill className={STATUS[f.status].tone}>{STATUS[f.status].label}</Pill>
                      {f.issues.map((i) => (
                        <p
                          key={i}
                          className={cn(
                            "mt-1 max-w-xs text-xs",
                            f.level === "error" ? "text-red-700" : "text-[var(--acton-muted)]",
                          )}
                        >
                          {i}
                        </p>
                      ))}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{f.usedByReports}</td>
                    <td className="py-2 text-right">
                      {f.archivedAt ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            void send(`restore-${f.key}`, "POST", {
                              action: "restore",
                              key: f.key,
                            })
                          }
                          className="rounded p-1 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] hover:text-[var(--acton-navy)]"
                          aria-label={`Restore ${f.label}`}
                          title="Restore"
                        >
                          <ArchiveRestore className="h-4 w-4" aria-hidden />
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => setConfirmRemove(f)}
                          className="rounded p-1 text-[var(--acton-muted)] hover:bg-red-50 hover:text-red-700"
                          aria-label={`Remove ${f.label}`}
                          title="Remove"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-[var(--acton-muted)]">
                      No business fields match.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmRemove !== null}
        title={`Remove “${confirmRemove?.label ?? ""}”?`}
        description={
          confirmRemove?.usedByReports
            ? `${confirmRemove.usedByReports} report${confirmRemove.usedByReports === 1 ? " uses" : "s use"} this field. Those widgets will show it as unavailable until you restore it. You can restore it from the Removed filter.`
            : "It's archived, not deleted — you can restore it from the Removed filter."
        }
        confirmLabel="Remove"
        destructive
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => {
          const f = confirmRemove;
          setConfirmRemove(null);
          if (f)
            void send(`remove-${f.key}`, "DELETE", undefined, `?key=${encodeURIComponent(f.key)}`);
        }}
      />
    </section>
  );
}
