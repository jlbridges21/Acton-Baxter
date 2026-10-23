"use client";

/**
 * Workflow library and visual editor. Administrators build workflows from the fixed registry of
 * step types — forms only, no code. Draft → Validate → Preview → Publish (CEO/COO) → Archive,
 * with version history and rollback.
 */

import { useCallback, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  Field,
  Notice,
  aiFetch,
  errorMessage,
  formatDateTime,
  selectClass,
  textareaClass,
  useLoad,
} from "@/components/ai/ui";
import type { loadTemplate } from "@/lib/ops/commands";
import {
  ACTION_LABELS,
  ACTION_TYPES,
  ASSIGNEE_ROLES,
  ROLE_LABELS,
  STEP_TYPES,
  validateDefinition,
  workflowDefinitionSchema,
  type StepDefinition,
  type StepType,
  type WorkflowDefinition,
} from "@/lib/ops/definition";
import { cn } from "@/lib/utils";
import {
  PersonSelect,
  SectionHeader,
  StatusPill,
  TonePill,
  useFullOps,
  type TemplateView,
} from "./shared";

type TemplateDetail = Awaited<ReturnType<typeof loadTemplate>>;

const CATEGORIES = [
  "onboarding",
  "offboarding",
  "recruitment",
  "timecards",
  "contracts",
  "insurance",
  "surveys",
  "general",
];

export function LibraryTab() {
  const { full, run, busy } = useFullOps();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (!full) return null;
  const groups = CATEGORIES.map(
    (c) => [c, full.templates.filter((t) => t.category === c)] as const,
  ).filter(([, ts]) => ts.length);
  const other = full.templates.filter((t) => !CATEGORIES.includes(t.category));
  return (
    <div>
      <SectionHeader
        title="Workflow library"
        description="Starter workflows are unofficial drafts based on the leadership brief. Replace their steps with Acton's official checklists, then publish (CEO or COO). Running workflows always keep the version they started with."
        actions={
          full.access.canConfigure ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              New workflow
            </Button>
          ) : null
        }
      />
      {full.templates.length === 0 ? <EmptyState title="No workflows yet" /> : null}
      <div className="space-y-6">
        {[...groups, ...(other.length ? ([["other", other]] as const) : [])].map(([cat, ts]) => (
          <section key={cat}>
            <h3 className="mb-2 text-xs font-bold tracking-wide text-[var(--acton-muted)] uppercase">
              {cat}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {ts.map((t: TemplateView) => (
                <Card key={t.id} className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle>{t.name}</CardTitle>
                      <CardDescription>{t.description}</CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <StatusPill status={t.status} />
                      {t.official ? (
                        <TonePill tone="green">Official</TonePill>
                      ) : (
                        <TonePill tone="amber">Unofficial</TonePill>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-[var(--acton-muted)]">
                    {t.publishedVersion
                      ? `Published v${t.publishedVersion.version}`
                      : "Never published"}
                    {t.latestVersion && t.latestVersion.status === "draft"
                      ? ` · draft v${t.latestVersion.version} in progress`
                      : ""}{" "}
                    · {t.latestVersion?.definition.steps.length ?? 0} steps
                  </p>
                  {t.issues.filter((i) => i.severity === "error").length ? (
                    <Notice tone="warning">
                      {t.issues.filter((i) => i.severity === "error").length} problem(s) to fix
                      before publishing.
                    </Notice>
                  ) : null}
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(t.id)}>
                      {full.access.canConfigure ? "Open editor" : "View"}
                    </Button>
                    {full.access.canConfigure && t.status !== "archived" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          run(
                            { op: "template_archive", templateId: t.id, archived: true },
                            "Archived.",
                          )
                        }
                      >
                        Archive
                      </Button>
                    ) : null}
                    {full.access.canConfigure && t.status === "archived" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          run(
                            { op: "template_archive", templateId: t.id, archived: false },
                            "Restored.",
                          )
                        }
                      >
                        Restore
                      </Button>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
      {editing ? <EditorDialog templateId={editing} onClose={() => setEditing(null)} /> : null}
      {creating ? (
        <CreateDialog onClose={() => setCreating(false)} onCreated={(id) => setEditing(id)} />
      ) : null}
    </div>
  );
}

function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { run, busy } = useFullOps();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("general");
  async function create() {
    const key =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "workflow";
    const res = await run<{ id: string }>(
      {
        op: "template_create",
        key: /^[a-z]/.test(key) ? key : `w-${key}`,
        name,
        category,
        description: "",
        definition: {
          anchor: "workflow_start",
          steps: [{ key: "first-step", title: "First step", type: "manual_task" }],
        },
      },
      "Workflow created as a draft.",
    );
    if (res?.id) {
      onClose();
      onCreated(res.id);
    }
  }
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>New workflow</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <Field label="Name" htmlFor="nw-name">
          <Input
            id="nw-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Equipment return"
          />
        </Field>
        <Field label="Category" htmlFor="nw-cat">
          <select
            id="nw-cat"
            className={selectClass}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || name.trim().length < 2} onClick={create}>
          Create draft
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

const blankStep = (n: number): StepDefinition =>
  workflowDefinitionSchema.shape.steps.element.parse({
    key: `step-${n}`,
    title: `New step ${n}`,
    type: "manual_task",
  });

function EditorDialog({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const { full, run, busy } = useFullOps();
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [def, setDef] = useState<WorkflowDefinition | null>(null);
  const [selected, setSelected] = useState(0);
  const [summary, setSummary] = useState("");
  const [view, setView] = useState<"build" | "preview" | "history">("build");
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const canEdit = Boolean(full?.access.canConfigure);

  const load = useCallback(async () => {
    try {
      const d = await aiFetch<TemplateDetail>(`/api/ops/templates/${templateId}`);
      setDetail(d);
      setDef(d.versions[0]?.definition ?? null);
      setDirty(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [templateId]);
  useLoad(load);

  const { issues, schemaOk } = useMemo(() => {
    if (!def) return { issues: [], schemaOk: false };
    const parsed = workflowDefinitionSchema.safeParse(def);
    if (!parsed.success)
      return {
        schemaOk: false,
        issues: parsed.error.issues.slice(0, 8).map((i) => ({
          message: `${i.path.join(".")}: ${i.message}`,
          severity: "error" as const,
          step: undefined,
        })),
      };
    return { schemaOk: true, issues: validateDefinition(parsed.data) };
  }, [def]);

  function update(next: WorkflowDefinition) {
    setDef(next);
    setDirty(true);
  }
  function updateStep(i: number, patch: Partial<StepDefinition>) {
    if (!def) return;
    update({ ...def, steps: def.steps.map((s, n) => (n === i ? { ...s, ...patch } : s)) });
  }
  function move(i: number, d: -1 | 1) {
    if (!def) return;
    const steps = [...def.steps];
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j]!, steps[i]!];
    update({ ...def, steps });
    setSelected(j);
  }

  async function save() {
    if (!def) return;
    const r = await run(
      {
        op: "template_save",
        templateId,
        definition: def,
        changeSummary: summary.trim() || "Edited in the workflow editor",
      },
      "Draft saved.",
    );
    if (r) {
      setSummary("");
      await load();
    }
  }
  async function publish() {
    const latest = detail?.versions[0];
    if (!latest) return;
    const r = await run<{ published: boolean }>({
      op: "template_publish",
      templateId,
      versionId: latest.id,
    });
    if (r) {
      setPublishNotice(
        r.published
          ? "Published. New workflows of this type will use this version."
          : "Sent to the CEO or COO for approval. It publishes once approved.",
      );
      await load();
    }
  }

  const latest = detail?.versions[0];
  const step = def?.steps[selected];
  const errors = issues.filter((i) => i.severity === "error");

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      onRequestClose={() => !dirty || window.confirm("Discard unsaved changes?")}
    >
      <DialogHeader>
        <DialogTitle>{detail?.template.name ?? "Workflow"}</DialogTitle>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--acton-muted)]">
          {latest ? <span>Editing v{latest.version}</span> : null}
          {latest ? (
            <StatusPill
              status={latest.status === "superseded" ? "superseded_version" : latest.status}
            />
          ) : null}
          {detail && !detail.template.official ? (
            <TonePill tone="amber">Unofficial — not an approved Acton procedure</TonePill>
          ) : null}
        </div>
        <div role="tablist" className="mt-3 flex gap-1 rounded-md bg-[var(--acton-gray-100)] p-1">
          {(["build", "preview", "history"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "rounded px-3 py-1 text-sm font-semibold capitalize",
                view === v
                  ? "bg-white text-[var(--acton-navy)] shadow-sm"
                  : "text-[var(--acton-muted)]",
              )}
            >
              {v === "build" ? "Build" : v === "preview" ? "Preview" : "Versions"}
            </button>
          ))}
        </div>
      </DialogHeader>
      <DialogBody className="max-h-[68vh] overflow-y-auto">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {publishNotice ? (
          <Notice tone="success" className="mb-3">
            {publishNotice}
          </Notice>
        ) : null}
        {!def ? <p className="text-sm text-[var(--acton-muted)]">Loading…</p> : null}
        {def && view === "build" ? (
          <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
            <div className="space-y-3">
              <Field label="Due dates count from" htmlFor="ed-anchor">
                <select
                  id="ed-anchor"
                  disabled={!canEdit}
                  className={selectClass}
                  value={def.anchor}
                  onChange={(e) =>
                    update({ ...def, anchor: e.target.value as WorkflowDefinition["anchor"] })
                  }
                >
                  <option value="workflow_start">When the workflow starts</option>
                  <option value="start_date">The employee&apos;s start date</option>
                  <option value="end_date">The employee&apos;s last day</option>
                  <option value="target_date">A target date (renewal, deadline)</option>
                </select>
              </Field>
              <InputsEditor def={def} update={update} disabled={!canEdit} />
              <div>
                <p className="mb-1 text-sm font-semibold text-[var(--acton-navy)]">Steps</p>
                <ol className="space-y-1">
                  {def.steps.map((s, i) => (
                    <li key={`${s.key}-${i}`}>
                      <button
                        type="button"
                        onClick={() => setSelected(i)}
                        className={cn(
                          "w-full rounded-md border px-2 py-1.5 text-left text-sm",
                          i === selected
                            ? "border-[var(--acton-navy)] bg-[var(--acton-gray-50)]"
                            : "border-[var(--acton-border)] bg-white",
                          issues.some((x) => x.step === s.key && x.severity === "error") &&
                            "border-red-300",
                        )}
                      >
                        <span className="block truncate font-medium text-[var(--acton-navy)]">
                          {i + 1}. {s.title}
                        </span>
                        <span className="text-xs text-[var(--acton-muted)]">
                          {STEP_TYPES[s.type].label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
                {canEdit ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2 w-full"
                    onClick={() => {
                      const prev = def.steps[def.steps.length - 1];
                      const next = blankStep(def.steps.length + 1);
                      update({
                        ...def,
                        steps: [...def.steps, { ...next, dependsOn: prev ? [prev.key] : [] }],
                      });
                      setSelected(def.steps.length);
                    }}
                  >
                    <Plus className="h-4 w-4" aria-hidden /> Add step
                  </Button>
                ) : null}
              </div>
            </div>
            {step ? (
              <StepEditor
                step={step}
                index={selected}
                def={def}
                disabled={!canEdit}
                onChange={(p) => updateStep(selected, p)}
                onMove={(d) => move(selected, d)}
                onDuplicate={() => {
                  const copy = {
                    ...step,
                    key: `${step.key}-copy`.slice(0, 40),
                    title: `${step.title} (copy)`,
                  };
                  update({
                    ...def,
                    steps: [
                      ...def.steps.slice(0, selected + 1),
                      copy,
                      ...def.steps.slice(selected + 1),
                    ],
                  });
                  setSelected(selected + 1);
                }}
                onRemove={() => {
                  if (def.steps.length === 1) return;
                  update({
                    ...def,
                    steps: def.steps
                      .filter((_, n) => n !== selected)
                      .map((s) => ({ ...s, dependsOn: s.dependsOn.filter((k) => k !== step.key) })),
                  });
                  setSelected(Math.max(0, selected - 1));
                }}
                profiles={full?.profiles ?? []}
              />
            ) : null}
          </div>
        ) : null}
        {def && view === "preview" ? <Preview def={def} /> : null}
        {detail && view === "history" ? (
          <div className="space-y-3">
            {detail.diffFromPublished.length ? (
              <Notice tone="info">
                <p className="font-semibold">Changes since the published version:</p>
                <ul className="mt-1 list-disc pl-5">
                  {detail.diffFromPublished.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            <ul className="space-y-2">
              {detail.versions.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm"
                >
                  <span>
                    <strong>v{v.version}</strong> · {v.change_summary ?? ""} ·{" "}
                    {formatDateTime(v.created_at)}
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusPill
                      status={v.status === "superseded" ? "superseded_version" : v.status}
                    />
                    {canEdit && v.id !== latest?.id ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={async () =>
                          (await run(
                            { op: "template_rollback", templateId, versionId: v.id },
                            `Copied v${v.version} into a new draft.`,
                          )) && load()
                        }
                      >
                        Restore as draft
                      </Button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter className="flex-wrap">
        <div className="mr-auto text-sm">
          {errors.length ? (
            <details>
              <summary className="cursor-pointer font-semibold text-red-700">
                {errors.length} problem(s)
              </summary>
              <ul className="mt-1 max-w-xl list-disc pl-5 text-xs text-red-800">
                {errors.map((e, n) => (
                  <li key={n}>{e.message}</li>
                ))}
              </ul>
            </details>
          ) : (
            <span className="font-semibold text-emerald-700">No problems found</span>
          )}
        </div>
        {canEdit ? (
          <>
            <Input
              aria-label="Change summary"
              className="h-10 w-56"
              placeholder="What changed?"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
            <Button variant="secondary" disabled={busy || !dirty || !schemaOk} onClick={save}>
              Save draft
            </Button>
            <Button
              disabled={busy || dirty || errors.length > 0 || latest?.status !== "draft"}
              onClick={publish}
              title={dirty ? "Save first" : undefined}
            >
              {full?.access.isLeadership ? "Publish" : "Request publish"}
            </Button>
          </>
        ) : null}
      </DialogFooter>
    </Dialog>
  );
}

function InputsEditor({
  def,
  update,
  disabled,
}: {
  def: WorkflowDefinition;
  update: (d: WorkflowDefinition) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-[var(--acton-navy)]">Starting information</p>
      <ul className="space-y-1">
        {def.inputs.map((inp, i) => (
          <li key={i} className="flex gap-1">
            <Input
              aria-label="Label"
              className="h-8 text-xs"
              value={inp.label}
              disabled={disabled}
              onChange={(e) =>
                update({
                  ...def,
                  inputs: def.inputs.map((x, n) =>
                    n === i
                      ? {
                          ...x,
                          label: e.target.value,
                          key:
                            n === i && !x.key
                              ? e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_")
                              : x.key,
                        }
                      : x,
                  ),
                })
              }
            />
            <select
              aria-label="Type"
              className={cn(selectClass, "h-8 w-24 text-xs")}
              value={inp.type}
              disabled={disabled}
              onChange={(e) =>
                update({
                  ...def,
                  inputs: def.inputs.map((x, n) =>
                    n === i ? { ...x, type: e.target.value as typeof x.type } : x,
                  ),
                })
              }
            >
              {["text", "date", "email", "person"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            {!disabled ? (
              <button
                type="button"
                aria-label="Remove"
                className="px-1 text-[var(--acton-muted)]"
                onClick={() => update({ ...def, inputs: def.inputs.filter((_, n) => n !== i) })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {!disabled ? (
        <button
          type="button"
          className="mt-1 text-xs font-semibold text-[var(--acton-navy)] underline"
          onClick={() =>
            update({
              ...def,
              inputs: [
                ...def.inputs,
                {
                  key: `field_${def.inputs.length + 1}`,
                  label: "New field",
                  type: "text",
                  required: true,
                },
              ],
            })
          }
        >
          Add field
        </button>
      ) : null}
      <p className="mt-1 text-xs text-[var(--acton-muted)]">
        Ids: {def.inputs.map((i) => i.key).join(", ") || "none"}. Use {"{{id}}"} in messages.
      </p>
    </div>
  );
}

function StepEditor({
  step,
  index,
  def,
  disabled,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
  profiles,
}: {
  step: StepDefinition;
  index: number;
  def: WorkflowDefinition;
  disabled: boolean;
  onChange: (p: Partial<StepDefinition>) => void;
  onMove: (d: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  profiles: Array<{ id: string; full_name: string }>;
}) {
  const id = (k: string) => `st-${index}-${k}`;
  const others = def.steps.filter((s) => s.key !== step.key);
  const forcedRole =
    step.type === "access_request"
      ? "coo"
      : step.type === "finance_handoff"
        ? "finance_owner"
        : null;
  return (
    <fieldset
      disabled={disabled}
      className="space-y-4 rounded-lg border border-[var(--acton-border)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="text-sm font-bold text-[var(--acton-navy)]">Step {index + 1}</legend>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" aria-label="Move up" onClick={() => onMove(-1)}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Move down" onClick={() => onMove(1)}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Duplicate" onClick={onDuplicate}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Delete step" onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" htmlFor={id("title")}>
          <Input
            id={id("title")}
            value={step.title}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </Field>
        <Field label="Kind of step" htmlFor={id("type")} help={STEP_TYPES[step.type].description}>
          <select
            id={id("type")}
            className={selectClass}
            value={step.type}
            onChange={(e) => {
              const type = e.target.value as StepType;
              onChange({
                type,
                assignee:
                  type === "access_request"
                    ? { role: "coo", profileId: null }
                    : type === "finance_handoff"
                      ? { role: "finance_owner", profileId: null }
                      : type === "approval"
                        ? { role: "leadership", profileId: null }
                        : step.assignee,
              });
            }}
          >
            {(Object.keys(STEP_TYPES) as StepType[]).map((t) => (
              <option key={t} value={t}>
                {STEP_TYPES[t].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Stage (timeline group)" htmlFor={id("stage")}>
          <Input
            id={id("stage")}
            value={step.stage}
            onChange={(e) => onChange({ stage: e.target.value })}
            placeholder="e.g. Before start"
          />
        </Field>
        <Field
          label="Step id"
          htmlFor={id("key")}
          help="Used for dependencies. Lowercase, no spaces."
        >
          <Input
            id={id("key")}
            value={step.key}
            onChange={(e) =>
              onChange({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-") })
            }
          />
        </Field>
      </div>
      <Field label="Instructions" htmlFor={id("desc")}>
        <textarea
          id={id("desc")}
          rows={2}
          className={textareaClass}
          value={step.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Who does it"
          htmlFor={id("role")}
          help={forcedRole ? "Fixed by policy for this kind of step." : undefined}
        >
          <select
            id={id("role")}
            className={selectClass}
            disabled={Boolean(forcedRole)}
            value={step.assignee.role}
            onChange={(e) =>
              onChange({
                assignee: {
                  role: e.target.value as StepDefinition["assignee"]["role"],
                  profileId: null,
                },
              })
            }
          >
            {ASSIGNEE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        {step.assignee.role === "specific_person" ? (
          <Field label="Person" htmlFor={id("person")}>
            <PersonSelect
              id={id("person")}
              profiles={profiles}
              value={step.assignee.profileId}
              onChange={(v) => onChange({ assignee: { role: "specific_person", profileId: v } })}
            />
          </Field>
        ) : null}
        {step.type !== "wait_until" ? (
          <Field
            label="Due (days from anchor date)"
            htmlFor={id("due")}
            help="Negative = before. Leave blank for no due date."
          >
            <Input
              id={id("due")}
              type="number"
              value={step.dueOffsetDays ?? ""}
              onChange={(e) =>
                onChange({ dueOffsetDays: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </Field>
        ) : (
          <Field label="Wait until (days from anchor date)" htmlFor={id("wait")}>
            <Input
              id={id("wait")}
              type="number"
              value={step.waitOffsetDays ?? ""}
              onChange={(e) =>
                onChange({ waitOffsetDays: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </Field>
        )}
      </div>
      <Field label="Starts after" help="This step becomes available once these are done.">
        <div className="flex flex-wrap gap-2">
          {others.length === 0 ? (
            <span className="text-xs text-[var(--acton-muted)]">No other steps.</span>
          ) : null}
          {others.map((o) => (
            <label
              key={o.key}
              className="flex items-center gap-1.5 rounded border border-[var(--acton-border)] px-2 py-1 text-xs"
            >
              <input
                type="checkbox"
                checked={step.dependsOn.includes(o.key)}
                onChange={(e) =>
                  onChange({
                    dependsOn: e.target.checked
                      ? [...step.dependsOn, o.key]
                      : step.dependsOn.filter((k) => k !== o.key),
                  })
                }
              />
              {o.title}
            </label>
          ))}
        </div>
      </Field>
      {STEP_TYPES[step.type].human ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Remind every (days overdue)" htmlFor={id("rem")}>
            <Input
              id={id("rem")}
              type="number"
              min={1}
              value={step.reminder.everyDays ?? ""}
              onChange={(e) =>
                onChange({
                  reminder: {
                    ...step.reminder,
                    everyDays: e.target.value === "" ? null : Number(e.target.value),
                  },
                })
              }
            />
          </Field>
          <Field label="Escalate to CEO/COO after (days)" htmlFor={id("esc")}>
            <Input
              id={id("esc")}
              type="number"
              min={1}
              value={step.reminder.escalateAfterDays ?? ""}
              onChange={(e) =>
                onChange({
                  reminder: {
                    ...step.reminder,
                    escalateAfterDays: e.target.value === "" ? null : Number(e.target.value),
                  },
                })
              }
            />
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={step.evidenceRequired}
              onChange={(e) => onChange({ evidenceRequired: e.target.checked })}
            />
            Require a completion note
          </label>
        </div>
      ) : null}
      {step.type === "checklist" || step.type === "access_request" ? (
        <Field label="Checklist items (one per line)" htmlFor={id("cl")}>
          <textarea
            id={id("cl")}
            rows={4}
            className={textareaClass}
            value={step.checklist.join("\n")}
            onChange={(e) =>
              onChange({
                checklist: e.target.value
                  .split("\n")
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      ) : null}
      {step.type === "collect_information" ? (
        <Field
          label="Fields to collect (one per line; add “?” at the end for optional)"
          htmlFor={id("fields")}
        >
          <textarea
            id={id("fields")}
            rows={4}
            className={textareaClass}
            value={step.fields.map((f) => `${f.label}${f.required ? "" : "?"}`).join("\n")}
            onChange={(e) =>
              onChange({
                fields: e.target.value
                  .split("\n")
                  .map((x) => x.trim())
                  .filter(Boolean)
                  .map((l) => ({
                    key:
                      l
                        .replace(/\?$/, "")
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "_")
                        .replace(/^_|_$/g, "")
                        .replace(/^(\d)/, "f_$1") || "field",
                    label: l.replace(/\?$/, ""),
                    required: !l.endsWith("?"),
                  })),
              })
            }
          />
        </Field>
      ) : null}
      {["upload_document", "verify_document"].includes(step.type) ||
      (step.type === "external_action" &&
        ["drive_file", "docusign_send"].includes(step.action.type ?? "")) ? (
        <Field
          label="Document category"
          htmlFor={id("cat")}
          help="e.g. signed_offer_letter, i9, insurance_certificate"
        >
          <Input
            id={id("cat")}
            value={step.documentCategory}
            onChange={(e) => onChange({ documentCategory: e.target.value.trim() })}
          />
        </Field>
      ) : null}
      {step.type === "communication" || step.type === "escalate" ? (
        <MessageEditor step={step} onChange={onChange} id={id} />
      ) : null}
      {step.type === "external_action" ? (
        <div className="space-y-3">
          <Field
            label="System action"
            htmlFor={id("act")}
            help="Runs only after the CEO or COO approves the exact details."
          >
            <select
              id={id("act")}
              className={selectClass}
              value={step.action.type ?? ""}
              onChange={(e) =>
                onChange({
                  action: {
                    type: (e.target.value || null) as StepDefinition["action"]["type"],
                    settings: {},
                  },
                })
              }
            >
              <option value="">Choose…</option>
              {ACTION_TYPES.filter((a) =>
                ["bamboohr_update", "drive_file", "docusign_send"].includes(a),
              ).map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABELS[a]}
                </option>
              ))}
            </select>
          </Field>
          {step.action.type === "bamboohr_update" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="BambooHR field"
                htmlFor={id("bf")}
                help="Must be on the allowlist (Integrations tab)."
              >
                <Input
                  id={id("bf")}
                  value={step.action.settings.field ?? ""}
                  onChange={(e) =>
                    onChange({
                      action: {
                        ...step.action,
                        settings: { ...step.action.settings, field: e.target.value },
                      },
                    })
                  }
                />
              </Field>
              <Field label="New value" htmlFor={id("bv")} help="May use {{fields}}.">
                <Input
                  id={id("bv")}
                  value={step.action.settings.value ?? ""}
                  onChange={(e) =>
                    onChange({
                      action: {
                        ...step.action,
                        settings: { ...step.action.settings, value: e.target.value },
                      },
                    })
                  }
                />
              </Field>
            </div>
          ) : null}
          {step.action.type === "drive_file" ? (
            <Field
              label="Drive destination"
              htmlFor={id("df")}
              help="Folder ids are set per entity on the Integrations tab."
            >
              <select
                id={id("df")}
                className={selectClass}
                value={step.action.settings.folder ?? "employee_documents"}
                onChange={(e) =>
                  onChange({
                    action: {
                      ...step.action,
                      settings: {
                        ...step.action.settings,
                        folder: e.target.value,
                        documentCategory: step.documentCategory,
                      },
                    },
                  })
                }
              >
                <option value="employee_documents">Employee documents</option>
                <option value="contracts">Contracts</option>
                <option value="insurance">Insurance</option>
              </select>
            </Field>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}

function MessageEditor({
  step,
  onChange,
  id,
}: {
  step: StepDefinition;
  onChange: (p: Partial<StepDefinition>) => void;
  id: (k: string) => string;
}) {
  const m = step.message;
  const set = (p: Partial<StepDefinition["message"]>) => onChange({ message: { ...m, ...p } });
  return (
    <div className="space-y-3 rounded-md bg-[var(--acton-gray-50)] p-3">
      <p className="text-xs text-[var(--acton-muted)]">
        Sam drafts this message; it sends only after the CEO or COO approves it. Merge fields:{" "}
        {
          "{{employee_name}} {{first_name}} {{position}} {{start_date}} {{end_date}} {{entity_name}}"
        }{" "}
        plus your starting information.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Channel" htmlFor={id("ch")}>
          <select
            id={id("ch")}
            className={selectClass}
            value={m.channel}
            onChange={(e) => set({ channel: e.target.value as "email" | "slack" })}
          >
            <option value="email">Email</option>
            <option value="slack">Slack direct message</option>
          </select>
        </Field>
        <Field label="Recipient" htmlFor={id("rc")}>
          <select
            id={id("rc")}
            className={selectClass}
            value={m.recipient}
            onChange={(e) =>
              set({ recipient: e.target.value as StepDefinition["message"]["recipient"] })
            }
          >
            <option value="employee">The employee</option>
            <option value="assignee">The step&apos;s owner</option>
            <option value="leadership">CEO and COO</option>
            <option value="finance_owner">Head of finance</option>
            <option value="custom">A specific address</option>
          </select>
        </Field>
      </div>
      {m.recipient === "custom" ? (
        <Field label="Address" htmlFor={id("cr")}>
          <Input
            id={id("cr")}
            value={m.customRecipient}
            onChange={(e) => set({ customRecipient: e.target.value })}
          />
        </Field>
      ) : null}
      <Field label="Subject" htmlFor={id("sub")}>
        <Input
          id={id("sub")}
          value={m.subject}
          onChange={(e) => set({ subject: e.target.value })}
        />
      </Field>
      <Field label="Message" htmlFor={id("body")}>
        <textarea
          id={id("body")}
          rows={6}
          className={textareaClass}
          value={m.body}
          onChange={(e) => set({ body: e.target.value })}
        />
      </Field>
    </div>
  );
}

function Preview({ def }: { def: WorkflowDefinition }) {
  const anchor = {
    workflow_start: "the workflow starts",
    start_date: "the start date",
    end_date: "the last day",
    target_date: "the target date",
  }[def.anchor];
  const ordered = [...def.steps].sort(
    (a, b) =>
      (a.dueOffsetDays ?? a.waitOffsetDays ?? 999) - (b.dueOffsetDays ?? b.waitOffsetDays ?? 999),
  );
  return (
    <div className="space-y-3">
      <Notice tone="info">
        This is what someone starting the workflow will see. Days are relative to {anchor}.
      </Notice>
      <ol className="relative space-y-3 border-l-2 border-[var(--acton-border)] pl-5">
        {ordered.map((s) => {
          const offset = s.type === "wait_until" ? s.waitOffsetDays : s.dueOffsetDays;
          return (
            <li key={s.key}>
              <span
                className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full bg-[var(--acton-navy)]"
                aria-hidden
              />
              <p className="text-xs font-semibold text-[var(--acton-muted)]">
                {offset === null
                  ? "No date"
                  : offset === 0
                    ? `On ${anchor}`
                    : `${Math.abs(offset)} day(s) ${offset < 0 ? "before" : "after"} ${anchor}`}
              </p>
              <p className="font-medium text-[var(--acton-navy)]">{s.title}</p>
              <p className="text-xs text-[var(--acton-muted)]">
                {STEP_TYPES[s.type].label} · {ROLE_LABELS[s.assignee.role]}
                {s.dependsOn.length
                  ? ` · after ${s.dependsOn.map((k) => def.steps.find((x) => x.key === k)?.title ?? k).join(", ")}`
                  : ""}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
