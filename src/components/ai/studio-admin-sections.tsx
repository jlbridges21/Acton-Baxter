"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { History, MessageSquare, Send, Trash2 } from "lucide-react";
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
import { diffConfigs } from "@/lib/agents/config-diff";
import {
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVELS,
  agentConfigSchema,
  type AccessLevel,
  type SpecialistResult,
} from "@/lib/agents/types";
import { AvatarUploader } from "./avatar-uploader";
import type { StudioData } from "./studio-types";
import {
  AgentStatusPill,
  Field,
  Notice,
  Pill,
  TaskStatusPill,
  aiFetch,
  errorMessage,
  formatDateTime,
  formatUsd,
  selectClass,
  textareaClass,
} from "./ui";

type Department = { id: string; slug: string; name: string };
type AgentOption = { id: string; name: string };

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function OverviewSection({
  data,
  departments,
  agents,
  onSaved,
}: {
  data: StudioData;
  departments: Department[];
  agents: AgentOption[];
  onSaved: () => void;
}) {
  const a = data.agent;
  const canEdit = data.access.includes("manage");
  const [form, setForm] = useState({
    display_name: a.name,
    title: a.title,
    description: a.description,
    status_label: a.statusLabel ?? "",
    department_id: a.departmentId ?? "",
    manager_agent_id: a.managerId ?? "",
    status: a.status,
    deskArea: a.desk.area ?? "",
    deskSlot: a.desk.slot ?? 0,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [avatar, setAvatar] = useState(a.avatarUrl);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const patch: Record<string, unknown> = {
        display_name: form.display_name,
        title: form.title,
        description: form.description,
        status_label: form.status_label || null,
        desk: { area: form.deskArea || undefined, slot: Number(form.deskSlot) || 0 },
      };
      if (data.isAdmin) {
        patch.department_id = form.department_id || null;
        if (a.kind !== "orchestrator") {
          patch.manager_agent_id = form.manager_agent_id || null;
          patch.status = form.status;
        }
      }
      await aiFetch(`/api/ai/agents/${a.slug}`, { method: "PATCH", body: JSON.stringify(patch) });
      setMessage({ tone: "success", text: "Saved." });
      onSaved();
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="space-y-5">
        <CardTitle>Profile</CardTitle>
        {canEdit ? (
          <AvatarUploader
            slug={a.slug}
            name={a.name}
            url={avatar}
            color={a.departmentColor}
            onChanged={(u) => {
              setAvatar(u);
              onSaved();
            }}
          />
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" htmlFor="ov-name">
            <Input
              id="ov-name"
              value={form.display_name}
              readOnly={!canEdit}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </Field>
          <Field label="Title" htmlFor="ov-title">
            <Input
              id="ov-title"
              value={form.title}
              readOnly={!canEdit}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
        </div>
        <Field
          label="Description"
          help="Shown in the directory, office, and org chart."
          htmlFor="ov-desc"
        >
          <textarea
            id="ov-desc"
            rows={3}
            className={textareaClass}
            value={form.description}
            readOnly={!canEdit}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Department"
            help={
              data.isAdmin ? undefined : "Only administrators can move agents between departments."
            }
          >
            <select
              className={selectClass}
              value={form.department_id}
              disabled={!data.isAdmin}
              onChange={(e) => setForm({ ...form, department_id: e.target.value })}
            >
              <option value="">No department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          {a.kind !== "orchestrator" ? (
            <Field label="Reports to">
              <select
                className={selectClass}
                value={form.manager_agent_id}
                disabled={!data.isAdmin}
                onChange={(e) => setForm({ ...form, manager_agent_id: e.target.value })}
              >
                <option value="">Nobody</option>
                {agents
                  .filter((x) => x.id !== a.id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </Field>
          ) : null}
          {a.kind !== "orchestrator" ? (
            <Field label="Availability" help="Paused and archived agents never receive work.">
              <select
                className={selectClass}
                value={form.status}
                disabled={!data.isAdmin}
                onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
          ) : null}
          <Field
            label="Custom status label (optional)"
            help="e.g. 'Setting up' — shown under the name."
          >
            <Input
              value={form.status_label}
              readOnly={!canEdit}
              onChange={(e) => setForm({ ...form, status_label: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Office desk area" help="Which office room this agent sits in.">
            <select
              className={selectClass}
              value={form.deskArea}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, deskArea: e.target.value })}
            >
              <option value="">Their department&apos;s room</option>
              {departments.map((d) => (
                <option key={d.id} value={d.slug}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Desk position">
            <select
              className={selectClass}
              value={form.deskSlot}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, deskSlot: Number(e.target.value) })}
            >
              <option value={0}>Front left</option>
              <option value={1}>Front right</option>
              <option value={2}>Back left</option>
              <option value={3}>Back right</option>
            </select>
          </Field>
        </div>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {canEdit ? (
          <Button type="button" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </Button>
        ) : null}
      </Card>
      <Card className="space-y-3 self-start text-sm">
        <CardTitle>At a glance</CardTitle>
        <div className="flex items-center justify-between">
          <span className="text-[var(--acton-muted)]">Availability</span>
          <AgentStatusPill status={a.status} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--acton-muted)]">Live configuration</span>
          <span className="font-medium">
            {a.configValid ? `Version ${a.versionNumber}` : "Not published"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--acton-muted)]">AI model</span>
          <span className="font-medium">{a.model}</span>
        </div>
        <div>
          <span className="text-[var(--acton-muted)]">Your access</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {data.access.length ? (
              data.access.map((l) => (
                <Pill key={l} className="bg-slate-100 text-slate-700">
                  {ACCESS_LEVEL_LABELS[l].label}
                </Pill>
              ))
            ) : (
              <span>None</span>
            )}
          </div>
        </div>
        <Link
          href={`/ai/tasks?agent=${a.id}`}
          className="block text-sm font-medium text-[var(--acton-navy)] underline"
        >
          See this agent&apos;s tasks
        </Link>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

type PersonOption = { id: string; full_name: string; role: string };

export function AccessSection({ data, onChanged }: { data: StudioData; onChanged: () => void }) {
  const [policies, setPolicies] = useState(data.policies ?? []);
  const [people, setPeople] = useState<PersonOption[]>([]);
  // Employees' (human) departments — the same ones set on each person's profile.
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState<{
    principalType: "role" | "user" | "department";
    principalValue: string;
    accessLevel: AccessLevel;
  }>({
    principalType: "user",
    principalValue: "",
    accessLevel: "use_via_baxter",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data.isAdmin) return;
    aiFetch<{ people: PersonOption[]; departments: Array<{ id: string; name: string }> }>(
      "/api/ai/people",
    )
      .then((r) => {
        setPeople(r.people);
        setDepartments(r.departments);
      })
      .catch(() => setPeople([]));
  }, [data.isAdmin]);

  if (!data.isAdmin) {
    return (
      <Notice>Only administrators can view and change who has access to {data.agent.name}.</Notice>
    );
  }

  const label = (type: string, value: string) =>
    type === "role"
      ? value === "user"
        ? "Everyone with Baxter access"
        : value === "admin"
          ? "Administrators"
          : "Super-admins"
      : type === "department"
        ? `Department: ${departments.find((d) => d.id === value)?.name ?? value}`
        : (people.find((p) => p.id === value)?.full_name ?? `Person ${value.slice(0, 8)}…`);

  async function add() {
    setError(null);
    try {
      const res = await aiFetch<{ policies: typeof policies }>(
        `/api/ai/agents/${data.agent.slug}/access`,
        { method: "POST", body: JSON.stringify(form) },
      );
      setPolicies(res.policies);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function remove(policyId: string) {
    setError(null);
    try {
      const res = await aiFetch<{ policies: typeof policies }>(
        `/api/ai/agents/${data.agent.slug}/access`,
        { method: "DELETE", body: JSON.stringify({ policyId }) },
      );
      setPolicies(res.policies);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="space-y-6">
      <Notice>
        Administrators always have full access. Everyone else gets only what is listed here. Access
        is checked on the server for every request — in web chat, Slack, and here.
      </Notice>
      <Card>
        <CardTitle>What each permission means</CardTitle>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {ACCESS_LEVELS.map((l) => (
            <div key={l}>
              <dt className="text-sm font-semibold text-[var(--acton-navy)]">
                {ACCESS_LEVEL_LABELS[l].label}
              </dt>
              <dd className="text-sm text-[var(--acton-muted)]">{ACCESS_LEVEL_LABELS[l].help}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card className="space-y-4">
        <CardTitle>Who has access</CardTitle>
        {policies.length === 0 ? (
          <p className="text-sm text-[var(--acton-muted)]">
            Only administrators. Add people, roles, or departments below.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--acton-border)]">
            {policies.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-[var(--acton-navy)]">
                    {label(p.principal_type, p.principal_value)}
                  </span>
                  <span className="text-[var(--acton-muted)]">
                    {" "}
                    — {ACCESS_LEVEL_LABELS[p.access_level].label}
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(p.id)}
                  aria-label={`Remove ${ACCESS_LEVEL_LABELS[p.access_level].label}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 border-t border-[var(--acton-border)] pt-4 sm:grid-cols-[160px_minmax(0,1fr)_200px_auto] sm:items-end">
          <Field label="Grant to">
            <select
              className={selectClass}
              value={form.principalType}
              onChange={(e) =>
                setForm({
                  ...form,
                  principalType: e.target.value as typeof form.principalType,
                  principalValue: "",
                })
              }
            >
              <option value="user">A person</option>
              <option value="department">A department</option>
              <option value="role">A role</option>
            </select>
          </Field>
          <Field label="Who">
            {form.principalType === "user" ? (
              <select
                className={selectClass}
                value={form.principalValue}
                onChange={(e) => setForm({ ...form, principalValue: e.target.value })}
              >
                <option value="">Choose a person…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} ({p.role})
                  </option>
                ))}
              </select>
            ) : form.principalType === "department" ? (
              <select
                className={selectClass}
                value={form.principalValue}
                onChange={(e) => setForm({ ...form, principalValue: e.target.value })}
              >
                <option value="">Choose a department…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                className={selectClass}
                value={form.principalValue}
                onChange={(e) => setForm({ ...form, principalValue: e.target.value })}
              >
                <option value="">Choose a role…</option>
                <option value="user">Everyone with Baxter access</option>
              </select>
            )}
          </Field>
          <Field label="Permission">
            <select
              className={selectClass}
              value={form.accessLevel}
              onChange={(e) => setForm({ ...form, accessLevel: e.target.value as AccessLevel })}
            >
              {ACCESS_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {ACCESS_LEVEL_LABELS[l].label}
                </option>
              ))}
            </select>
          </Field>
          <Button type="button" onClick={add} disabled={!form.principalValue}>
            Grant
          </Button>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export function HistorySection({ data, onRestored }: { data: StudioData; onRestored: () => void }) {
  const [compareId, setCompareId] = useState<string | null>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const history = data.config?.history ?? [];
  const canEdit = data.access.includes("manage");
  const [changes, setChanges] = useState<ReturnType<typeof diffConfigs> | null>(null);
  const published = data.config?.published ?? null;
  useEffect(() => {
    if (!compareId || !published) return;
    let cancelled = false;
    aiFetch<{ versions: Array<{ id: string; config: unknown }> }>(
      `/api/ai/agents/${data.agent.slug}/versions?id=${compareId}`,
    )
      .then((res) => {
        if (!cancelled) {
          setChanges(
            diffConfigs(agentConfigSchema.parse(res.versions[0]?.config ?? {}), published.parsed),
          );
        }
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [compareId, published, data.agent.slug]);

  async function restore() {
    if (!restoreId) return;
    setBusy(true);
    try {
      await aiFetch(`/api/ai/agents/${data.agent.slug}/restore`, {
        method: "POST",
        body: JSON.stringify({ versionId: restoreId }),
      });
      setRestoreId(null);
      onRestored();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card>
        <CardTitle>Configuration versions</CardTitle>
        <CardDescription>
          Every published change is kept. Compare any version with what&apos;s live, or restore it.
        </CardDescription>
        <ul className="mt-4 divide-y divide-[var(--acton-border)]">
          {history.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <div>
                <p className="font-semibold text-[var(--acton-navy)]">
                  Version {v.version_number}{" "}
                  <Pill
                    className={
                      v.status === "published"
                        ? "bg-emerald-100 text-emerald-900"
                        : v.status === "draft"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-slate-100 text-slate-600"
                    }
                  >
                    {v.status === "published"
                      ? "Live"
                      : v.status === "draft"
                        ? "Draft"
                        : "Previous"}
                  </Pill>
                </p>
                <p className="text-[var(--acton-muted)]">
                  {v.change_summary ?? "No summary"} ·{" "}
                  {formatDateTime(v.published_at ?? v.created_at)}
                </p>
              </div>
              {v.status === "superseded" ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setCompareId(v.id)}
                  >
                    Compare with live
                  </Button>
                  {canEdit ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setRestoreId(v.id)}
                    >
                      <History className="h-4 w-4" /> Restore
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      {data.audit.length ? (
        <Card>
          <CardTitle>Change log</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {data.audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2">
                <span className="text-[var(--acton-navy)]">{entry.summary}</span>
                <span className="text-[var(--acton-muted)]">
                  {entry.actor_label ?? "System"} · {formatDateTime(entry.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Dialog
        open={Boolean(compareId)}
        onClose={() => {
          setCompareId(null);
          setChanges(null);
        }}
        size="lg"
      >
        <DialogHeader>
          <DialogTitle>Changes from that version to the live version</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <ChangeList changes={changes} />
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setCompareId(null);
              setChanges(null);
            }}
          >
            Close
          </Button>
        </DialogFooter>
      </Dialog>
      <ConfirmDialog
        open={Boolean(restoreId)}
        onClose={() => setRestoreId(null)}
        onConfirm={restore}
        busy={busy}
        title="Restore this version?"
        description="It becomes the live configuration right away as a new version. Any unpublished draft is discarded. You can always restore the current version later."
        confirmLabel="Restore"
      />
    </div>
  );
}

export function ChangeList({ changes }: { changes: ReturnType<typeof diffConfigs> | null }) {
  if (!changes) return <p className="text-sm text-[var(--acton-muted)]">Loading…</p>;
  if (changes.length === 0)
    return <p className="text-sm text-[var(--acton-muted)]">No differences.</p>;
  return (
    <ul className="space-y-4">
      {changes.map((c) => (
        <li key={c.path}>
          <p className="text-sm font-semibold text-[var(--acton-navy)] capitalize">{c.label}</p>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <pre className="rounded-md bg-red-50 p-2 text-xs whitespace-pre-wrap text-red-900">
              {c.before || "(empty)"}
            </pre>
            <pre className="rounded-md bg-emerald-50 p-2 text-xs whitespace-pre-wrap text-emerald-900">
              {c.after || "(empty)"}
            </pre>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Test (sandbox) + direct chat
// ---------------------------------------------------------------------------

export function ResultView({ result }: { result: SpecialistResult }) {
  return (
    <div className="space-y-3 text-sm text-[var(--acton-navy)]">
      <p className="whitespace-pre-wrap">{result.summary}</p>
      {result.findings.length ? (
        <ul className="list-disc space-y-1 pl-5">
          {result.findings.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : null}
      {result.nextSteps.length ? (
        <div>
          <p className="font-semibold">Next steps</p>
          <ol className="list-decimal space-y-1 pl-5">
            {result.nextSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {result.missingInformation.length ? (
        <Notice tone="warning">
          <p className="font-semibold">Missing information</p>
          <ul className="list-disc pl-5">
            {result.missingInformation.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {result.sources.length ? (
        <div>
          <p className="font-semibold">Sources</p>
          <ul className="space-y-1">
            {result.sources.map((s) => (
              <li key={`${s.documentId}-${s.title}`}>
                {s.documentId ? (
                  <Link className="underline" href={`/ai/knowledge?document=${s.documentId}`}>
                    {s.title}
                  </Link>
                ) : (
                  s.title
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.proposedActions.some((a) => a.approvalId) ? (
        <Notice>
          Drafts were saved for review in{" "}
          <Link className="underline" href="/ai/approvals">
            Approvals
          </Link>
          . Nothing was sent.
        </Notice>
      ) : null}
      {result.requiresHumanReview ? (
        <Notice tone="warning">Needs review by a qualified person.</Notice>
      ) : null}
    </div>
  );
}

export function TestSection({ data, hasDraft }: { data: StudioData; hasDraft: boolean }) {
  const [question, setQuestion] = useState("");
  const [useDraft, setUseDraft] = useState(hasDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<{
    taskId: string;
    usedDraft: boolean;
    ok: boolean;
    result: SpecialistResult | null;
    error: { code: string; message: string } | null;
    usage: { inputTokens: number; outputTokens: number; costUsd: number };
  } | null>(null);

  if (data.agent.kind === "orchestrator") {
    return (
      <Notice>
        Use the Delegation tab to test how Baxter routes requests. Chat with Baxter from the Baxter
        chat panel.
      </Notice>
    );
  }
  if (!data.access.includes("manage"))
    return <Notice>Only people who manage this agent can run tests.</Notice>;

  async function go() {
    setBusy(true);
    setError(null);
    setRun(null);
    try {
      setRun(
        await aiFetch(`/api/ai/agents/${data.agent.slug}/sandbox`, {
          method: "POST",
          body: JSON.stringify({ question, useDraft }),
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <CardTitle>Test {data.agent.name}</CardTitle>
        <CardDescription>
          Runs the agent for real — same model, tools, and documents — but in test mode: nothing is
          saved to Approvals and no drafts are created. Uses a small amount of AI credit.
        </CardDescription>
      </div>
      <Field label="Test request">
        <textarea
          className={textareaClass}
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What documents must a new hire complete?"
        />
      </Field>
      {hasDraft ? (
        <label className="flex items-center gap-2 text-sm text-[var(--acton-navy)]">
          <input
            type="checkbox"
            checked={useDraft}
            onChange={(e) => setUseDraft(e.target.checked)}
          />
          Test the saved draft (not yet live)
        </label>
      ) : null}
      <Button type="button" onClick={go} disabled={busy || !question.trim()}>
        {busy ? "Running…" : "Run test"}
      </Button>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {run ? (
        <div className="space-y-3 rounded-md border border-[var(--acton-border)] p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--acton-muted)]">
            <TaskStatusPill status={run.ok ? "completed" : "failed"} />
            <span>{run.usedDraft ? "Draft configuration" : "Live configuration"}</span>
            <span>
              · {run.usage.inputTokens + run.usage.outputTokens} tokens ·{" "}
              {formatUsd(run.usage.costUsd)}
            </span>
            <Link href={`/ai/tasks/${run.taskId}`} className="underline">
              Execution log
            </Link>
          </div>
          {run.ok && run.result ? (
            <ResultView result={run.result} />
          ) : (
            <Notice tone="error">{run.error?.message}</Notice>
          )}
        </div>
      ) : null}
    </Card>
  );
}

type ChatTurn = {
  id: string;
  role: "user" | "agent";
  text?: string;
  result?: SpecialistResult;
  taskId?: string;
  error?: string;
};

export function DirectChatSection({ data }: { data: StudioData }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  if (data.agent.kind === "orchestrator")
    return <Notice>Chat with Baxter using the Baxter chat panel on the dashboard.</Notice>;
  if (!data.access.includes("direct_chat")) {
    return (
      <Notice>
        You don&apos;t have direct chat access to {data.agent.name}. You can still ask Baxter if you
        have access through Baxter.
      </Notice>
    );
  }
  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    const requestId = crypto.randomUUID();
    setTurns((t) => [...t, { id: requestId, role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await aiFetch<{
        taskId: string;
        ok: boolean;
        result: SpecialistResult | null;
        error: { message: string } | null;
      }>(`/api/ai/agents/${data.agent.slug}/chat`, {
        method: "POST",
        body: JSON.stringify({ question: q, requestId }),
      });
      setTurns((t) => [
        ...t,
        {
          id: `${requestId}-r`,
          role: "agent",
          result: res.result ?? undefined,
          taskId: res.taskId,
          error: res.ok ? undefined : res.error?.message,
        },
      ]);
    } catch (e) {
      setTurns((t) => [...t, { id: `${requestId}-e`, role: "agent", error: errorMessage(e) }]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-[var(--acton-muted)]" aria-hidden />
        <CardTitle>Chat with {data.agent.name}</CardTitle>
      </div>
      <div className="max-h-[480px] space-y-3 overflow-y-auto" aria-live="polite">
        {turns.length === 0 ? (
          <p className="text-sm text-[var(--acton-muted)]">
            Ask {data.agent.name} a question. Each message is recorded as a task you can review.
          </p>
        ) : null}
        {turns.map((t) =>
          t.role === "user" ? (
            <div
              key={t.id}
              className="ml-auto max-w-[85%] rounded-2xl bg-[var(--acton-navy)] px-3 py-2 text-sm text-white"
            >
              {t.text}
            </div>
          ) : (
            <div
              key={t.id}
              className="max-w-[92%] rounded-2xl border border-[var(--acton-border)] bg-white px-3 py-2"
            >
              {t.result ? (
                <ResultView result={t.result} />
              ) : (
                <p className="text-sm text-red-800">{t.error}</p>
              )}
              {t.taskId ? (
                <Link
                  href={`/ai/tasks/${t.taskId}`}
                  className="mt-2 block text-xs text-[var(--acton-muted)] underline"
                >
                  Task record
                </Link>
              ) : null}
            </div>
          ),
        )}
        {busy ? (
          <p className="text-sm text-[var(--acton-muted)]">{data.agent.name} is working…</p>
        ) : null}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Message ${data.agent.name}`}
          aria-label={`Message ${data.agent.name}`}
        />
        <Button type="submit" disabled={busy || !input.trim()} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </Card>
  );
}
