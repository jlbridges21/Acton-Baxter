"use client";

/**
 * A saved report: view, filter, drill down, export, share, version history, and layout
 * editing (drag to reorder, resize, hide, add widgets) with undo/redo. Every number on
 * screen comes from /api/reports/[id]/execute, which re-checks the viewer's data access.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Copy,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  History,
  LayoutGrid,
  MessageSquare,
  Pin,
  PinOff,
  Plus,
  Printer,
  Redo2,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { aiFetch, errorMessage, formatRelative, Notice, useLoad } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ReportPermission } from "@/lib/reports/repo-types";
import type { CellValue } from "@/lib/reports/compute";
import type { ControlState, ExecutionResult, FieldMeta } from "@/lib/reports/result-types";
import { CHART_TYPES, type ReportSpec, type WidgetSpec } from "@/lib/reports/spec";
import { DexterChat } from "./dexter-chat";
import { FilterBar } from "./filter-bar";
import { DrillDrawer, HistoryDialog, RowDrawer, ShareDialog, type DrillData } from "./panels";
import type { ChatArtifact, ReportDetail } from "./types";
import { AddWidgetDialog } from "./widget-builder";
import { ProvenanceButton, WidgetBody, type DrillRequest } from "./widgets";

const SPAN_CLASS: Record<number, string> = {
  3: "md:col-span-6 xl:col-span-3",
  4: "md:col-span-6 xl:col-span-4",
  6: "md:col-span-6",
  8: "md:col-span-12 xl:col-span-8",
  12: "md:col-span-12",
};
const SPAN_LABELS: Record<number, string> = {
  3: "¼ width",
  4: "⅓ width",
  6: "½ width",
  8: "⅔ width",
  12: "Full width",
};

type RowState = {
  row: { id: string; cells: Record<string, CellValue>; jobtreadUrl?: string };
  columns: FieldMeta[];
} | null;

async function downloadCsv(url: string, body: unknown, fallbackName: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(payload.error?.message ?? "Export failed");
  }
  const blob = await res.blob();
  const name =
    /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function readState(params: URLSearchParams): ControlState {
  try {
    const raw = params.get("f");
    return raw ? (JSON.parse(raw) as ControlState) : {};
  } catch {
    return {};
  }
}

export function ReportView({
  reportId,
  canChat,
  dexterAvatarUrl = null,
}: {
  reportId: string;
  canChat: boolean;
  dexterAvatarUrl?: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [permission, setPermission] = useState<ReportPermission | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<ControlState>(() =>
    readState(new URLSearchParams(params.toString())),
  );
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [running, setRunning] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Edit session: the working draft plus its undo/redo stacks, updated together.
  const [edit, setEdit] = useState<{
    draft: ReportSpec;
    undo: ReportSpec[];
    redo: ReportSpec[];
  } | null>(null);
  const editing = edit !== null;
  const draft = edit?.draft ?? null;
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(
    null,
  );

  const [drill, setDrill] = useState<{
    req: DrillRequest;
    data: DrillData | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [rowView, setRowView] = useState<RowState>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [focus, setFocus] = useState<{ widgetId: string; title: string } | null>(null);
  const [dialog, setDialog] = useState<"share" | "history" | "add" | "delete" | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await aiFetch<{ report: ReportDetail; permission: ReportPermission }>(
        `/api/reports/${reportId}`,
      );
      setReport(res.report);
      setPermission(res.permission);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [reportId]);
  useLoad(load);

  const spec = editing && draft ? draft : (report?.spec ?? null);
  const dirty =
    editing &&
    draft !== null &&
    report !== null &&
    JSON.stringify(draft) !== JSON.stringify(report.spec);

  // Execute whenever the spec in use, the filters, or a refresh changes (debounced).
  const runId = useRef(0);
  useEffect(() => {
    if (!spec) return;
    const id = ++runId.current;
    const timer = window.setTimeout(async () => {
      setRunning(true);
      try {
        const res = await aiFetch<ExecutionResult>(`/api/reports/${reportId}/execute`, {
          method: "POST",
          body: JSON.stringify({ state, ...(editing && draft ? { spec: draft } : {}) }),
        });
        if (id === runId.current) {
          setResult(res);
          setExecError(null);
        }
      } catch (e) {
        if (id === runId.current) setExecError(errorMessage(e));
      } finally {
        if (id === runId.current) setRunning(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [spec, state, reportId, editing, draft, refreshTick]);

  const changeState = (next: ControlState) => {
    setState(next);
    const qs = new URLSearchParams(params.toString());
    if (Object.keys(next).length) qs.set("f", JSON.stringify(next));
    else qs.delete("f");
    router.replace(`?${qs.toString()}`, { scroll: false });
  };

  // ---- editing -----------------------------------------------------------
  const startEdit = () => {
    if (!report) return;
    setEdit({ draft: structuredClone(report.spec), undo: [], redo: [] });
  };
  const stopEdit = () => setEdit(null);
  const applyDraft = useCallback((fn: (s: ReportSpec) => ReportSpec) => {
    setEdit((cur) =>
      cur
        ? {
            draft: fn(structuredClone(cur.draft)),
            undo: [...cur.undo.slice(-49), cur.draft],
            redo: [],
          }
        : cur,
    );
  }, []);
  const doUndo = useCallback(() => {
    setEdit((cur) =>
      cur && cur.undo.length
        ? {
            draft: cur.undo[cur.undo.length - 1]!,
            undo: cur.undo.slice(0, -1),
            redo: [...cur.redo, cur.draft],
          }
        : cur,
    );
  }, []);
  const doRedo = useCallback(() => {
    setEdit((cur) =>
      cur && cur.redo.length
        ? {
            draft: cur.redo[cur.redo.length - 1]!,
            undo: [...cur.undo, cur.draft],
            redo: cur.redo.slice(0, -1),
          }
        : cur,
    );
  }, []);
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, doUndo, doRedo]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const updateWidget = (id: string, changes: Partial<WidgetSpec>) =>
    applyDraft((s) => ({
      ...s,
      widgets: s.widgets.map((w) => (w.id === id ? ({ ...w, ...changes } as WidgetSpec) : w)),
    }));

  const save = async () => {
    if (!report || !draft) return;
    setSaving(true);
    try {
      const res = await aiFetch<{ version: number; spec: ReportSpec; changes: string[] }>(
        `/api/reports/${reportId}`,
        {
          method: "PUT",
          body: JSON.stringify({ spec: draft, expectedVersion: report.version }),
        },
      );
      setReport({
        ...report,
        spec: res.spec,
        version: res.version,
        title: res.spec.title,
        description: res.spec.description,
      });
      stopEdit();
      setNotice({
        tone: "success",
        text: res.changes.length ? `Saved version ${res.version}.` : "No changes to save.",
      });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    applyDraft((s) => {
      const from = s.widgets.findIndex((w) => w.id === e.active.id);
      const to = s.widgets.findIndex((w) => w.id === e.over!.id);
      return { ...s, widgets: arrayMove(s.widgets, from, to) };
    });
  };

  // ---- drilldowns & export ------------------------------------------------
  const openDrill = async (req: DrillRequest) => {
    setDrill({ req, data: null, loading: true, error: null });
    try {
      const data = await aiFetch<DrillData>(`/api/reports/${reportId}/drilldown`, {
        method: "POST",
        body: JSON.stringify({
          state,
          widgetId: req.widgetId,
          groupKey: req.groupKey ?? null,
          seriesKey: req.seriesKey ?? null,
          ...(editing && draft ? { spec: draft } : {}),
        }),
      });
      setDrill({ req, data, loading: false, error: null });
    } catch (e) {
      setDrill({ req, data: null, loading: false, error: errorMessage(e) });
    }
  };
  const exportWidget = async (
    widgetId: string,
    groupKey?: string | null,
    seriesKey?: string | null,
  ) => {
    try {
      await downloadCsv(
        `/api/reports/${reportId}/export`,
        { state, widgetId, groupKey: groupKey ?? null, seriesKey: seriesKey ?? null },
        "report.csv",
      );
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    }
  };

  // ---- meta actions --------------------------------------------------------
  const togglePin = async () => {
    if (!report) return;
    try {
      const res = await aiFetch<{ pinned: boolean }>(`/api/reports/${reportId}`, {
        method: "PATCH",
        body: JSON.stringify({ pinned: !report.pinned }),
      });
      setReport({ ...report, pinned: res.pinned });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    }
  };
  const duplicate = async () => {
    try {
      const res = await aiFetch<{ id: string }>("/api/reports", {
        method: "POST",
        body: JSON.stringify({ from: "report", reportId }),
      });
      router.push(`/reports/${res.id}`);
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    }
  };
  const toggleArchive = async () => {
    if (!report) return;
    try {
      const res = await aiFetch<{ status: "active" | "archived" }>(`/api/reports/${reportId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: report.status === "archived" ? "active" : "archived" }),
      });
      setReport({ ...report, status: res.status });
      setNotice({
        tone: "info",
        text:
          res.status === "archived"
            ? "Archived. It's listed under Reports → Archived."
            : "Restored from the archive.",
      });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    }
  };
  const remove = async () => {
    try {
      await aiFetch(`/api/reports/${reportId}`, { method: "DELETE" });
      router.push("/reports");
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    }
  };
  const onArtifact = (a: ChatArtifact) => {
    if (a.id === reportId) {
      void load();
      setRefreshTick((t) => t + 1);
      setNotice({
        tone: "success",
        text: `Dexter updated this report (version ${a.version}). Use Version history to undo.`,
      });
    }
  };

  const visibleWidgets = useMemo(
    () => (spec ? spec.widgets.filter((w) => editing || !w.hidden) : []),
    [spec, editing],
  );

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--acton-navy)] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Reports
        </Link>
        <Notice tone="error">{loadError}</Notice>
      </div>
    );
  }
  if (!report || !permission || !spec)
    return <p className="text-sm text-[var(--acton-muted)]">Loading report…</p>;

  const freshness = result?.freshness;
  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--acton-muted)] hover:text-[var(--acton-navy)] print:hidden"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Reports
          </Link>
          {editing ? (
            <input
              aria-label="Report title"
              value={spec.title}
              onChange={(e) => applyDraft((s) => ({ ...s, title: e.target.value || " " }))}
              className="mt-1 block w-full max-w-2xl rounded border border-dashed border-[var(--acton-border)] px-2 py-1 text-2xl font-bold text-[var(--acton-navy)]"
            />
          ) : (
            <h1 className="mt-1 text-2xl font-bold text-[var(--acton-navy)]">{spec.title}</h1>
          )}
          {spec.description ? (
            <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">{spec.description}</p>
          ) : null}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--acton-muted)]">
            {report.isTemplate ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                Template
              </span>
            ) : null}
            {report.status === "archived" ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                Archived
              </span>
            ) : null}
            {report.createdByDexter ? <span>Built with Dexter</span> : null}
            <span>Version {report.version}</span>
            <span>
              {freshness?.syncedAt
                ? `JobTread data synced ${formatRelative(freshness.syncedAt)}`
                : "JobTread data not synced yet"}
              {freshness?.liveFetchedAt
                ? ` · project details live ${formatRelative(freshness.liveFetchedAt)}`
                : ""}
            </span>
            {running ? (
              <span className="inline-flex items-center gap-1">
                <RefreshCw className="h-3 w-3 animate-spin" aria-hidden /> Updating…
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 print:hidden">
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={doUndo}
                disabled={!edit?.undo.length}
                aria-label="Undo"
              >
                <Undo2 className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={doRedo}
                disabled={!edit?.redo.length}
                aria-label="Redo"
              >
                <Redo2 className="h-4 w-4" aria-hidden />
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setDialog("add")}>
                <Plus className="h-4 w-4" aria-hidden /> Add widget
              </Button>
              <Button variant="secondary" size="sm" onClick={stopEdit}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={() => setRefreshTick((t) => t + 1)}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
              </Button>
              {permission.canEdit ? (
                <Button variant="secondary" size="sm" onClick={startEdit}>
                  <LayoutGrid className="h-4 w-4" aria-hidden /> Edit layout
                </Button>
              ) : null}
              {permission.canShare && !report.isTemplate ? (
                <Button variant="secondary" size="sm" onClick={() => setDialog("share")}>
                  <Share2 className="h-4 w-4" aria-hidden /> Share
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => setDialog("history")}>
                <History className="h-4 w-4" aria-hidden /> History
              </Button>
              <Button
                variant={report.isTemplate ? "primary" : "secondary"}
                size="sm"
                onClick={() => void duplicate()}
              >
                <Copy className="h-4 w-4" aria-hidden />{" "}
                {report.isTemplate ? "Use template" : "Duplicate"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void togglePin()}
                aria-label={report.pinned ? "Unpin" : "Pin"}
                title={report.pinned ? "Unpin" : "Pin to your Reports"}
              >
                {report.pinned ? (
                  <PinOff className="h-4 w-4" aria-hidden />
                ) : (
                  <Pin className="h-4 w-4" aria-hidden />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.print()}
                aria-label="Print or save as PDF"
                title="Print or save as PDF"
              >
                <Printer className="h-4 w-4" aria-hidden />
              </Button>
              {permission.canDelete || (report.isTemplate && permission.canEdit) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void toggleArchive()}
                  aria-label={report.status === "archived" ? "Restore from archive" : "Archive"}
                  title={report.status === "archived" ? "Restore from archive" : "Archive"}
                >
                  {report.status === "archived" ? (
                    <ArchiveRestore className="h-4 w-4" aria-hidden />
                  ) : (
                    <Archive className="h-4 w-4" aria-hidden />
                  )}
                </Button>
              ) : null}
              {permission.canDelete && !report.isTemplate ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDialog("delete")}
                  aria-label="Delete report"
                  title="Delete report"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {notice ? (
        <Notice tone={notice.tone} className="flex items-center justify-between gap-3 print:hidden">
          <span>{notice.text}</span>
          <button
            type="button"
            className="text-xs font-semibold underline"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </Notice>
      ) : null}
      {editing ? (
        <Notice tone="info" className="print:hidden">
          Drag widgets to rearrange, change their size, or hide them. Changes are previewed live and
          saved as a new version.
        </Notice>
      ) : null}
      {execError ? <Notice tone="error">{execError}</Notice> : null}
      {result?.issues.length ? (
        <Notice tone="warning">
          <ul className="list-disc pl-5">
            {result.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <FilterBar
        controls={spec.controls}
        options={result?.controls ?? {}}
        state={state}
        onChange={changeState}
      />

      {visibleWidgets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--acton-border)] bg-white px-6 py-12 text-center">
          <p className="text-base font-semibold text-[var(--acton-navy)]">This report is empty</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--acton-muted)]">
            {permission.canEdit
              ? "Describe what you want to see and Dexter will build it from JobTread data, or add charts and tables yourself."
              : "The owner hasn't added anything yet."}
          </p>
          {permission.canEdit ? (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {canChat ? (
                <Button onClick={() => setChatOpen(true)}>
                  <Sparkles className="h-4 w-4" aria-hidden /> Ask Dexter to build it
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => {
                  if (!editing) startEdit();
                  setDialog("add");
                }}
              >
                <Plus className="h-4 w-4" aria-hidden /> Add a widget
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={visibleWidgets.map((w) => w.id)}
            strategy={rectSortingStrategy}
            disabled={!editing}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-12 print:block">
              {visibleWidgets.map((w) => (
                <WidgetCard
                  key={w.id}
                  widget={w}
                  editing={editing}
                  result={result?.widgets[w.id]}
                  onChange={(changes) => updateWidget(w.id, changes)}
                  onRemove={() =>
                    applyDraft((s) => ({ ...s, widgets: s.widgets.filter((x) => x.id !== w.id) }))
                  }
                  onExport={() => void exportWidget(w.id)}
                  onDrill={(req) => void openDrill(req)}
                  onOpenRow={(row, columns) => setRowView({ row, columns })}
                  onRulesChanged={() => setRefreshTick((t) => t + 1)}
                  onAskDexter={
                    canChat
                      ? () => {
                          setFocus({ widgetId: w.id, title: w.title || w.type });
                          setChatOpen(true);
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <DrillDrawer
        open={Boolean(drill)}
        loading={drill?.loading ?? false}
        error={drill?.error ?? null}
        data={drill?.data ?? null}
        onClose={() => setDrill(null)}
        onExport={() =>
          drill &&
          void exportWidget(drill.req.widgetId, drill.req.groupKey ?? null, drill.req.seriesKey)
        }
        onOpenRow={(row, columns) => setRowView({ row, columns })}
      />
      <RowDrawer
        row={rowView?.row ?? null}
        columns={rowView?.columns ?? []}
        onClose={() => setRowView(null)}
      />

      {dialog === "share" ? (
        <ShareDialog
          open
          onClose={() => setDialog(null)}
          reportId={reportId}
          visibility={report.visibility}
          onVisibilityChange={(v) => setReport({ ...report, visibility: v })}
        />
      ) : null}
      {dialog === "history" ? (
        <HistoryDialog
          open
          onClose={() => setDialog(null)}
          reportId={reportId}
          canEdit={permission.canEdit && !editing}
          onRestored={() => {
            void load();
            setNotice({
              tone: "success",
              text: "Restored. The previous version is still in the history.",
            });
          }}
        />
      ) : null}
      {dialog === "add" && draft ? (
        <AddWidgetDialog
          open
          onClose={() => setDialog(null)}
          spec={draft}
          onAdd={(widget, dataset) =>
            applyDraft((s) => ({
              ...s,
              datasets: dataset ? [...s.datasets, dataset] : s.datasets,
              widgets: [...s.widgets, widget],
            }))
          }
        />
      ) : null}
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onConfirm={() => void remove()}
        title="Delete this report?"
        description="The report and its version history will be deleted for everyone it's shared with. JobTread data isn't affected."
        confirmLabel="Delete report"
        destructive
      />

      <DexterChat
        reportId={reportId}
        avatarUrl={dexterAvatarUrl}
        canChat={canChat}
        open={chatOpen}
        onOpenChange={setChatOpen}
        focus={focus}
        onClearFocus={() => setFocus(null)}
        blockedReason={
          dirty
            ? "Save or cancel your layout changes before asking Dexter to change the report."
            : null
        }
        onArtifact={onArtifact}
        suggestions={
          permission.canEdit
            ? [
                "Explain how the numbers in this report are calculated",
                "Add a chart of projects by phase",
                "Which fields could I add to this report?",
              ]
            : [
                "Explain how the numbers in this report are calculated",
                "Summarize what this report shows",
              ]
        }
      />
    </div>
  );
}

function WidgetCard({
  widget,
  editing,
  result,
  onChange,
  onRemove,
  onExport,
  onDrill,
  onOpenRow,
  onRulesChanged,
  onAskDexter,
}: {
  widget: WidgetSpec;
  editing: boolean;
  result: ExecutionResult["widgets"][string] | undefined;
  onChange: (changes: Partial<WidgetSpec>) => void;
  onRemove: () => void;
  onExport: () => void;
  onDrill: (req: DrillRequest) => void;
  onOpenRow: (row: NonNullable<RowState>["row"], columns: FieldMeta[]) => void;
  onRulesChanged: () => void;
  onAskDexter?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: !editing,
  });
  const exportable =
    ["kpi", "chart", "table", "detail", "milestones", "documents"].includes(widget.type) &&
    result &&
    result.status !== "restricted" &&
    result.status !== "error";
  const bare = widget.type === "project_header";
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      aria-label={widget.title || widget.type}
      className={cn(
        "col-span-1 min-w-0 rounded-lg border border-[var(--acton-border)] bg-white p-4 shadow-sm print:mb-4 print:break-inside-avoid print:shadow-none",
        SPAN_CLASS[widget.span],
        editing && "ring-1 ring-transparent hover:ring-[var(--acton-yellow)]",
        widget.hidden && "opacity-50",
        isDragging && "z-10 shadow-xl",
      )}
    >
      {editing ? (
        <div className="-mt-1 mb-3 flex flex-wrap items-center gap-2 border-b border-dashed border-[var(--acton-border)] pb-2">
          <button
            type="button"
            className="cursor-grab rounded p-1 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] active:cursor-grabbing"
            aria-label={`Drag to move ${widget.title || widget.type}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" aria-hidden />
          </button>
          <input
            aria-label="Widget title"
            value={widget.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Untitled"
            className="h-8 min-w-0 flex-1 rounded border border-[var(--acton-border)] px-2 text-sm"
          />
          <select
            aria-label="Width"
            value={widget.span}
            onChange={(e) => onChange({ span: Number(e.target.value) as WidgetSpec["span"] })}
            className="h-8 rounded border border-[var(--acton-border)] px-1 text-xs"
          >
            {[3, 4, 6, 8, 12].map((s) => (
              <option key={s} value={s}>
                {SPAN_LABELS[s]}
              </option>
            ))}
          </select>
          {widget.type === "chart" ? (
            <>
              <select
                aria-label="Chart type"
                value={widget.chart}
                onChange={(e) =>
                  onChange({
                    chart: e.target.value as (typeof CHART_TYPES)[number],
                  } as Partial<WidgetSpec>)
                }
                className="h-8 rounded border border-[var(--acton-border)] px-1 text-xs"
              >
                {CHART_TYPES.filter((c) => c !== "scatter" || widget.chart === "scatter").map(
                  (c) => (
                    <option key={c} value={c}>
                      {c.replace("_", " ")}
                    </option>
                  ),
                )}
              </select>
              <select
                aria-label="Height"
                value={widget.height}
                onChange={(e) => onChange({ height: e.target.value as WidgetSpec["height"] })}
                className="h-8 rounded border border-[var(--acton-border)] px-1 text-xs"
              >
                <option value="sm">Short</option>
                <option value="md">Medium</option>
                <option value="lg">Tall</option>
                <option value="auto">Auto</option>
              </select>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => onChange({ hidden: !widget.hidden })}
            className="rounded p-1 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)]"
            aria-label={widget.hidden ? "Show widget" : "Hide widget"}
            title={widget.hidden ? "Show" : "Hide"}
          >
            {widget.hidden ? (
              <Eye className="h-4 w-4" aria-hidden />
            ) : (
              <EyeOff className="h-4 w-4" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1 text-[var(--acton-muted)] hover:bg-red-50 hover:text-red-700"
            aria-label="Remove widget"
            title="Remove"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}
      {!bare && (widget.title || result?.provenance) ? (
        <header className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            {widget.title ? (
              <h2 className="text-sm font-semibold text-[var(--acton-navy)]">{widget.title}</h2>
            ) : null}
            {widget.description ? (
              <p className="text-xs text-[var(--acton-muted)]">{widget.description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center">
            {onAskDexter && !editing ? (
              <button
                type="button"
                onClick={onAskDexter}
                className="rounded p-1 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] hover:text-[var(--acton-navy)] print:hidden"
                aria-label={`Ask Dexter about ${widget.title || "this widget"}`}
                title="Ask Dexter about this"
              >
                <MessageSquare className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
            <ProvenanceButton provenance={result?.provenance} title={widget.title} />
            {exportable && !editing ? (
              <button
                type="button"
                onClick={onExport}
                className="rounded p-1 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] hover:text-[var(--acton-navy)] print:hidden"
                aria-label={`Download ${widget.title || "widget"} as CSV`}
                title="Download CSV"
              >
                <Download className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
        </header>
      ) : null}
      {widget.hidden ? (
        <p className="text-sm text-[var(--acton-muted)]">
          Hidden — viewers won&apos;t see this widget.
        </p>
      ) : (
        <WidgetBody
          spec={widget}
          result={result}
          actions={{
            onDrill: editing ? undefined : onDrill,
            onOpenRow: editing ? undefined : onOpenRow,
            onRulesChanged,
          }}
        />
      )}
    </section>
  );
}
