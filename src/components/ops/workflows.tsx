"use client";

/**
 * Inbox, running workflows (active / onboarding / offboarding views), workflow detail with step
 * completion, starting a workflow, and the approvals queue for Sam's actions.
 */

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, FileUp, Play, ShieldCheck } from "lucide-react";
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
import type { loadInstance } from "@/lib/ops/commands";
import { cn } from "@/lib/utils";
import {
  ModePill,
  PersonSelect,
  ProgressBar,
  SectionHeader,
  StatusPill,
  TonePill,
  dueLabel,
  nameOf,
  useFullOps,
  useOps,
  type ActionView,
  type InboxStep,
  type InstanceView,
} from "./shared";

type InstanceDetail = Awaited<ReturnType<typeof loadInstance>>;
type StepView = InstanceDetail["steps"][number];

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
export function InboxTab({ onOpen }: { onOpen: (instanceId: string) => void }) {
  const { state } = useOps();
  const inbox = state?.inbox ?? [];
  return (
    <div>
      <SectionHeader
        title="My tasks"
        description="Workflow steps waiting on you. Access steps go only to the COO; finance steps go only to the head of finance."
      />
      {inbox.length === 0 ? (
        <EmptyState title="You're all caught up">Nothing is assigned to you right now.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {inbox.map((s: InboxStep) => {
            const due = dueLabel(s.due_at);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpen(s.instance_id)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--acton-border)] bg-white p-4 text-left shadow-sm hover:bg-[var(--acton-gray-50)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--acton-navy)]">{s.title}</p>
                    <p className="text-sm text-[var(--acton-muted)]">
                      {s.subjectLabel} · {s.roleLabel}
                    </p>
                    {s.last_error ? (
                      <p className="mt-1 text-xs font-medium text-amber-800">{s.last_error}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <ModePill mode={s.mode} />
                    <span
                      className={cn(
                        "text-sm font-medium",
                        due.overdue ? "text-red-700" : "text-[var(--acton-muted)]",
                      )}
                    >
                      {due.text}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workflow lists
// ---------------------------------------------------------------------------
export function WorkflowsTab({
  category,
  title,
  description,
  onOpen,
}: {
  category?: string;
  title: string;
  description: string;
  onOpen: (id: string) => void;
}) {
  const { state } = useOps();
  const { full } = useFullOps();
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [startOpen, setStartOpen] = useState(false);
  const rows = (state?.myWorkflows ?? []).filter(
    (w) =>
      (!category || w.category === category) &&
      (filter === "all" || ["pending_approval", "active", "paused"].includes(w.status)),
  );
  return (
    <div>
      <SectionHeader
        title={title}
        description={description}
        actions={
          <>
            <select
              aria-label="Show"
              className={cn(selectClass, "h-9 w-auto")}
              value={filter}
              onChange={(e) => setFilter(e.target.value as "open" | "all")}
            >
              <option value="open">Open</option>
              <option value="all">All, including finished</option>
            </select>
            {full?.access.canConfigure ? (
              <Button size="sm" onClick={() => setStartOpen(true)}>
                <Play className="h-4 w-4" aria-hidden /> Start a workflow
              </Button>
            ) : null}
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No workflows here">
          {full?.access.canConfigure
            ? "Publish a workflow in the Library, then start it for an approved employee or business event."
            : "Nothing involving you right now."}
        </EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((w: InstanceView) => (
            <button
              key={w.id}
              type="button"
              onClick={() => onOpen(w.id)}
              className="rounded-lg border border-[var(--acton-border)] bg-white p-4 text-left shadow-sm hover:bg-[var(--acton-gray-50)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--acton-navy)]">{w.subject_label}</p>
                  <p className="text-sm text-[var(--acton-muted)]">{w.templateName}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <ModePill mode={w.mode} />
                  <StatusPill status={w.status} />
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                <ProgressBar percent={w.progress} />
                <p className="flex flex-wrap gap-x-3 text-xs text-[var(--acton-muted)]">
                  <span>
                    {w.stepsDone}/{w.stepsTotal} steps
                  </span>
                  {w.currentStage ? <span>Stage: {w.currentStage}</span> : null}
                  {w.overdue ? (
                    <span className="font-semibold text-red-700">{w.overdue} overdue</span>
                  ) : null}
                  {w.awaitingApproval ? (
                    <span className="font-semibold text-amber-800">
                      {w.awaitingApproval} awaiting approval
                    </span>
                  ) : null}
                  {w.blocked ? (
                    <span className="font-semibold text-amber-800">{w.blocked} need attention</span>
                  ) : null}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
      {startOpen ? (
        <StartWorkflowDialog
          category={category}
          onClose={() => setStartOpen(false)}
          onStarted={onOpen}
        />
      ) : null}
    </div>
  );
}

function StartWorkflowDialog({
  category,
  onClose,
  onStarted,
}: {
  category?: string;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const { full, run, busy } = useFullOps();
  const published = (full?.templates ?? []).filter(
    (t) => t.status === "published" && (!category || t.category === category),
  );
  const [templateId, setTemplateId] = useState(published[0]?.id ?? "");
  const template = published.find((t) => t.id === templateId);
  const def = template?.publishedVersion?.definition;
  const [personId, setPersonId] = useState<string>("");
  const [entityId, setEntityId] = useState<string>(full?.entities[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"live" | "test">("test");
  const [reason, setReason] = useState("");
  const person = full?.people.find((p) => p.id === personId);

  async function submit() {
    if (!template) return;
    const res = await run<{ id: string }>(
      {
        op: "workflow_start",
        templateId: template.id,
        entityId: entityId || null,
        personId: personId || null,
        subjectLabel: subject || person?.full_name || template.name,
        inputs,
        mode,
        reason,
        // Same person + inputs + mode → same workflow, even after a double click or retry.
        idempotencyKey: `ui:${template.id}:${shortHash(`${personId || subject}|${JSON.stringify(inputs)}|${mode}`)}`,
      },
      mode === "test"
        ? "Test workflow created — simulate its approval from the Approvals tab."
        : "Requested — the CEO or COO must approve before it starts.",
    );
    if (res?.id) {
      onClose();
      onStarted(res.id);
    }
  }

  return (
    <Dialog open onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>Start a workflow</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {published.length === 0 ? (
          <Notice tone="warning">
            No published workflows{category ? ` in ${category}` : ""} yet. Starter workflows are
            drafts until leadership reviews and publishes them in the Library.
          </Notice>
        ) : (
          <>
            <Field label="Workflow" htmlFor="sw-template">
              <select
                id="sw-template"
                className={selectClass}
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                {published.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (v{t.publishedVersion?.version}){t.official ? "" : " — unofficial"}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Employee (optional)"
                htmlFor="sw-person"
                help="People are added on the Setup → People card."
              >
                <select
                  id="sw-person"
                  className={selectClass}
                  value={personId}
                  onChange={(e) => setPersonId(e.target.value)}
                >
                  <option value="">Not about one person</option>
                  {full?.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                      {p.test_record ? " (test)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Legal entity" htmlFor="sw-entity">
                <select
                  id="sw-entity"
                  className={selectClass}
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                >
                  {full?.entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.confirmed ? "" : " (unconfirmed)"}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field
              label="Label"
              htmlFor="sw-subject"
              help="Shown everywhere this workflow appears."
            >
              <Input
                id="sw-subject"
                value={subject}
                placeholder={person?.full_name ?? "e.g. General liability renewal 2027"}
                onChange={(e) => setSubject(e.target.value)}
              />
            </Field>
            {def?.inputs.map((i) => (
              <Field
                key={i.key}
                label={`${i.label}${i.required ? "" : " (optional)"}`}
                htmlFor={`sw-${i.key}`}
              >
                {i.type === "person" ? (
                  <PersonSelect
                    id={`sw-${i.key}`}
                    profiles={full?.profiles ?? []}
                    value={inputs[i.key] ?? null}
                    onChange={(v) => setInputs((p) => ({ ...p, [i.key]: v ?? "" }))}
                  />
                ) : (
                  <Input
                    id={`sw-${i.key}`}
                    type={i.type === "date" ? "date" : i.type === "email" ? "email" : "text"}
                    value={inputs[i.key] ?? ""}
                    onChange={(e) => setInputs((p) => ({ ...p, [i.key]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-[var(--acton-navy)]">Mode</legend>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="sw-mode"
                  checked={mode === "test"}
                  onChange={() => setMode("test")}
                  className="mt-1"
                />
                <span>
                  <strong>Test run</strong> — synthetic walkthrough. No emails, Slack messages,
                  BambooHR changes, Drive uploads, or signature requests are made.
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="sw-mode"
                  checked={mode === "live"}
                  onChange={() => setMode("live")}
                  className="mt-1"
                />
                <span>
                  <strong>Live</strong> — the CEO or COO approves the start, then approves each
                  message and system change.
                </span>
              </label>
            </fieldset>
            {mode === "live" ? (
              <Field
                label="What approved event starts this?"
                htmlFor="sw-reason"
                help="Shown to the CEO/COO, e.g. “Offer accepted on 10/20; start date confirmed by Jackson.”"
              >
                <textarea
                  id="sw-reason"
                  rows={2}
                  className={textareaClass}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            ) : null}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy || !template}>
          {mode === "test" ? "Create test run" : "Request approval to start"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** Short, stable (non-cryptographic) hash for client idempotency keys. */
function shortHash(text: string): string {
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = (a * 33) ^ c;
    b = (b * 33) ^ c;
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

// ---------------------------------------------------------------------------
// Workflow detail
// ---------------------------------------------------------------------------
export function InstanceDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { full, run, busy, reload: reloadAll } = useFullOps();
  const [detail, setDetail] = useState<InstanceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [migration, setMigration] = useState<{
    toVersion: number;
    added: string[];
    removed: string[];
    updated: string[];
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await aiFetch<InstanceDetail>(`/api/ops/instances/${id}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);
  useLoad(load);

  async function act(cmd: Record<string, unknown>, msg?: string) {
    const r = await run(cmd, msg);
    await load();
    return r;
  }

  const stages = useMemo(() => {
    const groups = new Map<string, StepView[]>();
    for (const s of detail?.steps ?? [])
      groups.set(s.stage ?? "Steps", [...(groups.get(s.stage ?? "Steps") ?? []), s]);
    return [...groups.entries()];
  }, [detail]);

  const i = detail?.instance;
  const canManage = full?.access.canConfigure;
  const isLeader = full?.access.isLeadership;
  const newerVersion =
    detail?.template?.published_version_id &&
    i &&
    detail.template.published_version_id !== i.version_id;

  return (
    <Dialog open onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>{i ? i.subject_label : "Workflow"}</DialogTitle>
        {i ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--acton-muted)]">
            <span>
              {detail?.template?.name} · version {detail?.version?.version} (pinned)
            </span>
            <StatusPill status={i.status} />
            <ModePill mode={i.mode} />
          </div>
        ) : null}
      </DialogHeader>
      <DialogBody className="max-h-[70vh] space-y-5 overflow-y-auto">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!detail ? <p className="text-sm text-[var(--acton-muted)]">Loading…</p> : null}
        {i?.status === "pending_approval" ? (
          <Notice tone="warning">
            Waiting for the CEO or COO to approve starting this workflow (Approvals tab). Nothing
            runs until then.
          </Notice>
        ) : null}
        {newerVersion && canManage && ["active", "paused"].includes(i!.status) ? (
          <Notice tone="info">
            A newer version of this workflow is published.{" "}
            <button
              type="button"
              className="font-semibold underline"
              onClick={async () =>
                setMigration(
                  (await act({
                    op: "workflow_migrate",
                    instanceId: id,
                    apply: false,
                  })) as typeof migration,
                )
              }
            >
              Review the changes
            </button>
            {migration ? (
              <span className="mt-2 block">
                To v{migration.toVersion}:{" "}
                {migration.added.length ? `adds ${migration.added.join(", ")}; ` : ""}
                {migration.removed.length ? `removes ${migration.removed.join(", ")}; ` : ""}
                {migration.updated.length
                  ? `updates ${migration.updated.length} open step(s). `
                  : ""}
                Completed steps keep their history.{" "}
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() =>
                    act(
                      { op: "workflow_migrate", instanceId: id, apply: true },
                      "Migrated to the new version.",
                    )
                  }
                >
                  Apply migration
                </button>
              </span>
            ) : null}
          </Notice>
        ) : null}
        {stages.map(([stage, steps]) => (
          <section key={stage}>
            <h3 className="mb-2 text-xs font-bold tracking-wide text-[var(--acton-muted)] uppercase">
              {stage}
            </h3>
            <ol className="space-y-2">
              {steps.map((s) => (
                <StepRow
                  key={s.id}
                  step={s}
                  open={openStep === s.id}
                  onToggle={() => setOpenStep(openStep === s.id ? null : s.id)}
                  detail={detail!}
                  act={act}
                  refresh={load}
                />
              ))}
            </ol>
          </section>
        ))}
        {detail?.actions.length ? (
          <section>
            <h3 className="mb-2 text-xs font-bold tracking-wide text-[var(--acton-muted)] uppercase">
              Actions Sam proposed
            </h3>
            <ul className="space-y-1.5">
              {detail.actions.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm"
                >
                  <span className="min-w-0 text-[var(--acton-navy)]">{a.title}</span>
                  <StatusPill status={a.status} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </DialogBody>
      <DialogFooter>
        {canManage && i && i.status === "active" ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              act(
                { op: "workflow_status", instanceId: id, status: "paused", reason: "" },
                "Paused.",
              )
            }
          >
            Pause
          </Button>
        ) : null}
        {canManage && i?.status === "paused" ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              act(
                { op: "workflow_status", instanceId: id, status: "active", reason: "" },
                "Resumed.",
              )
            }
          >
            Resume
          </Button>
        ) : null}
        {isLeader && i && ["active", "paused", "pending_approval"].includes(i.status) ? (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt("Why is this workflow being cancelled?");
              if (reason)
                void act(
                  { op: "workflow_status", instanceId: id, status: "cancelled", reason },
                  "Cancelled.",
                );
            }}
          >
            Cancel workflow
          </Button>
        ) : null}
        <Button
          onClick={() => {
            void reloadAll();
            onClose();
          }}
        >
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function StepRow({
  step,
  open,
  onToggle,
  detail,
  act,
  refresh,
}: {
  step: StepView;
  open: boolean;
  onToggle: () => void;
  detail: InstanceDetail;
  act: (cmd: Record<string, unknown>, msg?: string) => Promise<unknown>;
  refresh: () => Promise<void>;
}) {
  const { full, state } = useFullOps();
  const due = dueLabel(step.due_at);
  const done = ["completed", "skipped"].includes(step.status);
  const human = state?.stepTypes[step.type]?.human;
  const canAct =
    human &&
    ["ready", "in_progress", "failed"].includes(step.status) &&
    detail.instance.status === "active";
  const Icon = done
    ? CheckCircle2
    : step.last_error
      ? AlertTriangle
      : step.type === "access_request"
        ? ShieldCheck
        : Clock;
  return (
    <li
      className={cn(
        "rounded-lg border bg-white",
        step.last_error && !done ? "border-amber-300" : "border-[var(--acton-border)]",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <Icon
          className={cn(
            "mt-0.5 h-5 w-5 shrink-0",
            done
              ? "text-emerald-600"
              : step.last_error
                ? "text-amber-600"
                : "text-[var(--acton-muted)]",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[var(--acton-navy)]">{step.title}</p>
          <p className="text-xs text-[var(--acton-muted)]">
            {state?.stepTypes[step.type]?.label} ·{" "}
            {step.assignee_profile_id
              ? nameOf(full?.profiles, step.assignee_profile_id)
              : (state?.roleLabels[step.assignee_role as keyof typeof state.roleLabels] ??
                step.assignee_role)}
            {!done && step.due_at ? (
              <span className={cn("ml-1", due.overdue && "font-semibold text-red-700")}>
                · {due.text}
              </span>
            ) : null}
          </p>
          {step.last_error && !done ? (
            <p className="mt-1 text-xs font-medium text-amber-800">{step.last_error}</p>
          ) : null}
        </div>
        <StatusPill status={step.status} />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-[var(--acton-border)] p-3">
          {step.config.description ? (
            <p className="text-sm text-[var(--acton-navy)]">{step.config.description}</p>
          ) : null}
          {step.evidence.length ? (
            <ul className="space-y-1 text-xs text-[var(--acton-muted)]">
              {step.evidence.map((e, n) => (
                <li key={n}>
                  {e.kind === "link" ? (
                    <a
                      href={e.value}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline"
                    >
                      {e.value}
                    </a>
                  ) : (
                    e.value
                  )}{" "}
                  · {formatDateTime(e.at)}
                </li>
              ))}
            </ul>
          ) : null}
          {step.override_reason ? (
            <p className="text-xs text-[var(--acton-muted)]">
              Skipped by leadership: {step.override_reason}
            </p>
          ) : null}
          {canAct ? (
            <CompleteStepForm step={step} detail={detail} act={act} refresh={refresh} />
          ) : null}
          {!done && full?.access.isLeadership && step.status !== "cancelled" ? (
            <button
              type="button"
              className="text-xs font-semibold text-[var(--acton-muted)] underline"
              onClick={() => {
                const reason = window.prompt(
                  "Why should this step be skipped? (recorded in the audit log)",
                );
                if (reason)
                  void act({ op: "step_override", stepId: step.id, reason }, "Step skipped.");
              }}
            >
              Skip this step (leadership override)
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function CompleteStepForm({
  step,
  detail,
  act,
  refresh,
}: {
  step: StepView;
  detail: InstanceDetail;
  act: (cmd: Record<string, unknown>, msg?: string) => Promise<unknown>;
  refresh: () => Promise<void>;
}) {
  const { busy } = useOps();
  const cfg = step.config;
  const [data, setData] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const docs = (detail.documents ?? []).filter(
    (d) => !cfg.documentCategory || d.category === cfg.documentCategory,
  );

  async function upload(file: File) {
    setUploading(true);
    setUploadMsg(null);
    const form = new FormData();
    form.set("file", file);
    form.set("category", cfg.documentCategory);
    if (detail.instance.person_id) form.set("personId", detail.instance.person_id);
    if (detail.instance.entity_id) form.set("entityId", detail.instance.entity_id);
    form.set("instanceId", detail.instance.id);
    form.set("stepId", step.id);
    try {
      await aiFetch("/api/ops/documents", { method: "POST", body: form });
      setUploadMsg(`Uploaded ${file.name}. Now mark the step done.`);
      await refresh();
    } catch (e) {
      setUploadMsg(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  const label =
    step.type === "access_request"
      ? "Confirm access is done"
      : step.type === "finance_handoff"
        ? "Confirm finance handled this"
        : "Mark done";
  return (
    <div className="space-y-3 rounded-md bg-[var(--acton-gray-50)] p-3">
      {step.type === "access_request" ? (
        <Notice tone="info">
          Only the COO completes access steps. Record exactly what was granted or removed — Sam
          never changes access itself.
        </Notice>
      ) : null}
      {step.type === "collect_information"
        ? cfg.fields.map((f) => (
            <Field
              key={f.key}
              label={`${f.label}${f.required ? "" : " (optional)"}`}
              htmlFor={`f-${step.id}-${f.key}`}
            >
              <Input
                id={`f-${step.id}-${f.key}`}
                value={data[f.key] ?? ""}
                onChange={(e) => setData((p) => ({ ...p, [f.key]: e.target.value }))}
              />
            </Field>
          ))
        : null}
      {(step.type === "checklist" || step.type === "access_request") && cfg.checklist.length ? (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-semibold text-[var(--acton-navy)]">Checklist</legend>
          {cfg.checklist.map((item) => (
            <label key={item} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={checked.includes(item)}
                onChange={(e) =>
                  setChecked((p) => (e.target.checked ? [...p, item] : p.filter((x) => x !== item)))
                }
              />
              {item}
            </label>
          ))}
        </fieldset>
      ) : null}
      {step.type === "upload_document" || step.type === "verify_document" ? (
        <div className="space-y-2">
          {docs.length ? (
            <ul className="space-y-1 text-sm">
              {docs.map((d) => (
                <li key={d.id}>
                  <a
                    className="font-medium text-[var(--acton-navy)] underline"
                    href={`/api/ops/documents/${d.id}`}
                  >
                    {d.filename}
                  </a>{" "}
                  <span className="text-xs text-[var(--acton-muted)]">
                    v{d.version} · {d.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--acton-muted)]">
              No “{cfg.documentCategory}” document yet.
            </p>
          )}
          {step.type === "upload_document" ? (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[var(--acton-border)] bg-white px-3 py-1.5 text-sm font-semibold text-[var(--acton-navy)]">
              <FileUp className="h-4 w-4" aria-hidden />
              {uploading ? "Uploading…" : "Upload file"}
              <input
                type="file"
                className="sr-only"
                accept=".pdf,.docx,.png,.jpg,.jpeg,.txt"
                onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
              />
            </label>
          ) : null}
          {uploadMsg ? <p className="text-xs text-[var(--acton-muted)]">{uploadMsg}</p> : null}
        </div>
      ) : null}
      <Field
        label={
          cfg.evidenceRequired || step.type === "access_request"
            ? "Completion note (required)"
            : "Note (optional)"
        }
        htmlFor={`n-${step.id}`}
      >
        <textarea
          id={`n-${step.id}`}
          rows={2}
          className={textareaClass}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <Field label="Evidence link (optional)" htmlFor={`l-${step.id}`}>
        <Input
          id={`l-${step.id}`}
          value={link}
          placeholder="https://"
          onChange={(e) => setLink(e.target.value)}
        />
      </Field>
      <Button
        size="sm"
        disabled={busy}
        onClick={() =>
          act(
            {
              op: "step_complete",
              stepId: step.id,
              data,
              checklistDone: checked,
              note,
              evidenceUrl: link,
            },
            "Step completed.",
          )
        }
      >
        {label}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approvals queue (Sam's actions)
// ---------------------------------------------------------------------------
export function ApprovalsTab() {
  const { full, run, busy } = useFullOps();
  const [view, setView] = useState<"pending" | "attention" | "history">("pending");
  if (!full) return null;
  const actions = full.actions.filter((a) =>
    view === "pending"
      ? a.status === "pending_approval"
      : view === "attention"
        ? ["failed", "manual_required", "approved"].includes(a.status)
        : !["pending_approval"].includes(a.status),
  );
  const leader = full.access.isLeadership;
  return (
    <div>
      <SectionHeader
        title="Approvals"
        description="Every message, system change, and workflow start Sam proposes. Only the confirmed CEO or COO can approve; approval covers exactly what is shown — any change creates a new request. Silence never approves anything."
        actions={
          <div
            role="tablist"
            aria-label="Approval views"
            className="flex gap-1 rounded-md bg-[var(--acton-gray-100)] p-1"
          >
            {(["pending", "attention", "history"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "rounded px-3 py-1 text-sm font-semibold",
                  view === v
                    ? "bg-white text-[var(--acton-navy)] shadow-sm"
                    : "text-[var(--acton-muted)]",
                )}
              >
                {v === "pending" ? "Waiting" : v === "attention" ? "Needs attention" : "History"}
              </button>
            ))}
          </div>
        }
      />
      {!full.access.leadershipConfirmed ? (
        <Notice tone="warning" className="mb-4">
          The CEO and COO accounts aren&apos;t confirmed yet (Setup tab), so nothing can be
          approved.
        </Notice>
      ) : null}
      {actions.length === 0 ? (
        <EmptyState title="Nothing here">
          {view === "pending" ? "No actions are waiting for approval." : "No actions."}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {actions.map((a) => (
            <ActionCard
              key={a.id}
              a={a}
              leader={leader}
              canConfigure={full.access.canConfigure}
              busy={busy}
              run={run}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ActionCard({
  a,
  leader,
  canConfigure,
  busy,
  run,
}: {
  a: ActionView;
  leader: boolean;
  canConfigure: boolean;
  busy: boolean;
  run: (c: Record<string, unknown>, m?: string) => Promise<unknown>;
}) {
  const [showPayload, setShowPayload] = useState(false);
  const instructions = (a.result as { instructions?: string } | null)?.instructions;
  return (
    <li>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle>{a.title}</CardTitle>
            <CardDescription>
              Requested by {a.requested_by_label ?? "Sam"} · {formatDateTime(a.created_at)} · risk{" "}
              {a.risk}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ModePill mode={a.mode} />
            <StatusPill status={a.status} />
          </div>
        </div>
        <p className="text-sm whitespace-pre-wrap text-[var(--acton-navy)]">{a.summary}</p>
        {instructions ? <Notice tone="info">{instructions}</Notice> : null}
        {a.last_error ? <Notice tone="error">{a.last_error}</Notice> : null}
        <button
          type="button"
          className="text-xs font-semibold text-[var(--acton-muted)] underline"
          onClick={() => setShowPayload((v) => !v)}
        >
          {showPayload ? "Hide" : "Show"} exact details being approved
        </button>
        {showPayload ? (
          <pre className="max-h-64 overflow-auto rounded bg-[var(--acton-gray-50)] p-3 text-xs">
            {JSON.stringify(a.payload, null, 2)}
          </pre>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {a.status === "pending_approval" && leader ? (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(
                    { op: "action_decide", actionId: a.id, decision: "approved", note: null },
                    "Approved.",
                  )
                }
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  const note = window.prompt("Reason for declining (optional)") ?? "";
                  void run(
                    {
                      op: "action_decide",
                      actionId: a.id,
                      decision: "rejected",
                      note: note || null,
                    },
                    "Declined.",
                  );
                }}
              >
                Decline
              </Button>
            </>
          ) : null}
          {a.status === "pending_approval" && a.mode === "test" && canConfigure ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                run({ op: "action_simulate", actionId: a.id }, "Simulated approval (test only).")
              }
            >
              Simulate approval (test)
            </Button>
          ) : null}
          {a.status === "failed" && canConfigure ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => run({ op: "action_retry", actionId: a.id }, "Retrying.")}
            >
              Retry
            </Button>
          ) : null}
          {a.status === "manual_required" && canConfigure ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                const note = window.prompt("What was done by hand? (recorded as evidence)");
                if (note)
                  void run({ op: "action_manual_done", actionId: a.id, note }, "Recorded as done.");
              }}
            >
              Mark done by hand
            </Button>
          ) : null}
          {["pending_approval", "approved", "failed", "manual_required"].includes(a.status) &&
          canConfigure ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt("Why cancel this action?");
                if (reason) void run({ op: "action_cancel", actionId: a.id, reason }, "Cancelled.");
              }}
            >
              Cancel
            </Button>
          ) : null}
          {a.status === "pending_approval" && !leader ? (
            <TonePill tone="amber">Waiting for the CEO or COO</TonePill>
          ) : null}
        </div>
      </Card>
    </li>
  );
}
