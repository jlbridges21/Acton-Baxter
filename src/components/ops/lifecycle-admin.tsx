"use client";

/**
 * Staff lifecycle administration (no code): the software access register, the recurring
 * compliance calendar and legal verification register, checklist item editing with versions and
 * rollback, communication templates, the source document versions, and reminder settings.
 */

import { useState } from "react";
import { FileUp } from "lucide-react";
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
} from "@/components/ai/ui";
import { ASSIGNEE_ROLES } from "@/lib/ops/definition";
import {
  PHASE_LABELS,
  ROLE_KEYS,
  ROLE_KEY_LABELS,
  type LifecycleItem,
  type RoleKey,
  type Timing,
} from "@/lib/hr-lifecycle/types";
import { cn } from "@/lib/utils";
import {
  OWNER_LABELS,
  VerificationPill,
  useLifecycle,
  type FullLifecycleState,
} from "./lifecycle-shared";
import { PersonSelect, SectionHeader, StatusPill, Table, TonePill, formatDate, td } from "./shared";

const nameOf = (full: FullLifecycleState, id: string | null) =>
  id ? (full.profiles.find((p) => p.id === id)?.full_name ?? "Someone") : "—";

// ---------------------------------------------------------------------------
// Software access register
// ---------------------------------------------------------------------------
export function AccessRegisterView() {
  const { full, run, busy, state } = useLifecycle();
  const [grant, setGrant] = useState({
    personId: null as string | null,
    platform: "google_workspace",
    role: "",
    grantedOn: new Date().toISOString().slice(0, 10),
    approverProfileId: null as string | null,
    approvalNote: "",
  });
  const [show, setShow] = useState<"active" | "revoked">("active");
  if (!full) return null;
  const people = new Map(full.people.map((p) => [p.id, p]));
  const grants = full.grants.filter((g) => g.status === show);
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Software access register"
        description="Every platform grant with role, date, and approver. Sam never grants or removes access: the COO does it in each admin console and records it here. Admin or owner-level roles need the CEO or COO as the named approver. Seat costs are recorded from invoices or admin consoles, never estimated."
      />
      <Table
        head={["Platform", "Licensed seats", "Seats (used / total)", "Seat cost", "Owner", ""]}
      >
        {full.platforms.map((p) => (
          <PlatformRowEditor key={p.key} platform={p} />
        ))}
      </Table>

      <Card className="space-y-3">
        <CardTitle>Record a grant</CardTitle>
        {!state?.access.isCoo && !state?.access.isLeadership ? (
          <Notice tone="info">Only the COO (or CEO) records grants and removals.</Notice>
        ) : null}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Employee" htmlFor="gr-person">
            <PersonSelect
              id="gr-person"
              value={grant.personId}
              onChange={(v) => setGrant({ ...grant, personId: v })}
              profiles={full.people.map((p) => ({ id: p.id, full_name: p.full_name }))}
            />
          </Field>
          <Field label="Platform" htmlFor="gr-platform">
            <select
              id="gr-platform"
              className={selectClass}
              value={grant.platform}
              onChange={(e) => setGrant({ ...grant, platform: e.target.value })}
            >
              {full.platformDefs.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Role on the platform" htmlFor="gr-role">
            <Input
              id="gr-role"
              value={grant.role}
              onChange={(e) => setGrant({ ...grant, role: e.target.value })}
            />
          </Field>
          <Field label="Granted on" htmlFor="gr-date">
            <Input
              id="gr-date"
              type="date"
              value={grant.grantedOn}
              onChange={(e) => setGrant({ ...grant, grantedOn: e.target.value })}
            />
          </Field>
          <Field label="Approver" htmlFor="gr-approver">
            <PersonSelect
              id="gr-approver"
              value={grant.approverProfileId}
              onChange={(v) => setGrant({ ...grant, approverProfileId: v })}
              profiles={full.profiles}
            />
          </Field>
          <Field label="Approval note (required for privileged roles)" htmlFor="gr-note">
            <Input
              id="gr-note"
              value={grant.approvalNote}
              onChange={(e) => setGrant({ ...grant, approvalNote: e.target.value })}
            />
          </Field>
        </div>
        <Button
          disabled={busy || !grant.personId || !grant.approverProfileId || !grant.role.trim()}
          onClick={() => run({ op: "grant_record", ...grant }, "Grant recorded.")}
        >
          Record grant
        </Button>
      </Card>

      <div className="flex gap-2">
        {(["active", "revoked"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={show === s ? "primary" : "secondary"}
            onClick={() => setShow(s)}
          >
            {s === "active" ? "Active grants" : "Removed (7-day audit)"}
          </Button>
        ))}
      </div>
      <Table
        head={["Employee", "Platform", "Role", "Granted", "Approver", "Status", ""]}
        empty="No grants recorded."
      >
        {grants.map((g) => (
          <tr key={g.id}>
            <td className={td}>{people.get(g.person_id)?.full_name ?? "Restricted"}</td>
            <td className={td}>
              {full.platformDefs.find((p) => p.key === g.platform)?.label ?? g.platform}
            </td>
            <td className={td}>
              {g.role} {g.privileged ? <TonePill tone="red">Privileged</TonePill> : null}
            </td>
            <td className={td}>{formatDate(g.granted_on)}</td>
            <td className={td}>
              {nameOf(full, g.approver_profile_id)}
              {g.approval_note ? (
                <div className="text-xs text-[var(--acton-muted)]">{g.approval_note}</div>
              ) : null}
            </td>
            <td className={td}>
              {g.status === "active" ? (
                <TonePill tone="green">Active</TonePill>
              ) : g.revocation_verified_at ? (
                <TonePill tone="green">Removal verified</TonePill>
              ) : (
                <TonePill tone="amber">Removed {formatDate(g.revoked_on)} — verify</TonePill>
              )}
            </td>
            <td className={td}>
              {g.status === "active" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      {
                        op: "grant_revoke",
                        grantId: g.id,
                        revokedOn: new Date().toISOString().slice(0, 10),
                      },
                      "Removal recorded.",
                    )
                  }
                >
                  Record removal today
                </Button>
              ) : !g.revocation_verified_at ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run({ op: "grant_verify_removed", grantId: g.id }, "Removal verified.")
                  }
                >
                  Confirm no access
                </Button>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function PlatformRowEditor({ platform: p }: { platform: FullLifecycleState["platforms"][number] }) {
  const { full, run, busy } = useLifecycle();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({
    seatsTotal: p.seats_total === null ? "" : String(p.seats_total),
    seatsUsed: p.seats_used === null ? "" : String(p.seats_used),
    seatCost: p.seat_cost ?? "",
    seatCostSource: p.seat_cost_source ?? "",
    ownerProfileId: p.owner_profile_id,
    notes: p.notes,
  });
  if (!full) return null;
  const num = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.floor(Number(s))));
  return (
    <tr>
      <td className={td}>
        <div className="font-medium">{p.label}</div>
        <div className="text-xs text-[var(--acton-muted)]">{p.notes}</div>
      </td>
      <td className={td}>{p.licensed_seat ? "Yes" : "—"}</td>
      <td className={td}>
        {edit ? (
          <div className="flex gap-1">
            <Input
              aria-label="Seats used"
              className="w-16"
              value={v.seatsUsed}
              onChange={(e) => setV({ ...v, seatsUsed: e.target.value })}
            />
            <Input
              aria-label="Seats total"
              className="w-16"
              value={v.seatsTotal}
              onChange={(e) => setV({ ...v, seatsTotal: e.target.value })}
            />
          </div>
        ) : p.seats_total === null ? (
          <span className="text-[var(--acton-muted)]">Not recorded</span>
        ) : (
          `${p.seats_used ?? "?"} / ${p.seats_total}`
        )}
      </td>
      <td className={td}>
        {edit ? (
          <div className="space-y-1">
            <Input
              aria-label="Seat cost"
              placeholder="As invoiced"
              value={v.seatCost}
              onChange={(e) => setV({ ...v, seatCost: e.target.value })}
            />
            <Input
              aria-label="Cost source"
              placeholder="Source (invoice, contract…)"
              value={v.seatCostSource}
              onChange={(e) => setV({ ...v, seatCostSource: e.target.value })}
            />
          </div>
        ) : p.seat_cost ? (
          <>
            {p.seat_cost}
            <div className="text-xs text-[var(--acton-muted)]">Source: {p.seat_cost_source}</div>
          </>
        ) : (
          <span className="text-[var(--acton-muted)]">Not recorded</span>
        )}
      </td>
      <td className={td}>
        {edit ? (
          <PersonSelect
            value={v.ownerProfileId}
            onChange={(x) => setV({ ...v, ownerProfileId: x })}
            profiles={full.profiles}
          />
        ) : (
          nameOf(full, p.owner_profile_id)
        )}
      </td>
      <td className={td}>
        {edit ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              const ok = await run(
                {
                  op: "platform_save",
                  key: p.key,
                  seatsTotal: num(v.seatsTotal),
                  seatsUsed: num(v.seatsUsed),
                  seatCost: v.seatCost || null,
                  seatCostSource: v.seatCostSource || null,
                  ownerProfileId: v.ownerProfileId,
                  notes: v.notes,
                },
                "Saved.",
              );
              if (ok !== null) setEdit(false);
            }}
          >
            Save
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setEdit(true)}>
            Edit
          </Button>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Compliance calendar and verification register
// ---------------------------------------------------------------------------
export function ComplianceView() {
  const { full, run, busy } = useLifecycle();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  if (!full) return null;
  type Cal = {
    id: string;
    key: string;
    item: string;
    when_text: string;
    requirement: string;
    owner_role: string;
    owner_profile_id: string | null;
    verified_dates: string[];
    active: boolean;
  };
  type Occ = {
    id: string;
    calendar_id: string;
    period_key: string;
    due_date: string | null;
    status: string;
  };
  const calendar = full.calendar as Cal[];
  const occurrences = (full.occurrences as Occ[]).filter((o) => o.status === "open");
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Recurring compliance calendar"
        description={`${full.catalog.recurringIntro} The scheduled sweep creates each period's occurrence once and raises reminders (in-app; Slack only if leadership enables it, and then each one needs approval).`}
      />
      <Table head={["Item", "When", "Requirement", "Owner", "Verified dates", ""]}>
        {calendar.map((c) => (
          <CalendarRow key={c.id} row={c} />
        ))}
      </Table>
      <Table head={["Open occurrence", "Due", "Evidence", ""]} empty="No open occurrences.">
        {occurrences.map((o) => {
          const cal = calendar.find((c) => c.id === o.calendar_id);
          return (
            <tr key={o.id}>
              <td className={td}>
                {cal?.item ?? "—"}
                <div className="text-xs text-[var(--acton-muted)]">
                  {o.period_key.includes(":") ? "Per employee" : o.period_key}
                </div>
              </td>
              <td className={td}>
                {o.due_date ? (
                  formatDate(o.due_date)
                ) : (
                  <TonePill tone="amber">Needs verified dates</TonePill>
                )}
              </td>
              <td className={td}>
                <Input
                  aria-label="Evidence"
                  value={evidence[o.id] ?? ""}
                  onChange={(e) => setEvidence({ ...evidence, [o.id]: e.target.value })}
                />
              </td>
              <td className={td}>
                <Button
                  size="sm"
                  disabled={busy || !(evidence[o.id] ?? "").trim()}
                  onClick={() =>
                    run(
                      { op: "occurrence_complete", occurrenceId: o.id, evidence: evidence[o.id] },
                      "Recorded.",
                    )
                  }
                >
                  Mark done
                </Button>
              </td>
            </tr>
          );
        })}
      </Table>

      <SectionHeader
        title="Legal verification register"
        description="Each [CA]/[Fed] requirement stays unverified until a named reviewer checks it against an official DIR, EDD, CRD, Cal/OSHA, DHCS, legislative, or federal source. The document's wording is kept; a discrepancy is recorded next to it, never written over it. This register is not legal advice."
      />
      <Card className="space-y-1">
        <CardTitle>Official sources named in the checklist</CardTitle>
        <ul className="list-disc pl-5 text-sm">
          {full.catalog.sources.map((s) => (
            <li key={s.url}>
              <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                {s.name}
              </a>{" "}
              — {s.covers}
              {s.official ? "" : " (paid; not an official source)"}
            </li>
          ))}
        </ul>
        <CardDescription>{full.catalog.sourcesNote}</CardDescription>
      </Card>
      <Table head={["Item", "Citation", "Status", "Reviewer", "Official source", ""]}>
        {full.verifications.map((v) => (
          <tr key={v.id}>
            <td className={cn(td, "max-w-md")}>
              <div className="font-mono text-xs">{v.item_id}</div>
              <details>
                <summary className="cursor-pointer text-xs text-[var(--acton-muted)]">
                  Original wording
                </summary>
                <p className="text-xs">{v.original_text}</p>
              </details>
              {v.discrepancy ? (
                <p className="text-xs text-red-800">Discrepancy: {v.discrepancy}</p>
              ) : null}
            </td>
            <td className={td}>
              {v.citation}
              <div className="text-xs text-[var(--acton-muted)]">{v.authority}</div>
            </td>
            <td className={td}>
              <VerificationPill state={v.status} />
            </td>
            <td className={td}>
              {v.reviewer_profile_id ? nameOf(full, v.reviewer_profile_id) : "—"}
              <div className="text-xs text-[var(--acton-muted)]">
                {v.reviewed_at ? formatDateTime(v.reviewed_at) : ""}
              </div>
            </td>
            <td className={td}>
              {v.official_source_url ? (
                <a
                  className="underline"
                  href={v.official_source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {v.official_source_title}
                </a>
              ) : (
                "—"
              )}
            </td>
            <td className={td}>
              <Button size="sm" variant="secondary" onClick={() => setReviewing(v.id)}>
                Record review
              </Button>
            </td>
          </tr>
        ))}
      </Table>
      {reviewing ? <ReviewDialog id={reviewing} onClose={() => setReviewing(null)} /> : null}
    </div>
  );
}

function CalendarRow({
  row,
}: {
  row: {
    key: string;
    item: string;
    when_text: string;
    requirement: string;
    owner_role: string;
    owner_profile_id: string | null;
    verified_dates: string[];
    active: boolean;
  };
}) {
  const { full, run, busy } = useLifecycle();
  const [owner, setOwner] = useState(row.owner_profile_id);
  const [dates, setDates] = useState(row.verified_dates.join(", "));
  if (!full) return null;
  return (
    <tr>
      <td className={td}>{row.item}</td>
      <td className={td}>{row.when_text}</td>
      <td className={td}>{row.requirement}</td>
      <td className={td}>
        <PersonSelect
          value={owner}
          onChange={setOwner}
          profiles={full.profiles}
          placeholder={OWNER_LABELS[row.owner_role] ?? row.owner_role}
        />
      </td>
      <td className={td}>
        <Input
          aria-label="Verified dates (MM-DD)"
          placeholder="MM-DD, MM-DD"
          value={dates}
          onChange={(e) => setDates(e.target.value)}
        />
      </td>
      <td className={td}>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            run(
              {
                op: "calendar_save",
                key: row.key,
                ownerProfileId: owner,
                ownerRole: row.owner_role,
                verifiedDates: dates.split(/[,\s]+/).filter(Boolean),
                active: row.active,
              },
              "Saved.",
            )
          }
        >
          Save
        </Button>
      </td>
    </tr>
  );
}

function ReviewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { run, busy } = useLifecycle();
  const [v, setV] = useState({
    status: "verified" as "verified" | "discrepancy",
    officialSourceUrl: "",
    officialSourceTitle: "",
    officialText: "",
    discrepancy: "",
    note: "",
  });
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Record a legal review</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <Notice tone="info">
          You are recorded as the named reviewer. Use an official government source.
        </Notice>
        <Field label="Outcome" htmlFor="rv-status">
          <select
            id="rv-status"
            className={selectClass}
            value={v.status}
            onChange={(e) => setV({ ...v, status: e.target.value as "verified" | "discrepancy" })}
          >
            <option value="verified">Matches the official source</option>
            <option value="discrepancy">Discrepancy</option>
          </select>
        </Field>
        <Field label="Official source link (https)" htmlFor="rv-url">
          <Input
            id="rv-url"
            value={v.officialSourceUrl}
            onChange={(e) => setV({ ...v, officialSourceUrl: e.target.value })}
          />
        </Field>
        <Field label="Page or document title" htmlFor="rv-title">
          <Input
            id="rv-title"
            value={v.officialSourceTitle}
            onChange={(e) => setV({ ...v, officialSourceTitle: e.target.value })}
          />
        </Field>
        <Field label="Relevant official wording (optional)" htmlFor="rv-text">
          <textarea
            id="rv-text"
            rows={3}
            className={textareaClass}
            value={v.officialText}
            onChange={(e) => setV({ ...v, officialText: e.target.value })}
          />
        </Field>
        {v.status === "discrepancy" ? (
          <Field label="Discrepancy" htmlFor="rv-disc">
            <textarea
              id="rv-disc"
              rows={3}
              className={textareaClass}
              value={v.discrepancy}
              onChange={(e) => setV({ ...v, discrepancy: e.target.value })}
            />
          </Field>
        ) : null}
        <Field label="Note" htmlFor="rv-note">
          <Input
            id="rv-note"
            value={v.note}
            onChange={(e) => setV({ ...v, note: e.target.value })}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            if ((await run({ op: "verify", id, ...v }, "Review recorded.")) !== null) onClose();
          }}
        >
          Save review
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Templates, communications, source document, settings
// ---------------------------------------------------------------------------
export function TemplatesView() {
  const { full, reload } = useLifecycle();
  const [editing, setEditing] = useState<{
    phase: FullLifecycleState["templates"][number]["phase"];
    item: LifecycleItem;
    index: number;
  } | null>(null);
  const [opsMessage, setOpsMessage] = useState<string | null>(null);
  if (!full) return null;
  const ops = async (command: Record<string, unknown>, ok: string) => {
    try {
      const res = await aiFetch<{ result: { published?: boolean } | null }>("/api/ops", {
        method: "POST",
        body: JSON.stringify(command),
      });
      setOpsMessage(
        res.result && res.result.published === false
          ? "Sent to the CEO/COO for review (legal items changed, or you aren't leadership)."
          : ok,
      );
      await reload();
    } catch (e) {
      setOpsMessage(errorMessage(e));
    }
  };
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Lifecycle templates"
        description="Each phase is a versioned Sam Operations workflow built from the leadership checklist. Edits save a new draft version; publishing needs the CEO or COO (and always a recorded review when a legal item changes). Running cases stay on the version they started with. Rollback copies an earlier version forward."
      />
      {opsMessage ? <Notice tone="info">{opsMessage}</Notice> : null}
      {full.templates.map((t) => (
        <Card key={t.phase} className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>{t.name}</CardTitle>
              <CardDescription>
                Published: {t.published ? `v${t.published.version}` : "not yet"} · Latest: v
                {t.latest.version} ({t.latest.status}) · Checklist version{" "}
                {t.latest.documentVersion ?? "—"}
                {t.latest.changeSummary ? ` · ${t.latest.changeSummary}` : ""}
              </CardDescription>
            </div>
            {t.latest.status === "draft" ? (
              <Button
                size="sm"
                onClick={() =>
                  ops(
                    { op: "template_publish", templateId: t.templateId, versionId: t.latest.id },
                    "Published.",
                  )
                }
              >
                Publish v{t.latest.version}
              </Button>
            ) : null}
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Items ({t.items.length})
            </summary>
            <ol className="mt-2 space-y-1 text-sm">
              {t.items.map((item, index) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2">
                  <span className="w-6 text-right text-xs text-[var(--acton-muted)]">
                    {index + 1}.
                  </span>
                  <span>{item.title}</span>
                  {item.tags.length ? (
                    <TonePill tone="amber">{item.tags.map((x) => `[${x}]`).join(" ")}</TonePill>
                  ) : null}
                  {item.origin === "system" ? (
                    <TonePill tone="violet">Added by Baxter</TonePill>
                  ) : null}
                  <span className="text-xs text-[var(--acton-muted)]">
                    {OWNER_LABELS[item.owner] ?? item.owner} ·{" "}
                    {item.roles === "general"
                      ? "all staff"
                      : item.roles.map((r) => ROLE_KEY_LABELS[r]).join(", ")}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing({ phase: t.phase, item, index })}
                  >
                    Edit
                  </Button>
                </li>
              ))}
            </ol>
          </details>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Versions ({t.versions.length})
            </summary>
            <ul className="mt-2 space-y-1 text-sm">
              {t.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2">
                  <span>v{v.version}</span>
                  <StatusPill status={v.status} />
                  <span className="text-xs text-[var(--acton-muted)]">{v.changeSummary}</span>
                  {v.id !== t.latest.id ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        ops(
                          { op: "template_rollback", templateId: t.templateId, versionId: v.id },
                          `Copied v${v.version} forward as a new draft.`,
                        )
                      }
                    >
                      Roll back to this
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        </Card>
      ))}
      {editing ? <ItemEditor {...editing} onClose={() => setEditing(null)} /> : null}
      <CommunicationsCard />
      <SourceCard />
      <SettingsCard />
      <Card className="space-y-1">
        <CardTitle>Sam&apos;s instructions</CardTitle>
        <CardDescription>
          Sam&apos;s lifecycle instructions, task statuses, delegation keywords, and tools are
          edited without code in{" "}
          <a className="underline" href="/ai/operations?tab=sam">
            Sam configuration
          </a>{" "}
          (versioned, with rollback, in the AI Studio).
        </CardDescription>
      </Card>
    </div>
  );
}

function ItemEditor({
  phase,
  item,
  index,
  onClose,
}: {
  phase: FullLifecycleState["templates"][number]["phase"];
  item: LifecycleItem;
  index: number;
  onClose: () => void;
}) {
  const { run, busy, full } = useLifecycle();
  const [v, setV] = useState({
    title: item.title,
    text: item.text,
    owner: item.owner,
    timing: item.timing as Timing,
    timingText: item.timingText,
    roles: item.roles,
    dependsOn: item.dependsOn.join(", "),
    communication: item.communication ?? "",
    position: index,
    changeSummary: "",
  });
  const legal = item.tags.length > 0;
  return (
    <Dialog open onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>Edit checklist item ({PHASE_LABELS[phase]})</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <p className="text-xs text-[var(--acton-muted)]">
          Source: {item.sourceRef.part} → {item.sourceRef.section}, item {item.sourceRef.ordinal}{" "}
          (version {item.sourceRef.documentVersion})
        </p>
        {legal ? (
          <Notice tone="warning">
            This is a legal item. Changes to its wording, timing, owner, roles, or conditions go to
            the CEO/COO for review before publishing, and its verification returns to
            &quot;unverified&quot;.
          </Notice>
        ) : null}
        <Field label="Title" htmlFor="ie-title">
          <Input
            id="ie-title"
            value={v.title}
            onChange={(e) => setV({ ...v, title: e.target.value })}
          />
        </Field>
        <Field label="Checklist wording" htmlFor="ie-text">
          <textarea
            id="ie-text"
            rows={3}
            className={textareaClass}
            value={v.text}
            onChange={(e) => setV({ ...v, text: e.target.value })}
          />
        </Field>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Owner" htmlFor="ie-owner">
            <select
              id="ie-owner"
              className={selectClass}
              value={v.owner}
              onChange={(e) => setV({ ...v, owner: e.target.value as LifecycleItem["owner"] })}
              disabled={item.stepType === "access_request" || item.stepType === "finance_handoff"}
            >
              {ASSIGNEE_ROLES.filter((r) => r !== "specific_person").map((r) => (
                <option key={r} value={r}>
                  {OWNER_LABELS[r] ?? r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Timing" htmlFor="ie-kind">
            <select
              id="ie-kind"
              className={selectClass}
              value={v.timing.kind}
              onChange={(e) => {
                const kind = e.target.value as Timing["kind"];
                setV({
                  ...v,
                  timing:
                    kind === "none" || kind === "final_pay"
                      ? { kind }
                      : {
                          kind,
                          anchor: "anchor" in v.timing ? v.timing.anchor : "start_date",
                          offset: "offset" in v.timing ? v.timing.offset : 0,
                        },
                });
              }}
            >
              <option value="days">Days from a date</option>
              <option value="business_days">Business days after a date</option>
              <option value="months">Months after a date</option>
              <option value="final_pay">Final pay rule</option>
              <option value="none">No due date</option>
            </select>
          </Field>
          {"anchor" in v.timing ? (
            <div className="flex gap-2">
              <Field label="From" htmlFor="ie-anchor">
                <select
                  id="ie-anchor"
                  className={selectClass}
                  value={v.timing.anchor}
                  onChange={(e) =>
                    setV({
                      ...v,
                      timing: {
                        ...(v.timing as Extract<Timing, { anchor: string }>),
                        anchor: e.target.value as "start_date",
                      },
                    })
                  }
                >
                  <option value="offer_date">Offer date</option>
                  <option value="start_date">Start date</option>
                  <option value="notice_date">Notice date</option>
                  <option value="last_day">Last day</option>
                </select>
              </Field>
              <Field label="Offset" htmlFor="ie-offset">
                <Input
                  id="ie-offset"
                  type="number"
                  value={v.timing.offset}
                  onChange={(e) =>
                    setV({
                      ...v,
                      timing: {
                        ...(v.timing as Extract<Timing, { anchor: string }>),
                        offset: Math.trunc(Number(e.target.value)),
                      },
                    })
                  }
                />
              </Field>
            </div>
          ) : null}
        </div>
        <Field label="Timing wording" htmlFor="ie-tt">
          <Input
            id="ie-tt"
            value={v.timingText}
            onChange={(e) => setV({ ...v, timingText: e.target.value })}
          />
        </Field>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Applies to</legend>
          <label className="mr-3 text-sm">
            <input
              type="radio"
              checked={v.roles === "general"}
              onChange={() => setV({ ...v, roles: "general" })}
            />{" "}
            All staff
          </label>
          {ROLE_KEYS.map((r) => (
            <label key={r} className="mr-3 text-sm">
              <input
                type="checkbox"
                checked={v.roles !== "general" && v.roles.includes(r)}
                onChange={(e) => {
                  const cur: RoleKey[] = v.roles === "general" ? [] : v.roles;
                  const next = e.target.checked ? [...cur, r] : cur.filter((x) => x !== r);
                  setV({ ...v, roles: next.length ? next : "general" });
                }}
              />{" "}
              {ROLE_KEY_LABELS[r]}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Depends on (item ids)" htmlFor="ie-deps">
            <Input
              id="ie-deps"
              value={v.dependsOn}
              onChange={(e) => setV({ ...v, dependsOn: e.target.value })}
            />
          </Field>
          <Field label="Communication template" htmlFor="ie-comm">
            <select
              id="ie-comm"
              className={selectClass}
              value={v.communication}
              onChange={(e) => setV({ ...v, communication: e.target.value })}
            >
              <option value="">None</option>
              {full?.communicationDefaults.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.key}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Position" htmlFor="ie-pos">
            <Input
              id="ie-pos"
              type="number"
              min={1}
              value={v.position + 1}
              onChange={(e) => setV({ ...v, position: Math.max(0, Number(e.target.value) - 1) })}
            />
          </Field>
        </div>
        <Field label="What changed and why (required)" htmlFor="ie-sum">
          <Input
            id="ie-sum"
            value={v.changeSummary}
            onChange={(e) => setV({ ...v, changeSummary: e.target.value })}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy || v.changeSummary.trim().length < 2}
          onClick={async () => {
            const res = await run(
              {
                op: "item_edit",
                phase,
                changeSummary: v.changeSummary,
                edits: [
                  {
                    itemId: item.id,
                    title: v.title,
                    text: v.text,
                    ...(item.stepType === "access_request" || item.stepType === "finance_handoff"
                      ? {}
                      : { owner: v.owner }),
                    timing: v.timing,
                    timingText: v.timingText,
                    roles: v.roles,
                    dependsOn: v.dependsOn.split(/[,\s]+/).filter(Boolean),
                    communication: v.communication || null,
                    position: v.position,
                  },
                ],
              },
              "Saved as a draft version. Publish it when ready.",
            );
            if (res !== null) onClose();
          }}
        >
          Save draft
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function CommunicationsCard() {
  const { full, run, busy } = useLifecycle();
  const [editing, setEditing] = useState<string | null>(null);
  const [v, setV] = useState({
    name: "",
    channel: "email" as "email" | "slack",
    subject: "",
    body: "",
    changeSummary: "",
  });
  if (!full) return null;
  const active = full.communications.filter((c) => c.status === "active");
  return (
    <Card className="space-y-3">
      <CardTitle>Communication templates</CardTitle>
      <CardDescription>
        Drafts only: they fill in each case&apos;s draft for HR to review and send themselves.
        Editing a template never changes drafts already in a case. Merge fields use {"{{field}}"}.
      </CardDescription>
      <ul className="space-y-2">
        {active.map((c) => (
          <li key={c.id} className="rounded border border-[var(--acton-border)] p-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>{c.name}</strong> ({c.channel}) · v{c.version}
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditing(c.key);
                    setV({
                      name: c.name,
                      channel: c.channel,
                      subject: c.subject,
                      body: c.body,
                      changeSummary: "",
                    });
                  }}
                >
                  Edit
                </Button>
                {full.communications
                  .filter((x) => x.key === c.key && x.version !== c.version)
                  .slice(0, 3)
                  .map((x) => (
                    <Button
                      key={x.id}
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        run(
                          { op: "comm_rollback", key: c.key, version: x.version },
                          `Restored v${x.version} as a new version.`,
                        )
                      }
                    >
                      Restore v{x.version}
                    </Button>
                  ))}
              </div>
            </div>
            {editing === c.key ? (
              <div className="mt-2 space-y-2">
                <Input
                  aria-label="Subject"
                  value={v.subject}
                  onChange={(e) => setV({ ...v, subject: e.target.value })}
                />
                <textarea
                  aria-label="Body"
                  rows={6}
                  className={textareaClass}
                  value={v.body}
                  onChange={(e) => setV({ ...v, body: e.target.value })}
                />
                <Input
                  aria-label="Change summary"
                  placeholder="What changed"
                  value={v.changeSummary}
                  onChange={(e) => setV({ ...v, changeSummary: e.target.value })}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy || v.changeSummary.trim().length < 2}
                    onClick={async () => {
                      if (
                        (await run(
                          { op: "comm_save", key: c.key, ...v },
                          "Template saved as a new version.",
                        )) !== null
                      )
                        setEditing(null);
                    }}
                  >
                    Save new version
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <pre className="mt-1 text-xs whitespace-pre-wrap text-[var(--acton-muted)]">
                {c.body}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SourceCard() {
  const { full, reload } = useLifecycle();
  const [file, setFile] = useState<File | null>(null);
  const [versionLabel, setVersionLabel] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  if (!full) return null;
  return (
    <Card className="space-y-3">
      <CardTitle>Source document</CardTitle>
      <CardDescription>
        The leadership checklist ({full.catalog.title}, {full.catalog.dateLine}). Importing stores
        it in the Knowledge Hub for Sam with its version. Replacing it with a new version archives
        the old file (never deletes it), compares every checkbox, and prepares draft template
        versions for review. Running cases keep the version they started with.
      </CardDescription>
      <Table
        head={["Version", "Document date", "File", "Items", "Status", "Changes"]}
        empty="Not imported yet. The templates were built from the 2026-10-28 document."
      >
        {full.sources.map((s) => (
          <tr key={s.id}>
            <td className={td}>{s.version_label}</td>
            <td className={td}>{s.document_date ?? "—"}</td>
            <td className={td}>{s.filename}</td>
            <td className={td}>{s.item_count}</td>
            <td className={td}>
              <StatusPill
                status={s.status === "current" ? "active" : "superseded"}
                label={s.status}
              />
            </td>
            <td className={td}>{s.reconciliation.summary ?? "—"}</td>
          </tr>
        ))}
      </Table>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Checklist (.docx)" htmlFor="src-file">
          <input
            id="src-file"
            type="file"
            accept=".docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label="Version label" htmlFor="src-ver">
          <Input
            id="src-ver"
            placeholder="2026-10-28"
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
          />
        </Field>
        <Field label="Note" htmlFor="src-note">
          <Input id="src-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Button
        disabled={busy || !file || !versionLabel.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            const form = new FormData();
            form.set("file", file!);
            form.set("versionLabel", versionLabel.trim());
            form.set("note", note);
            const res = await aiFetch<{
              result: { source: { reconciliation: { summary?: string } }; draftsCreated: string[] };
            }>("/api/ops/lifecycle/source", { method: "POST", body: form });
            setResult(
              `Imported. ${res.result.source.reconciliation.summary ?? ""} ${res.result.draftsCreated.length ? `Draft versions prepared: ${res.result.draftsCreated.join(", ")}.` : "No template changes needed."}`,
            );
            await reload();
          } catch (e) {
            setResult(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <FileUp className="mr-1.5 h-4 w-4" /> Import document
      </Button>
      {result ? <Notice tone="info">{result}</Notice> : null}
    </Card>
  );
}

function SettingsCard() {
  const { full, run, busy, state } = useLifecycle();
  const [leadDays, setLeadDays] = useState(full?.settings.leadDays ?? 2);
  if (!full) return null;
  return (
    <Card className="space-y-3">
      <CardTitle>Reminders</CardTitle>
      <CardDescription>
        The existing Sam Operations sweep (cron, about every 15 minutes) raises each reminder once
        per deadline: due soon, 1 day overdue, and 7 days overdue (compliance items also get 30
        days&apos; notice). No AI model runs for reminders. External notifications are{" "}
        <strong>
          {full.settings.external.enabled
            ? "on — each Slack reminder is an approval request"
            : "off"}
        </strong>
        . Owners: COO {full.owners.coo ? "set" : "not set"}, HR admins{" "}
        {full.owners.hrAdmins.length ? "set" : "not set"}, head of finance{" "}
        {full.owners.financeOwner ? "set" : "not set"}, tech ops manager{" "}
        {full.owners.techOpsManager ? "set" : "not set"} (Setup).
      </CardDescription>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Due-soon lead time (days)" htmlFor="st-lead">
          <Input
            id="st-lead"
            type="number"
            min={0}
            max={30}
            className="w-24"
            value={leadDays}
            onChange={(e) =>
              setLeadDays(Math.max(0, Math.min(30, Math.trunc(Number(e.target.value)))))
            }
          />
        </Field>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            run(
              { op: "settings_save", leadDays, externalEnabled: full.settings.external.enabled },
              "Saved.",
            )
          }
        >
          Save
        </Button>
        {state?.access.isLeadership ? (
          <Button
            size="sm"
            variant={full.settings.external.enabled ? "danger" : "primary"}
            disabled={busy}
            onClick={() =>
              run(
                { op: "settings_save", leadDays, externalEnabled: !full.settings.external.enabled },
                "Saved.",
              )
            }
          >
            {full.settings.external.enabled
              ? "Turn external reminders off"
              : "Allow Slack reminders (approval-bound)"}
          </Button>
        ) : (
          <span className="text-xs text-[var(--acton-muted)]">
            Only the CEO or COO can turn external reminders on.
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--acton-muted)]">
        Headcount confirmed in Setup:{" "}
        {typeof full.headcount === "number" ? full.headcount : "not confirmed"}.
      </p>
    </Card>
  );
}
