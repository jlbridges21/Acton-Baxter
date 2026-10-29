"use client";

/**
 * Overview (leadership dashboard), Setup (leadership decisions checklist, legal entities, people,
 * autonomy), Integrations (honest connection status + non-secret settings), and Activity (audit).
 */

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Circle, CircleDashed } from "lucide-react";
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
import { BambooHRCard } from "./bamboohr";
import { Field, Notice, formatDateTime, selectClass, textareaClass } from "@/components/ai/ui";
import { cn } from "@/lib/utils";
import {
  PersonSelect,
  SectionHeader,
  Stat,
  StatusPill,
  Table,
  TonePill,
  nameOf,
  td,
  useFullOps,
  type FullOpsState,
} from "./shared";

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
export function OverviewTab({ go }: { go: (tab: string) => void }) {
  const { full, state } = useFullOps();
  if (!state) return null;
  const open = state.myWorkflows.filter((w) =>
    ["active", "paused", "pending_approval"].includes(w.status),
  );
  if (!full) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="My tasks" value={state.inbox.length} onClick={() => go("inbox")} />
        <Stat label="My workflows" value={open.length} onClick={() => go("workflows")} />
      </div>
    );
  }
  const decided = full.decisions.filter((d) => d.status !== "open").length;
  const pending = full.actions.filter((a) => a.status === "pending_approval").length;
  const attention = full.actions.filter((a) =>
    ["failed", "manual_required"].includes(a.status),
  ).length;
  const in90 = dateInDays(90);
  const contractsDue = full.contracts.filter(
    (c) =>
      ["signed", "active"].includes(c.status) &&
      (c.renewal_date ?? c.expiration_date ?? "9999") <= in90,
  ).length;
  const policiesDue = full.insurance.filter(
    (p) =>
      ["active", "renewing"].includes(p.status) &&
      (p.renewal_date ?? p.expiration_date ?? "9999") <= in90,
  ).length;
  const integrationsReady = full.integrations.filter((i) => i.state === "connected").length;
  return (
    <div className="space-y-6">
      {!full.access.leadershipConfirmed ? (
        <Notice tone="warning">
          <strong>Setup isn&apos;t finished.</strong> Until the CEO and COO accounts are confirmed,
          Sam can draft work but nothing can be approved or sent.{" "}
          <button type="button" className="font-semibold underline" onClick={() => go("setup")}>
            Open Setup
          </button>
        </Notice>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Waiting for approval"
          value={pending}
          tone={pending ? "amber" : undefined}
          onClick={() => go("approvals")}
        />
        <Stat
          label="Need attention"
          value={attention}
          tone={attention ? "red" : undefined}
          onClick={() => go("approvals")}
        />
        <Stat label="Open workflows" value={open.length} onClick={() => go("workflows")} />
        <Stat
          label="Overdue steps"
          value={open.reduce((n, w) => n + w.overdue, 0)}
          tone={open.some((w) => w.overdue) ? "red" : undefined}
          onClick={() => go("workflows")}
        />
        <Stat
          label="Contracts due ≤ 90 days"
          value={contractsDue}
          tone={contractsDue ? "amber" : undefined}
          onClick={() => go("contracts")}
        />
        <Stat
          label="Policies renewing ≤ 90 days"
          value={policiesDue}
          tone={policiesDue ? "amber" : undefined}
          onClick={() => go("insurance")}
        />
        <Stat
          label="Leadership decisions"
          value={`${decided}/${full.decisions.length}`}
          tone={decided < full.decisions.length ? "amber" : "green"}
          onClick={() => go("setup")}
        />
        <Stat
          label="Integrations connected"
          value={`${integrationsReady}/${full.integrations.length}`}
          onClick={() => go("integrations")}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Go-live readiness</CardTitle>
          <CardDescription>
            What still blocks each part of Sam&apos;s scope. Nothing here is marked complete until
            the inputs exist.
          </CardDescription>
          <ul className="mt-3 space-y-2 text-sm">
            {readiness(full).map((r) => (
              <li key={r.label} className="flex items-start gap-2">
                {r.state === "ready" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                ) : r.state === "partial" ? (
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
                )}
                <span>
                  <strong className="text-[var(--acton-navy)]">{r.label}</strong> —{" "}
                  <span className="text-[var(--acton-muted)]">{r.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Recent activity</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {full.audit.slice(0, 10).map((a) => (
              <li key={a.id} className="flex justify-between gap-2">
                <span className="min-w-0 text-[var(--acton-navy)]">{a.summary}</span>
                <span className="shrink-0 text-xs text-[var(--acton-muted)]">
                  {formatDateTime(a.created_at)}
                </span>
              </li>
            ))}
            {full.audit.length === 0 ? (
              <li className="text-[var(--acton-muted)]">No activity yet.</li>
            ) : null}
          </ul>
          <button
            type="button"
            className="mt-3 text-sm font-semibold underline"
            onClick={() => go("activity")}
          >
            Full activity log
          </button>
        </Card>
      </div>
    </div>
  );
}

function dateInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function readiness(
  full: FullOpsState,
): Array<{ label: string; state: "ready" | "partial" | "blocked"; detail: string }> {
  const d = (k: string) => full.decisions.find((x) => x.key === k)?.status === "confirmed";
  const integ = (k: string) => full.integrations.find((i) => i.key === k);
  const published = (cat: string) =>
    full.templates.some((t) => t.category === cat && t.status === "published");
  const official = (cat: string) =>
    full.templates.some((t) => t.category === cat && t.status === "published" && t.official);
  return [
    {
      label: "Approvals",
      state: d("ceo_account") && d("coo_account") ? "ready" : "blocked",
      detail:
        d("ceo_account") && d("coo_account")
          ? "CEO and COO confirmed."
          : "Confirm the CEO and COO accounts.",
    },
    {
      label: "Onboarding",
      state: official("onboarding")
        ? "ready"
        : published("onboarding") || d("onboarding_checklist")
          ? "partial"
          : "blocked",
      detail: official("onboarding")
        ? "Official workflow published."
        : "Needs the official checklist, then publish the workflow.",
    },
    {
      label: "Offboarding",
      state: official("offboarding")
        ? "ready"
        : published("offboarding") || d("offboarding_checklist")
          ? "partial"
          : "blocked",
      detail: official("offboarding")
        ? "Official workflow published."
        : "Needs the official checklist, then publish the workflow.",
    },
    {
      label: "BambooHR records",
      state:
        integ("bamboohr")?.state === "connected"
          ? "ready"
          : integ("bamboohr")?.state === "missing_credentials"
            ? "blocked"
            : "partial",
      detail:
        integ("bamboohr")?.state === "connected"
          ? "Connected read-only. Updates stay off until approved SOPs enable them."
          : (integ("bamboohr")?.nextStep ?? "Needs the BambooHR OAuth connection."),
    },
    {
      label: "Google Drive filing",
      state:
        integ("google_drive")?.state === "connected" && Object.keys(full.driveFolders).length
          ? "ready"
          : integ("google_drive")?.state === "connected"
            ? "partial"
            : "blocked",
      detail: Object.keys(full.driveFolders).length
        ? "Folders designated."
        : "Designate folders per entity on the Integrations tab.",
    },
    {
      label: "Email & calendar",
      state:
        integ("gmail")?.state === "connected" && integ("google_calendar")?.state === "connected"
          ? "ready"
          : "blocked",
      detail:
        integ("gmail")?.state === "connected"
          ? "Ready."
          : "Google permissions for Gmail sending and Calendar are needed; until then Sam prepares messages for manual sending.",
    },
    {
      label: "DocuSign",
      state: integ("docusign")?.state === "connected" ? "ready" : "blocked",
      detail:
        integ("docusign")?.state === "connected"
          ? "Connected."
          : "Needs DocuSign API credentials and account details (including whether DocuSign MSP applies).",
    },
    {
      label: "BetterTeams",
      state: "partial",
      detail: "No supported API — publishing is a manual, approval-controlled task.",
    },
    {
      label: "Timecards",
      state:
        integ("jobtread")?.state === "connected" && d("timecard_cutoff") ? "partial" : "blocked",
      detail: "JobTread has no time entries yet; confirm the cutoff and reminder policy.",
    },
    {
      label: "Surveys",
      state: d("survey_anonymity") ? "partial" : "blocked",
      detail: "No BambooHR survey API found; confirm anonymity rules. Distribution is manual.",
    },
    {
      label: "Contracts",
      state: full.contractTemplates.some((t) => t.status === "approved") ? "ready" : "blocked",
      detail: full.contractTemplates.some((t) => t.status === "approved")
        ? "Approved templates loaded."
        : "Load the approved contract templates.",
    },
    {
      label: "Insurance",
      state: full.insurance.length ? "ready" : "blocked",
      detail: full.insurance.length
        ? `${full.insurance.length} policies tracked.`
        : "Enter the insurance inventory.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
export function SetupTab() {
  const { full } = useFullOps();
  const [section, setSection] = useState<string>("Organization");
  if (!full) return null;
  const sections = [
    ...new Set(
      full.decisions.map(
        (d) => full.decisionDefs.find((x) => x.key === d.key)?.section ?? d.section,
      ),
    ),
  ];
  const bySection = (s: string) =>
    full.decisions.filter(
      (d) => (full.decisionDefs.find((x) => x.key === d.key)?.section ?? d.section) === s,
    );
  const done = full.decisions.filter((d) => d.status !== "open").length;
  return (
    <div className="space-y-8">
      <section>
        <SectionHeader
          title="Leadership decisions"
          description="Sam won't invent policy. Each item below comes from the leadership brief's open questions; confirm it here and the related features unlock. Leadership-account, access, and approval decisions can only be changed by the CEO or COO (or an app administrator before they're confirmed)."
        />
        <div className="mb-4">
          <div className="mb-1 flex justify-between text-xs text-[var(--acton-muted)]">
            <span>Setup progress</span>
            <span>
              {done} of {full.decisions.length} decided
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--acton-gray-100)]">
            <div
              className="h-2 rounded-full bg-emerald-600"
              style={{ width: `${Math.round((done / Math.max(1, full.decisions.length)) * 100)}%` }}
            />
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <nav aria-label="Decision sections" className="flex gap-1 overflow-x-auto lg:flex-col">
            {sections.map((s) => {
              const items = bySection(s);
              const open = items.filter((d) => d.status === "open").length;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSection(s)}
                  aria-current={section === s ? "true" : undefined}
                  className={cn(
                    "flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm",
                    section === s
                      ? "bg-[var(--acton-navy)] text-white"
                      : "bg-white text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
                  )}
                >
                  {s}
                  {open ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-xs",
                        section === s ? "bg-white/20" : "bg-amber-100 text-amber-900",
                      )}
                    >
                      {open}
                    </span>
                  ) : (
                    <CheckCircle2 className="h-4 w-4" aria-label="Done" />
                  )}
                </button>
              );
            })}
          </nav>
          <div className="space-y-3">
            {bySection(section).map((d) => (
              <DecisionCard key={d.key} decision={d} />
            ))}
          </div>
        </div>
      </section>
      <EntitiesCard />
      <PeopleCard />
      <AutonomyCard />
    </div>
  );
}

function DecisionCard({ decision }: { decision: FullOpsState["decisions"][number] }) {
  const { full, run, busy } = useFullOps();
  const [value, setValue] = useState<unknown>(decision.value);
  const [note, setNote] = useState(decision.note ?? "");
  const [open, setOpen] = useState(false);
  const id = `dec-${decision.key}`;
  const people = full?.profiles ?? [];
  const display =
    decision.input === "person"
      ? nameOf(people, decision.value as string)
      : decision.input === "people"
        ? ((decision.value as string[] | null) ?? []).map((v) => nameOf(people, v)).join(", ")
        : typeof decision.value === "string"
          ? decision.value
          : typeof decision.value === "number"
            ? String(decision.value)
            : null;
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>{decision.title}</CardTitle>
          <CardDescription>{decision.description}</CardDescription>
        </div>
        <StatusPill status={decision.status} />
      </div>
      {decision.status === "confirmed" && display ? (
        <p className="text-sm whitespace-pre-wrap text-[var(--acton-navy)]">{display}</p>
      ) : null}
      {decision.note ? (
        <p className="text-xs text-[var(--acton-muted)]">Note: {decision.note}</p>
      ) : null}
      {decision.confirmed_at ? (
        <p className="text-xs text-[var(--acton-muted)]">
          Confirmed {formatDateTime(decision.confirmed_at)}
        </p>
      ) : null}
      {!open ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {decision.status === "open" ? "Record decision" : "Change"}
        </Button>
      ) : (
        <div className="space-y-3 rounded-md bg-[var(--acton-gray-50)] p-3">
          {decision.input === "person" ? (
            <Field label="Person" htmlFor={id}>
              <PersonSelect
                id={id}
                profiles={people}
                value={(value as string) ?? null}
                onChange={setValue}
              />
            </Field>
          ) : decision.input === "people" ? (
            <Field label="People" htmlFor={id}>
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {people.map((p) => {
                  const list = (value as string[] | null) ?? [];
                  return (
                    <label
                      key={p.id}
                      className="flex items-center gap-1.5 rounded border border-[var(--acton-border)] bg-white px-2 py-1 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={list.includes(p.id)}
                        onChange={(e) =>
                          setValue(
                            e.target.checked ? [...list, p.id] : list.filter((x) => x !== p.id),
                          )
                        }
                      />
                      {p.full_name}
                    </label>
                  );
                })}
              </div>
            </Field>
          ) : decision.input === "choice" ? (
            <Field label="Choice" htmlFor={id}>
              <select
                id={id}
                className={selectClass}
                value={(value as string) ?? ""}
                onChange={(e) => setValue(e.target.value)}
              >
                <option value="">Choose…</option>
                {decision.options?.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </Field>
          ) : decision.input === "date" ? (
            <Field label="Date" htmlFor={id}>
              <Input
                id={id}
                type="date"
                value={(value as string) ?? ""}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
          ) : decision.input === "number" ? (
            <Field label="Number" htmlFor={id}>
              <Input
                id={id}
                type="number"
                min={0}
                step={1}
                value={typeof value === "number" ? value : ""}
                onChange={(e) =>
                  setValue(e.target.value === "" ? null : Math.floor(Number(e.target.value)))
                }
              />
            </Field>
          ) : decision.input === "longtext" || decision.input === "text" ? (
            <Field label="Decision" htmlFor={id}>
              <textarea
                id={id}
                rows={decision.input === "longtext" ? 4 : 2}
                className={textareaClass}
                value={(value as string) ?? ""}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
          ) : null}
          <Field label="Note (optional)" htmlFor={`${id}-note`}>
            <Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={async () =>
                (await run(
                  {
                    op: "decision",
                    key: decision.key,
                    status: "confirmed",
                    value,
                    note: note || null,
                  },
                  "Decision recorded.",
                )) !== null && setOpen(false)
              }
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={async () =>
                (await run(
                  {
                    op: "decision",
                    key: decision.key,
                    status: "not_applicable",
                    value: null,
                    note: note || null,
                  },
                  "Marked not applicable.",
                )) !== null && setOpen(false)
              }
            >
              Not applicable
            </Button>
            {decision.status !== "open" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={async () =>
                  (await run(
                    { op: "decision", key: decision.key, status: "open", value: null, note: null },
                    "Reopened.",
                  )) !== null && setOpen(false)
                }
              >
                Reopen
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function EntitiesCard() {
  const { full, run, busy } = useFullOps();
  if (!full) return null;
  return (
    <section>
      <SectionHeader
        title="Legal entities"
        description="Every workflow, document, contract, and policy belongs to one entity. The brief names Acton Construction and its subsidiary Acton ADU — confirm the exact legal names."
      />
      <div className="grid gap-3 md:grid-cols-2">
        {full.entities.map((e) => (
          <Card key={e.id} className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>{e.name}</CardTitle>
              <CardDescription>{e.confirmed ? "Confirmed" : "Not yet confirmed"}</CardDescription>
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !full.access.canManageSensitive}
                onClick={() => {
                  const name = window.prompt("Exact legal name", e.name);
                  if (name) void run({ op: "entity", id: e.id, name }, "Renamed.");
                }}
              >
                Rename
              </Button>
              {!e.confirmed ? (
                <Button
                  size="sm"
                  disabled={busy || !full.access.canManageSensitive}
                  onClick={() =>
                    run({ op: "entity", id: e.id, confirmed: true }, "Entity confirmed.")
                  }
                >
                  Confirm
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function PeopleCard() {
  const { full, run, busy } = useFullOps();
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  if (!full) return null;
  return (
    <section>
      <SectionHeader
        title="People"
        description="The employees and candidates Sam's workflows are about. BambooHR remains the system of record; link each person to their BambooHR id and Baxter account. Mark synthetic people as test records."
        actions={
          full.access.canConfigure ? (
            <Button
              size="sm"
              onClick={() => setEdit({ status: "pre_hire", entity_id: full.entities[0]?.id ?? "" })}
            >
              Add person
            </Button>
          ) : null
        }
      />
      <Table
        head={["Name", "Position", "Entity", "Status", "Start / end", "BambooHR", ""]}
        empty="No people yet."
      >
        {full.people.map((p) => (
          <tr key={p.id}>
            <td className={td}>
              {p.full_name} {p.test_record ? <TonePill tone="violet">Test</TonePill> : null}
            </td>
            <td className={td}>{p.position ?? "—"}</td>
            <td className={td}>{full.entities.find((e) => e.id === p.entity_id)?.name ?? "—"}</td>
            <td className={td}>{p.status.replace("_", " ")}</td>
            <td className={td}>
              {p.start_date ?? "—"} / {p.end_date ?? "—"}
            </td>
            <td className={td}>{p.bamboohr_id ?? "—"}</td>
            <td className={td}>
              {full.access.canConfigure ? (
                <Button size="sm" variant="secondary" onClick={() => setEdit(p)}>
                  Edit
                </Button>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
      {edit ? (
        <PersonDialog
          initial={edit}
          onClose={() => setEdit(null)}
          busy={busy}
          run={run}
          profiles={full.profiles}
          entities={full.entities}
        />
      ) : null}
    </section>
  );
}

function PersonDialog({
  initial,
  onClose,
  busy,
  run,
  profiles,
  entities,
}: {
  initial: Record<string, unknown>;
  onClose: () => void;
  busy: boolean;
  run: (c: Record<string, unknown>, m?: string) => Promise<unknown>;
  profiles: FullOpsState["profiles"];
  entities: FullOpsState["entities"];
}) {
  const [v, setV] = useState<Record<string, unknown>>(initial);
  const set = (k: string, x: unknown) => setV((p) => ({ ...p, [k]: x }));
  const text = (k: string, label: string, type = "text") => (
    <Field label={label} htmlFor={`p-${k}`}>
      <Input
        id={`p-${k}`}
        type={type}
        value={String(v[k] ?? "")}
        onChange={(e) => set(k, e.target.value)}
      />
    </Field>
  );
  return (
    <Dialog open onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>{initial.id ? "Edit person" : "Add person"}</DialogTitle>
      </DialogHeader>
      <DialogBody className="max-h-[68vh] overflow-y-auto">
        <div className="grid gap-4 sm:grid-cols-2">
          {text("full_name", "Full name")}
          {text("position", "Position")}
          {text("department", "Department")}
          <Field label="Legal entity" htmlFor="p-entity">
            <select
              id="p-entity"
              className={selectClass}
              value={String(v.entity_id ?? "")}
              onChange={(e) => set("entity_id", e.target.value)}
            >
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status" htmlFor="p-status">
            <select
              id="p-status"
              className={selectClass}
              value={String(v.status ?? "pre_hire")}
              onChange={(e) => set("status", e.target.value)}
            >
              {["candidate", "pre_hire", "active", "offboarding", "former"].map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </Field>
          {text("start_date", "Start date", "date")}
          {text("end_date", "Last day", "date")}
          {text("work_email", "Work email", "email")}
          {text("personal_email", "Personal email", "email")}
          {text("bamboohr_id", "BambooHR employee id")}
          <Field label="Baxter account" htmlFor="p-profile">
            <PersonSelect
              id="p-profile"
              profiles={profiles}
              value={(v.profile_id as string) ?? null}
              onChange={(x) => set("profile_id", x)}
              placeholder="Not linked"
            />
          </Field>
          <Field label="Manager" htmlFor="p-mgr">
            <PersonSelect
              id="p-mgr"
              profiles={profiles}
              value={(v.manager_profile_id as string) ?? null}
              onChange={(x) => set("manager_profile_id", x)}
              placeholder="None"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(v.test_record)}
              onChange={(e) => set("test_record", e.target.checked)}
            />
            Synthetic test record (for test runs only)
          </label>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={async () =>
            (await run({ op: "person_save", id: initial.id, values: v }, "Saved.")) !== null &&
            onClose()
          }
        >
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function AutonomyCard() {
  const { full, run, busy } = useFullOps();
  const [actionType, setActionType] = useState("notify_slack");
  const [workflowKey, setWorkflowKey] = useState("");
  const [note, setNote] = useState("");
  if (!full) return null;
  const active = full.autonomy.filter((a) => a.enabled && !a.revoked_at);
  return (
    <section>
      <SectionHeader
        title="Autonomy"
        description="Off by default: every action needs CEO/COO approval. Leadership can allow specific low-risk action types to run without per-action approval, scoped to a workflow, and revoke it at any time. BambooHR changes and signature requests always need approval."
      />
      {active.length === 0 ? (
        <Notice tone="info">No autonomy is enabled. Sam asks before every action.</Notice>
      ) : null}
      <ul className="mt-3 space-y-2">
        {full.autonomy.map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-sm"
          >
            <span>
              <strong>
                {full.actionLabels[a.action_type as keyof typeof full.actionLabels] ??
                  a.action_type}
              </strong>
              {a.workflow_key ? ` in ${a.workflow_key}` : " in all workflows"} — {a.note} · enabled
              by {nameOf(full.profiles, a.enabled_by)} {formatDateTime(a.enabled_at)}
            </span>
            {a.revoked_at ? (
              <TonePill tone="gray">Revoked {formatDateTime(a.revoked_at)}</TonePill>
            ) : full.access.isLeadership ? (
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => run({ op: "autonomy_revoke", id: a.id }, "Revoked.")}
              >
                Revoke
              </Button>
            ) : (
              <TonePill tone="green">Active</TonePill>
            )}
          </li>
        ))}
      </ul>
      {full.access.isLeadership ? (
        <Card className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field label="Action" htmlFor="au-type">
            <select
              id="au-type"
              className={selectClass}
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
            >
              {["notify_slack", "send_email", "drive_file", "calendar_event"].map((t) => (
                <option key={t} value={t}>
                  {full.actionLabels[t as keyof typeof full.actionLabels]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Workflow" htmlFor="au-wf">
            <select
              id="au-wf"
              className={selectClass}
              value={workflowKey}
              onChange={(e) => setWorkflowKey(e.target.value)}
            >
              <option value="">All workflows</option>
              {full.templates.map((t) => (
                <option key={t.id} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Why this is safe" htmlFor="au-note">
            <Input id="au-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button
              disabled={busy || note.trim().length < 5}
              onClick={() =>
                run(
                  {
                    op: "autonomy_enable",
                    actionType,
                    workflowKey: workflowKey || null,
                    entityId: null,
                    note,
                  },
                  "Autonomy enabled.",
                )
              }
            >
              Enable
            </Button>
          </div>
        </Card>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------
export function IntegrationsTab() {
  const { full, run, busy } = useFullOps();
  const [folders, setFolders] = useState<Record<string, string> | null>(null);
  if (!full) return null;
  const folderValues = folders ?? full.driveFolders;
  const folderKinds = [
    ["employee_documents", "Employee documents"],
    ["contracts", "Contracts"],
    ["insurance", "Insurance"],
  ];
  return (
    <div className="space-y-8">
      <section>
        <SectionHeader
          title="Connections"
          description="Honest status for every system in the brief. Credentials live only in server environment variables — never in this page. When a system isn't available, Sam creates a manual task instead."
        />
        <div className="grid gap-3 md:grid-cols-2">
          {full.integrations.map((i) => (
            <Card key={i.key} className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <CardTitle>{i.label}</CardTitle>
                <StatusPill status={i.state} />
              </div>
              <p className="text-sm text-[var(--acton-navy)]">{i.detail}</p>
              {i.nextStep ? (
                <p className="text-xs text-[var(--acton-muted)]">Next: {i.nextStep}</p>
              ) : null}
              {i.capabilities.length ? (
                <p className="text-xs text-[var(--acton-muted)]">
                  Can: {i.capabilities.join(" · ")}
                </p>
              ) : null}
              {i.lastTestedAt ? (
                <p className="text-xs text-[var(--acton-muted)]">
                  Last tested {formatDateTime(i.lastTestedAt)}
                </p>
              ) : null}
              {full.access.canConfigure && i.state !== "unsupported" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run({ op: "integration_test", key: i.key }, "Test finished — see the status.")
                  }
                >
                  Test connection (read-only)
                </Button>
              ) : null}
            </Card>
          ))}
        </div>
      </section>
      <section>
        <SectionHeader
          title="Google Drive destinations"
          description="Sam files documents only into these designated folders and confirms the location after upload. Paste the folder id from each folder's link (the part after /folders/)."
        />
        <Card className="space-y-3">
          {full.entities.map((e) => (
            <div key={e.id} className="grid gap-2 sm:grid-cols-3">
              {folderKinds.map(([k, label]) => (
                <Field key={k} label={`${e.name} — ${label}`} htmlFor={`df-${e.key}-${k}`}>
                  <Input
                    id={`df-${e.key}-${k}`}
                    value={folderValues[`${e.key}:${k}`] ?? ""}
                    disabled={!full.access.canConfigure}
                    onChange={(ev) =>
                      setFolders({ ...folderValues, [`${e.key}:${k}`]: ev.target.value.trim() })
                    }
                  />
                </Field>
              ))}
            </div>
          ))}
          {full.access.canConfigure ? (
            <Button
              size="sm"
              disabled={busy || !folders}
              onClick={async () =>
                (await run(
                  {
                    op: "drive_folders",
                    folders: Object.fromEntries(Object.entries(folderValues).filter(([, v]) => v)),
                  },
                  "Folders saved.",
                )) !== null && setFolders(null)
              }
            >
              Save folders
            </Button>
          ) : null}
        </Card>
      </section>
      <BambooHRCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------
export function ActivityTab() {
  const { full } = useFullOps();
  const [q, setQ] = useState("");
  if (!full) return null;
  const rows = full.audit.filter(
    (a) =>
      !q || `${a.summary} ${a.actor_label} ${a.action}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div>
      <SectionHeader
        title="Activity log"
        description="Who did what and when — proposals, approvals, executions, completions, overrides, and configuration changes. Document contents and secrets are never logged."
        actions={
          <Input
            aria-label="Filter"
            className="h-9 w-56"
            placeholder="Filter"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
      />
      <Table head={["When", "Who", "What"]} empty="No activity yet.">
        {rows.map((a) => (
          <tr key={a.id}>
            <td className={cn(td, "whitespace-nowrap")}>{formatDateTime(a.created_at)}</td>
            <td className={td}>{a.actor_label ?? "System"}</td>
            <td className={td}>
              {a.summary}
              <span className="block text-xs text-[var(--acton-muted)]">{a.action}</span>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sam configuration (summary; edited in AI Studio)
// ---------------------------------------------------------------------------
export function SamConfigTab() {
  const { full } = useFullOps();
  if (!full) return null;
  const sam = full.sam;
  if (!sam) return <Notice tone="warning">Sam isn&apos;t registered yet.</Notice>;
  const toolLabels: Record<string, string> = {
    knowledge_search: "Search approved documents",
    onboarding_templates: "Read onboarding templates (Phase 1)",
    onboarding_progress: "Read onboarding progress (Phase 1)",
    draft_communication: "Draft communications for review",
    flag_for_review: "Flag for human review",
    ops_status: "Operations status",
    ops_workflow_detail: "Workflow step detail",
    ops_request_workflow: "Request a workflow start (CEO/COO approval)",
    ops_contracts: "Contracts & insurance registers",
    ops_propose_message: "Queue a message (CEO/COO approval)",
  };
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Sam's configuration"
        description="Sam's role, tools, knowledge, and who may use Sam. Instructions, delegation, tools, and access are edited (and versioned) in AI Studio; this page summarizes what is live."
        actions={
          <Link
            href="/ai/agents/sam"
            className="inline-flex h-8 items-center rounded-md bg-[var(--acton-navy)] px-3 text-xs font-semibold text-white"
          >
            Open Sam in AI Studio
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>{sam.title}</CardTitle>
          <CardDescription>{sam.description}</CardDescription>
          <p className="mt-2 text-xs text-[var(--acton-muted)]">
            Published configuration version {sam.version ?? "—"}
          </p>
        </Card>
        <Card>
          <CardTitle>Tools enabled</CardTitle>
          <ul className="mt-2 space-y-1 text-sm">
            {sam.toolsEnabled.map((t) => (
              <li key={t}>{toolLabels[t] ?? t}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--acton-muted)]">
            Every tool with an effect creates a CEO/COO approval request; none sends, writes, or
            signs on its own.
          </p>
        </Card>
        <Card>
          <CardTitle>Who can use Sam</CardTitle>
          <ul className="mt-2 space-y-1 text-sm">
            {sam.accessPolicies.length === 0 ? (
              <li className="text-[var(--acton-muted)]">
                Administrators only (no access policies yet).
              </li>
            ) : null}
            {sam.accessPolicies.map((p, i) => (
              <li key={i}>
                {p.type === "user" ? nameOf(full.profiles, p.value) : `${p.type}: ${p.value}`} —{" "}
                {p.level.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--acton-muted)]">
            Confirming the CEO and COO accounts in Setup grants them direct access to Sam
            automatically.
          </p>
        </Card>
        <Card>
          <CardTitle>Knowledge</CardTitle>
          <p className="mt-2 text-sm">
            {sam.knowledgeDocuments} Knowledge Hub document(s) are available to Sam, including the
            leadership brief summaries (marked as not official SOPs).
          </p>
          <Link href="/ai/knowledge" className="mt-2 inline-block text-sm font-semibold underline">
            Open the Knowledge Hub
          </Link>
        </Card>
      </div>
    </div>
  );
}
