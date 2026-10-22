"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type {
  InstanceRow,
  InstanceStepRow,
  TemplateRow,
  TemplateStepRow,
} from "@/lib/agents/onboarding";
import { cn } from "@/lib/utils";
import {
  EmptyState,
  Field,
  Notice,
  Pill,
  aiFetch,
  errorMessage,
  formatDateTime,
  selectClass,
  textareaClass,
  useLoad,
} from "./ui";

type InstanceWithProgress = InstanceRow & {
  progress: { total: number; done: number; percent: number; overdue: number; next: string | null };
};

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      className="h-2 w-full rounded-full bg-[var(--acton-gray-100)]"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-2 rounded-full bg-emerald-600" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function OnboardingOverview() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [instances, setInstances] = useState<InstanceWithProgress[]>([]);
  const [perms, setPerms] = useState({ canEdit: false, canRun: false });
  const [error, setError] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [start, setStart] = useState({
    templateId: "",
    employeeDisplayName: "",
    employeeRole: "",
    startDate: "",
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, i] = await Promise.all([
        aiFetch<{ templates: TemplateRow[]; canEdit: boolean; canRun: boolean }>(
          "/api/ai/onboarding/templates",
        ),
        aiFetch<{ instances: InstanceWithProgress[] }>("/api/ai/onboarding/instances"),
      ]);
      setTemplates(t.templates);
      setInstances(i.instances);
      setPerms({ canEdit: t.canEdit, canRun: t.canRun });
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useLoad(load);

  async function newTemplate() {
    setBusy(true);
    try {
      const { template } = await aiFetch<{ template: TemplateRow }>(
        "/api/ai/onboarding/templates",
        {
          method: "POST",
          body: JSON.stringify({
            name: "New onboarding template",
            description: null,
            status: "draft",
            steps: [{ title: "First step", due_offset_days: 0 }],
          }),
        },
      );
      router.push(`/ai/onboarding/templates/${template.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function startOnboarding() {
    setBusy(true);
    setError(null);
    try {
      const { instance } = await aiFetch<{ instance: InstanceRow }>(
        "/api/ai/onboarding/instances",
        {
          method: "POST",
          body: JSON.stringify({
            templateId: start.templateId,
            employeeDisplayName: start.employeeDisplayName,
            employeeRole: start.employeeRole || null,
            startDate: start.startDate || null,
          }),
        },
      );
      router.push(`/ai/onboarding/${instance.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (error && !templates) return <Notice tone="error">{error}</Notice>;
  if (!templates)
    return <div className="h-64 animate-pulse rounded-lg bg-[var(--acton-gray-100)]" />;
  const usable = templates.filter((t) => t.status !== "archived");

  return (
    <div className="space-y-8">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">
            New hires being onboarded
          </h2>
          {perms.canRun ? (
            <Button
              type="button"
              onClick={() => {
                setStart((s) => ({ ...s, templateId: usable[0]?.id ?? "" }));
                setStartOpen(true);
              }}
              disabled={usable.length === 0}
            >
              <Plus className="h-4 w-4" /> Start onboarding
            </Button>
          ) : null}
        </div>
        {instances.length === 0 ? (
          <EmptyState title="No onboardings yet">
            Start one from a template to track each step. Sam can report progress when asked.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {instances.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/ai/onboarding/${i.id}`}
                  className="block rounded-lg border border-[var(--acton-border)] bg-white p-4 hover:border-[var(--acton-navy)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[var(--acton-navy)]">
                        {i.employee_display_name}
                      </p>
                      <p className="text-sm text-[var(--acton-muted)]">
                        {i.employee_role ?? "Role not set"} · starts {i.start_date ?? "TBD"}
                      </p>
                    </div>
                    <Pill
                      className={
                        i.status === "active"
                          ? "bg-sky-100 text-sky-900"
                          : i.status === "completed"
                            ? "bg-emerald-100 text-emerald-900"
                            : "bg-slate-100 text-slate-700"
                      }
                    >
                      {i.status === "active"
                        ? "In progress"
                        : i.status === "completed"
                          ? "Complete"
                          : "Cancelled"}
                    </Pill>
                  </div>
                  <div className="mt-3 space-y-1">
                    <ProgressBar percent={i.progress.percent} />
                    <p className="text-xs text-[var(--acton-muted)]">
                      {i.progress.done} of {i.progress.total} steps done
                      {i.progress.overdue ? ` · ${i.progress.overdue} overdue` : ""}
                      {i.progress.next ? ` · Next: ${i.progress.next}` : ""}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Onboarding templates</h2>
          {perms.canEdit ? (
            <Button type="button" variant="secondary" onClick={newTemplate} disabled={busy}>
              <Plus className="h-4 w-4" /> New template
            </Button>
          ) : null}
        </div>
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id}>
              <Link
                href={`/ai/onboarding/templates/${t.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--acton-border)] bg-white p-4 hover:border-[var(--acton-navy)]"
              >
                <span>
                  <span className="font-semibold text-[var(--acton-navy)]">{t.name}</span>
                  {t.description ? (
                    <span className="block text-sm text-[var(--acton-muted)]">{t.description}</span>
                  ) : null}
                </span>
                <span className="flex gap-2">
                  {t.is_placeholder ? (
                    <Pill className="bg-amber-100 text-amber-900">Placeholder — not official</Pill>
                  ) : null}
                  <Pill
                    className={
                      t.status === "active"
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-slate-100 text-slate-700"
                    }
                  >
                    {t.status === "active" ? "In use" : t.status === "draft" ? "Draft" : "Archived"}
                  </Pill>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={startOpen} onClose={() => setStartOpen(false)}>
        <DialogHeader>
          <DialogTitle>Start onboarding</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <Notice>
              Only enter a display name, role, and start date. Don&apos;t enter personal details
              like SSNs or pay here.
            </Notice>
            <Field label="Template">
              <select
                className={selectClass}
                value={start.templateId}
                onChange={(e) => setStart({ ...start, templateId: e.target.value })}
              >
                {usable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.is_placeholder ? " (placeholder)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="New hire's name">
              <Input
                value={start.employeeDisplayName}
                onChange={(e) => setStart({ ...start, employeeDisplayName: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Role (optional)">
                <Input
                  value={start.employeeRole}
                  onChange={(e) => setStart({ ...start, employeeRole: e.target.value })}
                />
              </Field>
              <Field label="Start date" help="Due dates are calculated from this.">
                <Input
                  type="date"
                  value={start.startDate}
                  onChange={(e) => setStart({ ...start, startDate: e.target.value })}
                />
              </Field>
            </div>
            {error ? <Notice tone="error">{error}</Notice> : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setStartOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={startOnboarding}
            disabled={busy || !start.templateId || !start.employeeDisplayName.trim()}
          >
            {busy ? "Starting…" : "Start"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template editor
// ---------------------------------------------------------------------------

type EditableStep = {
  key: string;
  title: string;
  description: string;
  responsible_label: string;
  due_offset_days: number;
  required_document: string;
  completion_requirement: string;
  depends_on_position: number | null;
  notification_template: string;
};

function toEditable(steps: TemplateStepRow[]): EditableStep[] {
  const posById = new Map(steps.map((s) => [s.id, s.position]));
  return steps.map((s) => ({
    key: s.id,
    title: s.title,
    description: s.description ?? "",
    responsible_label: s.responsible_label ?? "",
    due_offset_days: s.due_offset_days,
    required_document: s.required_document ?? "",
    completion_requirement: s.completion_requirement ?? "",
    depends_on_position: s.depends_on_step_id ? (posById.get(s.depends_on_step_id) ?? null) : null,
    notification_template: s.notification_template ?? "",
  }));
}

export function TemplateEditor({ id }: { id: string }) {
  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [steps, setSteps] = useState<EditableStep[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirmOfficial, setConfirmOfficial] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await aiFetch<{
        template: TemplateRow;
        steps: TemplateStepRow[];
        canEdit: boolean;
      }>(`/api/ai/onboarding/templates/${id}`);
      setTemplate(res.template);
      setSteps(toEditable(res.steps));
      setCanEdit(res.canEdit);
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    }
  }, [id]);

  useLoad(load);

  function move(index: number, delta: number) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      // Moving a step breaks numeric dependencies; remap by key.
      const keyAt = (pos: number | null) => (pos ? prev[pos - 1]?.key : undefined);
      const deps = prev.map((s) => keyAt(s.depends_on_position));
      [next[index], next[target]] = [next[target]!, next[index]!];
      [deps[index], deps[target]] = [deps[target], deps[index]];
      return next.map((s, i) => {
        const depKey = deps[i];
        const depPos = depKey ? next.findIndex((x) => x.key === depKey) + 1 : null;
        return { ...s, depends_on_position: depPos && depPos <= i ? depPos : null };
      });
    });
  }

  function patch(index: number, values: Partial<EditableStep>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...values } : s)));
  }

  async function save(extra?: { is_placeholder?: boolean }) {
    if (!template) return;
    setBusy(true);
    setNotice(null);
    try {
      await aiFetch(`/api/ai/onboarding/templates/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: template.name,
          description: template.description,
          status: template.status,
          ...extra,
          steps: steps.map((s) => ({
            title: s.title,
            description: s.description || null,
            responsible_label: s.responsible_label || null,
            due_offset_days: Number(s.due_offset_days) || 0,
            required_document: s.required_document || null,
            completion_requirement: s.completion_requirement || null,
            depends_on_position: s.depends_on_position,
            notification_template: s.notification_template || null,
          })),
        }),
      });
      await load();
      setNotice({
        tone: "success",
        text: "Template saved. New onboardings use these steps; existing ones keep theirs.",
      });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
      setConfirmOfficial(false);
    }
  }

  if (!template)
    return notice ? (
      <Notice tone="error">{notice.text}</Notice>
    ) : (
      <div className="h-64 animate-pulse rounded-lg bg-[var(--acton-gray-100)]" />
    );

  return (
    <div className="space-y-6 pb-10">
      <Link
        href="/ai/onboarding"
        className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
      >
        ← Onboarding
      </Link>
      {template.is_placeholder ? (
        <Notice tone="warning">
          This is a generic placeholder, not Acton ADU&apos;s approved onboarding procedure. Replace
          the steps with the official SOP, then mark it official.
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => setConfirmOfficial(true)}
            >
              Mark as official procedure
            </Button>
          ) : null}
        </Notice>
      ) : null}
      {!canEdit ? (
        <Notice>Read-only — only people who manage the HR agent can edit templates.</Notice>
      ) : null}
      <Card className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <Field label="Template name">
            <Input
              value={template.name}
              readOnly={!canEdit}
              onChange={(e) => setTemplate({ ...template, name: e.target.value })}
            />
          </Field>
          <Field label="Status">
            <select
              className={selectClass}
              disabled={!canEdit}
              value={template.status}
              onChange={(e) =>
                setTemplate({ ...template, status: e.target.value as TemplateRow["status"] })
              }
            >
              <option value="draft">Draft</option>
              <option value="active">In use</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
        </div>
        <Field label="Description">
          <textarea
            className={textareaClass}
            rows={2}
            readOnly={!canEdit}
            value={template.description ?? ""}
            onChange={(e) => setTemplate({ ...template, description: e.target.value })}
          />
        </Field>
      </Card>

      <ol className="space-y-4">
        {steps.map((s, i) => (
          <li key={s.key}>
            <Card className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle>Step {i + 1}</CardTitle>
                {canEdit ? (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move step ${i + 1} up`}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => move(i, 1)}
                      disabled={i === steps.length - 1}
                      aria-label={`Move step ${i + 1} down`}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setSteps((p) =>
                          p
                            .filter((_, j) => j !== i)
                            .map((x) => ({
                              ...x,
                              depends_on_position:
                                x.depends_on_position === i + 1
                                  ? null
                                  : x.depends_on_position && x.depends_on_position > i + 1
                                    ? x.depends_on_position - 1
                                    : x.depends_on_position,
                            })),
                        )
                      }
                      aria-label={`Remove step ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4 text-red-700" />
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Title">
                  <Input
                    value={s.title}
                    readOnly={!canEdit}
                    onChange={(e) => patch(i, { title: e.target.value })}
                  />
                </Field>
                <Field label="Who is responsible">
                  <Input
                    value={s.responsible_label}
                    readOnly={!canEdit}
                    placeholder="e.g. Hiring manager"
                    onChange={(e) => patch(i, { responsible_label: e.target.value })}
                  />
                </Field>
                <Field label="Due (days from start date)" help="Negative = before the first day.">
                  <Input
                    type="number"
                    min={-365}
                    max={365}
                    value={s.due_offset_days}
                    readOnly={!canEdit}
                    onChange={(e) => patch(i, { due_offset_days: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Depends on">
                  <select
                    className={selectClass}
                    disabled={!canEdit}
                    value={s.depends_on_position ?? ""}
                    onChange={(e) =>
                      patch(i, {
                        depends_on_position: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  >
                    <option value="">Nothing</option>
                    {steps.slice(0, i).map((p, j) => (
                      <option key={p.key} value={j + 1}>
                        Step {j + 1}: {p.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Required document">
                  <Input
                    value={s.required_document}
                    readOnly={!canEdit}
                    onChange={(e) => patch(i, { required_document: e.target.value })}
                  />
                </Field>
                <Field label="Done when…">
                  <Input
                    value={s.completion_requirement}
                    readOnly={!canEdit}
                    onChange={(e) => patch(i, { completion_requirement: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Details">
                <textarea
                  className={textareaClass}
                  rows={2}
                  readOnly={!canEdit}
                  value={s.description}
                  onChange={(e) => patch(i, { description: e.target.value })}
                />
              </Field>
              <Field
                label="Notification draft (optional)"
                help="Sam can use this as a starting point for a draft message. Use {{employee_name}} and {{start_date}}."
              >
                <textarea
                  className={textareaClass}
                  rows={2}
                  readOnly={!canEdit}
                  value={s.notification_template}
                  onChange={(e) => patch(i, { notification_template: e.target.value })}
                />
              </Field>
            </Card>
          </li>
        ))}
      </ol>
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setSteps((p) => [
                ...p,
                {
                  key: crypto.randomUUID(),
                  title: "",
                  description: "",
                  responsible_label: "",
                  due_offset_days: 0,
                  required_document: "",
                  completion_requirement: "",
                  depends_on_position: null,
                  notification_template: "",
                },
              ])
            }
          >
            <Plus className="h-4 w-4" /> Add step
          </Button>
          <Button
            type="button"
            onClick={() => save()}
            disabled={busy || steps.some((s) => !s.title.trim())}
          >
            {busy ? "Saving…" : "Save template"}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmOfficial}
        onClose={() => setConfirmOfficial(false)}
        onConfirm={() => save({ is_placeholder: false })}
        busy={busy}
        title="Mark as official procedure?"
        description="Only do this once the steps match Acton ADU's approved onboarding SOP. Sam will stop warning that this template is a placeholder."
        confirmLabel="Mark official"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Instance progress
// ---------------------------------------------------------------------------

const STEP_STATUS: Record<InstanceStepRow["status"], { label: string; tone: string }> = {
  pending: { label: "Not started", tone: "bg-slate-100 text-slate-700" },
  in_progress: { label: "In progress", tone: "bg-sky-100 text-sky-900" },
  done: { label: "Done", tone: "bg-emerald-100 text-emerald-900" },
  skipped: { label: "Skipped", tone: "bg-slate-200 text-slate-600" },
  blocked: { label: "Blocked", tone: "bg-red-100 text-red-800" },
};

export function InstanceProgress({ id }: { id: string }) {
  const [data, setData] = useState<{
    instance: InstanceRow;
    steps: InstanceStepRow[];
    progress: {
      percent: number;
      done: number;
      total: number;
      nextSteps: string[];
      overdue: string[];
    };
    canRun: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await aiFetch(`/api/ai/onboarding/instances/${id}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useLoad(load);

  async function setStatus(stepId: string, status: InstanceStepRow["status"]) {
    setError(null);
    try {
      await aiFetch(`/api/ai/onboarding/steps/${stepId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!data)
    return error ? (
      <Notice tone="error">{error}</Notice>
    ) : (
      <div className="h-64 animate-pulse rounded-lg bg-[var(--acton-gray-100)]" />
    );
  const { instance, steps, progress } = data;
  return (
    <div className="space-y-6">
      <Link
        href="/ai/onboarding"
        className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
      >
        ← Onboarding
      </Link>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-[var(--acton-navy)]">
              {instance.employee_display_name}
            </h1>
            <p className="text-sm text-[var(--acton-muted)]">
              {instance.employee_role ?? "Role not set"} · Start date {instance.start_date ?? "TBD"}{" "}
              · {instance.template_name}
            </p>
          </div>
          <Pill className="bg-sky-100 text-sky-900">
            {progress.done} / {progress.total} done
          </Pill>
        </div>
        <ProgressBar percent={progress.percent} />
        <CardDescription>Started {formatDateTime(instance.created_at)}</CardDescription>
      </Card>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <ol className="space-y-2">
        {steps.map((s) => {
          const overdue = progress.overdue.includes(s.id);
          const isNext = progress.nextSteps.includes(s.id);
          return (
            <li
              key={s.id}
              className={cn(
                "rounded-lg border bg-white p-4",
                isNext ? "border-[var(--acton-navy)]" : "border-[var(--acton-border)]",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[var(--acton-navy)]">
                    {s.position}. {s.title}{" "}
                    {isNext ? (
                      <Pill className="ml-1 bg-[var(--acton-yellow)] text-[var(--acton-navy)]">
                        Next up
                      </Pill>
                    ) : null}
                  </p>
                  <p className="text-sm text-[var(--acton-muted)]">
                    {s.responsible_label ?? "Unassigned"} · Due {s.due_date ?? "—"}
                    {overdue ? (
                      <span className="font-semibold text-red-700"> · Overdue</span>
                    ) : null}
                    {s.depends_on_position ? ` · After step ${s.depends_on_position}` : ""}
                  </p>
                  {s.required_document ? (
                    <p className="text-sm">Document: {s.required_document}</p>
                  ) : null}
                  {s.completion_requirement ? (
                    <p className="text-sm">Done when: {s.completion_requirement}</p>
                  ) : null}
                </div>
                {data.canRun && instance.status === "active" ? (
                  <select
                    aria-label={`Status of ${s.title}`}
                    className={cn(selectClass, "h-9 w-40")}
                    value={s.status}
                    onChange={(e) => setStatus(s.id, e.target.value as InstanceStepRow["status"])}
                  >
                    {Object.entries(STEP_STATUS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Pill className={STEP_STATUS[s.status].tone}>{STEP_STATUS[s.status].label}</Pill>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
