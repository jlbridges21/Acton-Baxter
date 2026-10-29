"use client";

/**
 * Staff lifecycle (Sam Operations → Workflows): the leadership Staff Lifecycle Checklist as
 * cases. Dashboard (employee overview + management view), the Start wizard, and each case's
 * chronological task view. Sam coordinates; people complete, verify, and authorize.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
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
  Field,
  Notice,
  aiFetch,
  errorMessage,
  formatDateTime,
  selectClass,
  textareaClass,
  useLoad,
} from "@/components/ai/ui";
import type { caseDetail } from "@/lib/hr-lifecycle/service";
import type { LifecyclePlan } from "@/lib/hr-lifecycle/plan";
import {
  PHASE_LABELS,
  ROLE_KEYS,
  ROLE_KEY_LABELS,
  SEPARATION_LABELS,
  SEPARATION_TYPES,
  type DisplayStatus,
  type LifecyclePhase,
  type RoleKey,
  type SeparationType,
} from "@/lib/hr-lifecycle/types";
import { cn } from "@/lib/utils";
import { AccessRegisterView, ComplianceView, TemplatesView } from "./lifecycle-admin";
import {
  DisplayStatusPill,
  LifecycleProvider,
  OWNER_LABELS,
  VerificationPill,
  useLifecycle,
  type CaseRow,
} from "./lifecycle-shared";
import {
  ModePill,
  PersonSelect,
  ProgressBar,
  SectionHeader,
  Stat,
  StatusPill,
  Table,
  TonePill,
  formatDate,
  td,
} from "./shared";

type View = "dashboard" | "start" | "access" | "compliance" | "templates";
/** full = HR configuration screens; hr = also needs HR-record access (app admins configure only). */
const VIEWS: Array<{ key: View; label: string; full?: boolean; hr?: boolean }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "start", label: "Start a case", full: true, hr: true },
  { key: "access", label: "Access register", full: true, hr: true },
  { key: "compliance", label: "Compliance & verification", full: true },
  { key: "templates", label: "Templates & settings", full: true },
];

export function LifecycleTab() {
  return (
    <LifecycleProvider>
      <LifecycleInner />
    </LifecycleProvider>
  );
}

function LifecycleInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, full, error, message, clearMessage } = useLifecycle();
  const view = (params.get("view") as View | null) ?? "dashboard";
  const openCase = params.get("case");
  const go = (v: View, extra = "") =>
    router.replace(`/ai/operations?tab=lifecycle&view=${v}${extra}`, { scroll: false });

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(clearMessage, 6000);
    return () => clearTimeout(t);
  }, [message, clearMessage]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!state) return <p className="text-sm text-[var(--acton-muted)]">Loading staff lifecycle…</p>;
  const visible = VIEWS.filter((v) => (!v.full || full) && (!v.hr || state.access.canViewAll));
  const current = visible.find((v) => v.key === view) ?? visible[0]!;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Staff lifecycle"
        description="Pre-boarding, onboarding (Day 1 to 90), and offboarding from the leadership Staff Lifecycle Checklist. Sam tracks every task, owner, and deadline; people complete, verify, and authorize. Nothing here sends messages, changes payroll, or changes accounts."
      />
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Staff lifecycle views">
        {visible.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={current.key === v.key}
            onClick={() => go(v.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              current.key === v.key
                ? "bg-[var(--acton-navy)] text-white"
                : "border border-[var(--acton-border)] bg-white text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
      {message ? (
        <div
          role="status"
          className={cn(
            "flex items-start justify-between gap-2 rounded-md px-3 py-2 text-sm",
            message.tone === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800",
          )}
        >
          <span>{message.text}</span>
          <button type="button" aria-label="Dismiss" onClick={clearMessage}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {current.key === "dashboard" ? (
        <Dashboard onOpen={(id) => go("dashboard", `&case=${id}`)} onStart={() => go("start")} />
      ) : null}
      {current.key === "start" ? (
        <StartWizard onStarted={(id) => go("dashboard", `&case=${id}`)} />
      ) : null}
      {current.key === "access" ? <AccessRegisterView /> : null}
      {current.key === "compliance" ? <ComplianceView /> : null}
      {current.key === "templates" ? <TemplatesView /> : null}
      {openCase ? <CaseDialog id={openCase} onClose={() => go(current.key)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard: employee overview + management view
// ---------------------------------------------------------------------------
function Dashboard({ onOpen, onStart }: { onOpen: (id: string) => void; onStart: () => void }) {
  const { state, full, run, busy } = useLifecycle();
  const [phase, setPhase] = useState<LifecyclePhase | "all">("all");
  if (!state) return null;
  const m = full?.management;
  const cases = state.cases.filter((c) => phase === "all" || c.phase === phase);
  const open = cases.filter((c) => !["completed", "cancelled"].includes(c.status));
  const done = cases.filter((c) => ["completed", "cancelled"].includes(c.status));
  return (
    <div className="space-y-5">
      {m ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Stat label="Active cases" value={m.caseCounts.active} />
            <Stat
              label="Awaiting start approval"
              value={m.caseCounts.awaitingStartApproval}
              tone={m.caseCounts.awaitingStartApproval ? "amber" : undefined}
            />
            <Stat
              label="Overdue tasks"
              value={m.totals.overdue ?? 0}
              tone={m.totals.overdue ? "red" : undefined}
            />
            <Stat
              label="Awaiting approval"
              value={m.totals.awaiting_approval ?? 0}
              tone={m.totals.awaiting_approval ? "amber" : undefined}
            />
            <Stat label="External verification" value={m.totals.external_verification ?? 0} />
            <Stat
              label="Unverified legal items"
              value={m.verification.unverified}
              tone={m.verification.unverified ? "amber" : "green"}
            />
            <Stat
              label="Discrepancies"
              value={m.verification.discrepancy}
              tone={m.verification.discrepancy ? "red" : undefined}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-2">
              <CardTitle>Upcoming legal deadlines (14 days)</CardTitle>
              {m.upcomingLegal.length ? (
                <ul className="space-y-1.5 text-sm">
                  {m.upcomingLegal.map((u) => (
                    <li
                      key={`${u.caseId}-${u.title}`}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <button
                        type="button"
                        className="font-medium text-[var(--acton-navy)] underline-offset-2 hover:underline"
                        onClick={() => onOpen(u.caseId)}
                      >
                        {u.reference}
                      </button>
                      <span>{u.title}</span>
                      <span className="text-[var(--acton-muted)]">{formatDate(u.due)}</span>
                      <VerificationPill state={u.verification} />
                    </li>
                  ))}
                </ul>
              ) : (
                <CardDescription>No legal deadlines in the next two weeks.</CardDescription>
              )}
            </Card>
            <Card className="space-y-2">
              <CardTitle>Overdue by owner</CardTitle>
              {Object.keys(m.overdueByOwner).length ? (
                <ul className="space-y-1 text-sm">
                  {Object.entries(m.overdueByOwner).map(([owner, n]) => (
                    <li key={owner}>
                      {OWNER_LABELS[owner] ?? owner}: <strong>{n}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <CardDescription>Nothing overdue.</CardDescription>
              )}
              <CardDescription>
                Privileged access grants on record: {m.privilegedGrants}. Legal timing stays
                unverified until a named reviewer checks the official source (Compliance &
                verification).
              </CardDescription>
            </Card>
          </div>
        </>
      ) : (
        <Notice tone="info">
          You see only lifecycle cases with tasks assigned to you. HR administrators and leadership
          see every case.
        </Notice>
      )}

      {state.reminders.length ? (
        <Card className="space-y-2">
          <CardTitle>Reminders</CardTitle>
          <CardDescription>
            Raised once per deadline by the scheduled sweep. External notifications are{" "}
            {full?.settings.external.enabled
              ? "on (each Slack reminder still needs approval)"
              : "off"}
            .
          </CardDescription>
          <ul className="space-y-1 text-sm">
            {state.reminders.slice(0, 12).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span>{r.message}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run({ op: "reminder_ack", id: r.id })}
                >
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor="lc-phase" className="text-sm text-[var(--acton-muted)]">
            Phase
          </label>
          <select
            id="lc-phase"
            className={cn(selectClass, "w-48")}
            value={phase}
            onChange={(e) => setPhase(e.target.value as LifecyclePhase | "all")}
          >
            <option value="all">All phases</option>
            {(["preboarding", "onboarding", "offboarding"] as const).map((p) => (
              <option key={p} value={p}>
                {PHASE_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        {state.access.canViewAll ? (
          <Button onClick={onStart}>Start Employee Onboarding</Button>
        ) : null}
      </div>
      <CaseTable cases={open} onOpen={onOpen} empty="No open cases." />
      {done.length ? (
        <details>
          <summary className="cursor-pointer text-sm text-[var(--acton-muted)]">
            Closed cases ({done.length})
          </summary>
          <div className="mt-2">
            <CaseTable cases={done} onOpen={onOpen} empty="" />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function CaseTable({
  cases,
  onOpen,
  empty,
}: {
  cases: CaseRow[];
  onOpen: (id: string) => void;
  empty: string;
}) {
  return (
    <Table
      head={["Employee", "Case", "Status", "Progress", "Attention", "Next task"]}
      empty={empty}
    >
      {cases.map((c) => (
        <tr key={c.id}>
          <td className={td}>
            <button
              type="button"
              onClick={() => onOpen(c.id)}
              className="text-left font-medium underline-offset-2 hover:underline"
            >
              {c.personName ?? "Restricted"}
            </button>
            <div className="text-xs text-[var(--acton-muted)]">
              {c.position ?? ""}
              {c.roles.length ? ` · ${c.roles.map((r) => ROLE_KEY_LABELS[r]).join(", ")}` : ""}
            </div>
            {c.testRecord ? <TonePill tone="violet">Synthetic record</TonePill> : null}
          </td>
          <td className={td}>
            <div className="font-mono text-xs">{c.reference}</div>
            <div className="text-xs text-[var(--acton-muted)]">
              {PHASE_LABELS[c.phase]} · doc {c.documentVersion} · v{c.templateVersion}
            </div>
          </td>
          <td className={td}>
            <StatusPill status={c.status} />
            <ModePill mode={c.mode} />
          </td>
          <td className={cn(td, "w-40")}>
            <ProgressBar percent={c.progress} />
            <span className="text-xs text-[var(--acton-muted)]">{c.progress}%</span>
          </td>
          <td className={td}>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  "overdue",
                  "awaiting_approval",
                  "external_verification",
                  "blocked",
                ] as DisplayStatus[]
              )
                .filter((k) => c.counts[k])
                .map((k) => (
                  <span key={k} className="flex items-center gap-1">
                    <DisplayStatusPill status={k} />
                    <span className="text-xs">{c.counts[k]}</span>
                  </span>
                ))}
              {c.missingInfo.length ? (
                <TonePill tone="amber">{c.missingInfo.length} missing</TonePill>
              ) : null}
            </div>
          </td>
          <td className={td}>
            <div>{c.nextTask ?? "—"}</div>
            <div className="text-xs text-[var(--acton-muted)]">{formatDate(c.nextDue)}</div>
          </td>
        </tr>
      ))}
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Start wizard
// ---------------------------------------------------------------------------
type Preview = {
  plan: LifecyclePlan;
  templateVersion: number | null;
  published: boolean;
  person: { id: string; firstName: string; position: string | null; testRecord: boolean };
};

const tri = (v: boolean | null) => (v === null ? "" : v ? "yes" : "no");
const fromTri = (v: string) => (v === "" ? null : v === "yes");

function StartWizard({ onStarted }: { onStarted: (id: string) => void }) {
  const { full, run, busy } = useLifecycle();
  const [phase, setPhase] = useState<LifecyclePhase>("preboarding");
  const [personId, setPersonId] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleKey[]>([]);
  const [rolesConfirmed, setRolesConfirmed] = useState(false);
  const [exempt, setExempt] = useState<boolean | null>(null);
  const [supervisor, setSupervisor] = useState<boolean | null>(null);
  const [onGroupHealth, setOnGroupHealth] = useState<boolean | null>(null);
  const [separation, setSeparation] = useState<SeparationType | null>(null);
  const [dates, setDates] = useState({
    offer_date: "",
    start_date: "",
    notice_date: "",
    last_day: "",
  });
  const [manager, setManager] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<"test" | "live">("test");
  const [reason, setReason] = useState("");
  if (!full) return null;
  const person = full.people.find((p) => p.id === personId) ?? null;
  const input = {
    phase,
    personId,
    roles,
    rolesConfirmed,
    exempt,
    supervisor,
    onGroupHealth: phase === "offboarding" ? onGroupHealth : null,
    separation: phase === "offboarding" ? separation : null,
    dates:
      phase === "offboarding"
        ? { notice_date: dates.notice_date, last_day: dates.last_day }
        : { offer_date: dates.offer_date, start_date: dates.start_date },
    hiringManagerProfileId: manager,
  };
  const choosePerson = (id: string | null) => {
    setPersonId(id);
    setPreview(null);
    const p = full.people.find((x) => x.id === id);
    if (p) {
      setRoles(p.suggestedRoles.map((s) => s.role));
      setRolesConfirmed(false);
      setManager(p.manager_profile_id);
      setDates((d) => ({ ...d, start_date: p.start_date ?? "", last_day: p.end_date ?? "" }));
      setMode(p.test_record ? "test" : "live");
    }
  };
  const doPreview = async () => {
    const res = await run<Preview>({ op: "preview", case: input });
    if (res) setPreview(res);
  };
  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <CardTitle>1. Employee and phase</CardTitle>
        <CardDescription>
          Choose an existing employee record (Records → Employees links records to BambooHR). Sam
          never creates or changes the BambooHR record.
        </CardDescription>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Phase" htmlFor="wz-phase">
            <select
              id="wz-phase"
              className={selectClass}
              value={phase}
              onChange={(e) => {
                setPhase(e.target.value as LifecyclePhase);
                setPreview(null);
              }}
            >
              {(["preboarding", "onboarding", "offboarding"] as const).map((p) => (
                <option key={p} value={p}>
                  {PHASE_LABELS[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Employee record" htmlFor="wz-person">
            <PersonSelect
              id="wz-person"
              value={personId}
              onChange={choosePerson}
              profiles={full.people.map((p) => ({
                id: p.id,
                full_name: `${p.full_name}${p.test_record ? " (synthetic)" : ""}${p.position ? ` — ${p.position}` : ""}`,
              }))}
              placeholder={full.people.length ? "Choose an employee" : "No employee records yet"}
            />
          </Field>
        </div>
      </Card>

      {person ? (
        <Card className="space-y-4">
          <CardTitle>2. Roles and employment facts</CardTitle>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-[var(--acton-navy)]">Roles</legend>
            <div className="flex flex-wrap gap-2">
              {ROLE_KEYS.map((r) => {
                const suggested = person.suggestedRoles.find((s) => s.role === r);
                return (
                  <label
                    key={r}
                    className="flex items-center gap-1.5 rounded border border-[var(--acton-border)] bg-white px-2 py-1 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={roles.includes(r)}
                      onChange={(e) => {
                        setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r));
                        setRolesConfirmed(false);
                        setPreview(null);
                      }}
                    />
                    {ROLE_KEY_LABELS[r]}
                    {suggested ? (
                      <span className="text-xs text-[var(--acton-muted)]">
                        ({suggested.because})
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rolesConfirmed}
                onChange={(e) => {
                  setRolesConfirmed(e.target.checked);
                  setPreview(null);
                }}
              />
              I confirm these roles (suggestions from the job title are never applied on their own,
              and role access never includes admin rights without a named CEO/COO approval)
            </label>
          </fieldset>
          <div className="grid gap-3 md:grid-cols-3">
            {phase !== "offboarding" ? (
              <>
                <TriSelect
                  id="wz-exempt"
                  label="Exempt?"
                  value={exempt}
                  onChange={setExempt}
                  yes="Exempt"
                  no="Non-exempt"
                />
                <TriSelect
                  id="wz-sup"
                  label="Supervisor?"
                  value={supervisor}
                  onChange={setSupervisor}
                  yes="Supervisor"
                  no="Non-supervisory"
                />
              </>
            ) : (
              <>
                <Field label="Separation type" htmlFor="wz-sep">
                  <select
                    id="wz-sep"
                    className={selectClass}
                    value={separation ?? ""}
                    onChange={(e) =>
                      setSeparation((e.target.value || null) as SeparationType | null)
                    }
                  >
                    <option value="">Not recorded yet</option>
                    {SEPARATION_TYPES.map((s) => (
                      <option key={s} value={s}>
                        {SEPARATION_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <TriSelect
                  id="wz-health"
                  label="On group health?"
                  value={onGroupHealth}
                  onChange={setOnGroupHealth}
                  yes="Yes"
                  no="No"
                />
              </>
            )}
          </div>
          <CardTitle>3. Dates and manager</CardTitle>
          <div className="grid gap-3 md:grid-cols-3">
            {phase === "offboarding" ? (
              <>
                <DateField
                  id="wz-notice"
                  label="Notice received"
                  value={dates.notice_date}
                  onChange={(v) => setDates({ ...dates, notice_date: v })}
                />
                <DateField
                  id="wz-last"
                  label="Last day"
                  value={dates.last_day}
                  onChange={(v) => setDates({ ...dates, last_day: v })}
                />
              </>
            ) : (
              <>
                <DateField
                  id="wz-offer"
                  label="Offer date"
                  value={dates.offer_date}
                  onChange={(v) => setDates({ ...dates, offer_date: v })}
                />
                <DateField
                  id="wz-start"
                  label="Start date"
                  value={dates.start_date}
                  onChange={(v) => setDates({ ...dates, start_date: v })}
                />
              </>
            )}
            <Field label={phase === "offboarding" ? "Manager" : "Hiring manager"} htmlFor="wz-mgr">
              <PersonSelect
                id="wz-mgr"
                value={manager}
                onChange={setManager}
                profiles={full.profiles}
              />
            </Field>
          </div>
          <Button disabled={busy} onClick={doPreview}>
            Generate checklist for review
          </Button>
        </Card>
      ) : null}

      {preview ? (
        <PlanPreview
          preview={preview}
          mode={mode}
          setMode={setMode}
          reason={reason}
          setReason={setReason}
          separation={separation}
          busy={busy}
          onStart={async () => {
            const res = await run<{ instance: { id: string } }>(
              { op: "start", case: input, mode, reason },
              "Case created. It waits for CEO/COO approval before any task begins.",
            );
            if (res) onStarted(res.instance.id);
          }}
        />
      ) : null}
    </div>
  );
}

function TriSelect(props: {
  id: string;
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  yes: string;
  no: string;
}) {
  return (
    <Field label={props.label} htmlFor={props.id}>
      <select
        id={props.id}
        className={selectClass}
        value={tri(props.value)}
        onChange={(e) => props.onChange(fromTri(e.target.value))}
      >
        <option value="">Not confirmed</option>
        <option value="yes">{props.yes}</option>
        <option value="no">{props.no}</option>
      </select>
    </Field>
  );
}

function DateField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={props.label} htmlFor={props.id}>
      <Input
        id={props.id}
        type="date"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </Field>
  );
}

function PlanPreview(props: {
  preview: Preview;
  mode: "test" | "live";
  setMode: (m: "test" | "live") => void;
  reason: string;
  setReason: (r: string) => void;
  separation: SeparationType | null;
  busy: boolean;
  onStart: () => void;
}) {
  const { plan, person } = props.preview;
  const included = plan.items.filter((i) => i.included);
  const excluded = plan.items.filter((i) => !i.included);
  const sections = [...new Set(included.map((i) => i.section))];
  const immediate = props.separation === "involuntary" || props.separation === "layoff";
  return (
    <Card className="space-y-4">
      <CardTitle>
        4. Review: {plan.phaseLabel} for {person.firstName}
        {person.position ? ` (${person.position})` : ""}
      </CardTitle>
      <CardDescription>
        {plan.counts.included} tasks ({plan.counts.legal} legal), {plan.counts.notApplicable} not
        applicable. Template v{props.preview.templateVersion ?? "—"}
        {props.preview.published ? "" : " (draft — not published yet)"}.
      </CardDescription>
      {plan.notes.map((n) => (
        <Notice key={n} tone="info">
          {n}
        </Notice>
      ))}
      <div className="grid gap-3 lg:grid-cols-2">
        <ListCard
          title="Missing information"
          items={plan.missingInfo}
          tone="amber"
          empty="Nothing missing."
        />
        <ListCard
          title="Approvals needed"
          items={plan.missingApprovals}
          tone="amber"
          empty="None."
        />
        <ListCard
          title="Legal flags"
          items={plan.legalFlags.map(
            (f) => `${f.title} — ${f.citations.join("; ") || "no citation"} — ${f.verification}`,
          )}
          empty="No legal items."
        />
        <ListCard
          title="Licensed seats"
          items={plan.licenseNeeds.map((l) => l.message)}
          empty="No licensed seats needed."
        />
      </div>
      <div className="space-y-3">
        {sections.map((s) => (
          <div key={s}>
            <h4 className="text-sm font-semibold text-[var(--acton-navy)]">{s}</h4>
            <ul className="mt-1 space-y-1 text-sm">
              {included
                .filter((i) => i.section === s)
                .map((i) => (
                  <li key={i.itemId} className="flex flex-wrap items-center gap-2">
                    <span>{i.title}</span>
                    {i.legal ? (
                      <TonePill tone="amber">{i.tags.map((t) => `[${t}]`).join(" ")}</TonePill>
                    ) : null}
                    <span className="text-xs text-[var(--acton-muted)]">
                      {OWNER_LABELS[i.owner] ?? i.owner} ·{" "}
                      {i.due
                        ? formatDate(i.due)
                        : i.missingDates.length
                          ? `needs ${i.missingDates.join(", ")}`
                          : "no due date"}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      {excluded.length ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Not applicable ({excluded.length}) — and why
          </summary>
          <ul className="mt-2 space-y-1 text-sm">
            {excluded.map((i) => (
              <li key={i.itemId}>
                <strong>{i.title}</strong>: {i.reasons.filter(Boolean).join(" ")}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {plan.drafts.length ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Draft communications ({plan.drafts.length}) — for HR review, never sent
          </summary>
          <div className="mt-2 space-y-3">
            {plan.drafts.map((d) => (
              <div key={d.key} className="rounded border border-[var(--acton-border)] p-2 text-sm">
                <div className="font-medium">
                  {d.name} ({d.channel}) — {d.subject}
                </div>
                <pre className="mt-1 text-xs whitespace-pre-wrap">{d.body}</pre>
                {d.missing.length ? (
                  <p className="mt-1 text-xs text-amber-800">Fill in: {d.missing.join(", ")}</p>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Mode" htmlFor="wz-mode">
          <select
            id="wz-mode"
            className={selectClass}
            value={props.mode}
            onChange={(e) => props.setMode(e.target.value as "test" | "live")}
          >
            <option value="test">Test (synthetic records)</option>
            <option value="live" disabled={person.testRecord}>
              Live
            </option>
          </select>
        </Field>
        <Field
          label={
            immediate
              ? "Reason for leadership (required, 20+ characters)"
              : "Approved event (shown to leadership)"
          }
          htmlFor="wz-reason"
        >
          <textarea
            id="wz-reason"
            rows={2}
            className={textareaClass}
            value={props.reason}
            onChange={(e) => props.setReason(e.target.value)}
          />
        </Field>
      </div>
      <Button disabled={props.busy || !props.preview.published} onClick={props.onStart}>
        Request CEO/COO approval to start
      </Button>
    </Card>
  );
}

function ListCard(props: { title: string; items: string[]; empty: string; tone?: "amber" }) {
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        props.tone && props.items.length
          ? "border-amber-200 bg-amber-50"
          : "border-[var(--acton-border)]",
      )}
    >
      <h4 className="text-sm font-semibold text-[var(--acton-navy)]">{props.title}</h4>
      {props.items.length ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
          {props.items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-[var(--acton-muted)]">{props.empty}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Case detail: chronological task view with history
// ---------------------------------------------------------------------------
type Detail = Awaited<ReturnType<typeof caseDetail>>;
type Task = Detail["tasks"][number];

function CaseDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { reload: reloadAll } = useLifecycle();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DisplayStatus | "all">("all");
  const [group, setGroup] = useState<"date" | "section">("date");
  const load = useCallback(async () => {
    try {
      setDetail(await aiFetch<Detail>(`/api/ops/lifecycle/cases/${id}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);
  useLoad(load);
  const tasks = (detail?.tasks ?? []).filter((t) => filter === "all" || t.display === filter);
  const ordered =
    group === "date"
      ? tasks
      : [...tasks].sort((a, b) => a.section.localeCompare(b.section) || a.ordinal - b.ordinal);
  return (
    <Dialog open onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>
          {detail
            ? `${detail.case.person?.name ?? "Case"} · ${PHASE_LABELS[detail.case.phase]} · ${detail.case.reference}`
            : "Lifecycle case"}
        </DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!detail ? <p className="text-sm text-[var(--acton-muted)]">Loading…</p> : null}
        {detail ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusPill status={detail.case.status} />
              <ModePill mode={detail.case.mode} />
              <span className="text-[var(--acton-muted)]">
                Checklist version {detail.case.summary.documentVersion} · template v
                {detail.case.templateVersion}
              </span>
            </div>
            {detail.case.status === "pending_approval" ? (
              <Notice tone="warning">
                Waiting for the CEO or COO to approve starting this case (Approvals tab). No task
                begins before that.
              </Notice>
            ) : null}
            {detail.case.summary.missingInfo.length ? (
              <Notice tone="warning">
                Missing when the case started: {detail.case.summary.missingInfo.join("; ")}
              </Notice>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Filter by status"
                className={cn(selectClass, "w-52")}
                value={filter}
                onChange={(e) => setFilter(e.target.value as DisplayStatus | "all")}
              >
                <option value="all">All statuses</option>
                {(
                  [
                    "overdue",
                    "awaiting_action",
                    "awaiting_approval",
                    "external_verification",
                    "blocked",
                    "completed",
                    "not_applicable",
                  ] as DisplayStatus[]
                ).map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <select
                aria-label="Order"
                className={cn(selectClass, "w-48")}
                value={group}
                onChange={(e) => setGroup(e.target.value as "date" | "section")}
              >
                <option value="date">By due date</option>
                <option value="section">By checklist section</option>
              </select>
            </div>
            <ul className="space-y-2">
              {ordered.map((t) => (
                <TaskRow
                  key={t.stepId}
                  task={t}
                  onChanged={async () => {
                    await load();
                    await reloadAll();
                  }}
                />
              ))}
            </ul>
          </>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function TaskRow({ task: t, onChanged }: { task: Task; onChanged: () => Promise<void> }) {
  const { run, busy } = useLifecycle();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [ticks, setTicks] = useState<string[]>([]);
  const [draft, setDraft] = useState(t.draft);
  const act = async (command: Record<string, unknown>, ok: string) => {
    const res = await run({ ...command, stepId: t.stepId }, ok);
    if (res !== null) {
      setNote("");
      setLink("");
      await onChanged();
    }
  };
  const isOpen = ["ready", "in_progress", "failed"].includes(t.status);
  return (
    <li className="rounded-md border border-[var(--acton-border)] bg-white">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <DisplayStatusPill status={t.display} />
        <span className="font-medium text-[var(--acton-navy)]">{t.title}</span>
        {t.tags.length ? (
          <TonePill tone="amber">{t.tags.map((x) => `[${x}]`).join(" ")}</TonePill>
        ) : null}
        <span className="ml-auto text-xs text-[var(--acton-muted)]">
          {OWNER_LABELS[t.owner] ?? t.owner} · {t.due ? formatDate(t.due) : "no due date"}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-[var(--acton-border)] px-3 py-2 text-sm">
          <blockquote className="border-l-2 border-[var(--acton-border)] pl-2 text-[var(--acton-navy)]">
            {t.text}
          </blockquote>
          <p className="text-xs text-[var(--acton-muted)]">
            Source: {t.part} → {t.section}, item {t.ordinal} (checklist version {t.documentVersion})
            {t.citations.length ? ` · ${t.citations.join("; ")}` : ""}
          </p>
          <VerificationPill state={t.verification} />
          {t.blockedBy.length ? <p>Blocked by: {t.blockedBy.join(", ")}</p> : null}
          {t.inclusionReasons.length ? (
            <p className="text-xs">Why it&apos;s here: {t.inclusionReasons.join(" ")}</p>
          ) : null}
          {t.flags.length ? (
            <ul className="list-disc pl-5 text-xs text-amber-900">
              {t.flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
          {t.checklist.length && isOpen ? (
            <fieldset className="space-y-1">
              <legend className="text-xs font-semibold">Tick each item delivered</legend>
              {t.checklist.map((c) => (
                <label key={c} className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={ticks.includes(c)}
                    onChange={(e) =>
                      setTicks(e.target.checked ? [...ticks, c] : ticks.filter((x) => x !== c))
                    }
                  />
                  {c}
                </label>
              ))}
            </fieldset>
          ) : null}
          {draft ? (
            <div className="space-y-1 rounded bg-[var(--acton-gray-50)] p-2">
              <p className="text-xs font-semibold">Draft {draft.channel} (never sent by Baxter)</p>
              <Input
                aria-label="Draft subject"
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />
              <textarea
                aria-label="Draft body"
                rows={5}
                className={textareaClass}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  act(
                    { op: "draft_edit", subject: draft.subject, body: draft.body },
                    "Draft saved (not sent).",
                  )
                }
              >
                Save draft
              </Button>
            </div>
          ) : null}
          {t.evidence.length ? (
            <div>
              <p className="text-xs font-semibold">Evidence</p>
              <ul className="list-disc pl-5 text-xs">
                {t.evidence.map((e) => (
                  <li key={`${e.at}-${e.value}`}>
                    {e.kind}: {e.value} ({formatDateTime(e.at)})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {t.approvals.length ? (
            <p className="text-xs">
              Approvals:{" "}
              {t.approvals.map((a) => `${a.title} (${a.status.replace(/_/g, " ")})`).join("; ")}
            </p>
          ) : null}
          <div className="grid gap-2 md:grid-cols-2">
            <Input
              aria-label="Note or evidence"
              placeholder="Note / evidence / reason"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Input
              aria-label="Evidence link"
              placeholder="Evidence link (optional)"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {isOpen ? (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    act(
                      {
                        op: "task_status",
                        transition: "complete",
                        note,
                        evidenceUrl: link,
                        checklistDone: ticks,
                      },
                      "Task completed.",
                    )
                  }
                >
                  Mark completed
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    act(
                      { op: "task_status", transition: "send_to_external_verification", note },
                      "Waiting for external verification.",
                    )
                  }
                >
                  Done elsewhere — verify
                </Button>
              </>
            ) : null}
            {t.status === "external_verification" ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  act(
                    {
                      op: "task_status",
                      transition: "confirm_external_verification",
                      note,
                      evidenceUrl: link,
                    },
                    "Verified and completed.",
                  )
                }
              >
                Confirm verified
              </Button>
            ) : null}
            {["blocked", "ready", "in_progress", "failed"].includes(t.status) &&
            t.stepType !== "approval" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  act({ op: "task_status", transition: "mark_not_applicable", note }, "Marked N/A.")
                }
              >
                Mark N/A (reason)
              </Button>
            ) : null}
            {["not_applicable", "external_verification"].includes(t.status) ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => act({ op: "task_status", transition: "reopen", note }, "Reopened.")}
              >
                Reopen
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !note.trim()}
              onClick={() => act({ op: "task_note", note }, "Note added.")}
            >
              Add note
            </Button>
          </div>
          {t.history.length ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold">
                History ({t.history.length})
              </summary>
              <ol className="mt-1 space-y-0.5 text-xs">
                {t.history.map((h) => (
                  <li key={`${h.at}-${h.event}`}>
                    {formatDateTime(h.at)} — {h.event.replace(/_/g, " ")}
                    {h.by ? ` by ${h.by}` : ""}
                    {h.note ? `: ${h.note}` : ""}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
