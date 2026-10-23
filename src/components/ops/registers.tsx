"use client";

/**
 * Register screens: documents, recruitment & interviews, surveys, timecards, contracts, insurance.
 * Each external effect (publishing, invitations, signature requests) is requested here and runs
 * only after CEO/COO approval.
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
import { cn } from "@/lib/utils";
import {
  PersonSelect,
  SectionHeader,
  StatusPill,
  Table,
  TonePill,
  dueLabel,
  formatDate,
  nameOf,
  td,
  useFullOps,
  type FullOpsState,
} from "./shared";

// ---------------------------------------------------------------------------
// Generic record form
// ---------------------------------------------------------------------------
type FieldSpec = {
  key: string;
  label: string;
  type?:
    "text" | "date" | "number" | "textarea" | "select" | "person" | "entity" | "checkbox" | "list";
  options?: Array<[string, string]>;
  help?: string;
  required?: boolean;
};

function RecordDialog({
  title,
  fields,
  initial,
  onSave,
  onClose,
  note,
}: {
  title: string;
  fields: FieldSpec[];
  initial: Record<string, unknown>;
  onSave: (values: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
  note?: React.ReactNode;
}) {
  const { full, busy } = useFullOps();
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const set = (k: string, v: unknown) => setValues((p) => ({ ...p, [k]: v }));
  return (
    <Dialog open onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogBody className="max-h-[68vh] space-y-4 overflow-y-auto">
        {note}
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => {
            const fid = `rec-${f.key}`;
            const v = values[f.key];
            const wide = f.type === "textarea";
            const control =
              f.type === "textarea" ? (
                <textarea
                  id={fid}
                  rows={5}
                  className={textareaClass}
                  value={String(v ?? "")}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              ) : f.type === "select" ? (
                <select
                  id={fid}
                  className={selectClass}
                  value={String(v ?? "")}
                  onChange={(e) => set(f.key, e.target.value)}
                >
                  {f.options?.map(([val, lab]) => (
                    <option key={val} value={val}>
                      {lab}
                    </option>
                  ))}
                </select>
              ) : f.type === "person" ? (
                <PersonSelect
                  id={fid}
                  profiles={full?.profiles ?? []}
                  value={(v as string) ?? null}
                  onChange={(x) => set(f.key, x)}
                />
              ) : f.type === "entity" ? (
                <select
                  id={fid}
                  className={selectClass}
                  value={String(v ?? "")}
                  onChange={(e) => set(f.key, e.target.value || null)}
                >
                  <option value="">Choose…</option>
                  {full?.entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              ) : f.type === "checkbox" ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    id={fid}
                    type="checkbox"
                    checked={Boolean(v)}
                    onChange={(e) => set(f.key, e.target.checked)}
                  />
                  {f.help}
                </label>
              ) : f.type === "list" ? (
                <Input
                  id={fid}
                  value={Array.isArray(v) ? v.join(", ") : String(v ?? "")}
                  onChange={(e) =>
                    set(
                      f.key,
                      e.target.value
                        .split(",")
                        .map((x) => Number(x.trim()))
                        .filter((n) => Number.isFinite(n)),
                    )
                  }
                />
              ) : (
                <Input
                  id={fid}
                  type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                  value={String(v ?? "")}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              );
            return (
              <div key={f.key} className={wide ? "sm:col-span-2" : undefined}>
                <Field
                  label={`${f.label}${f.required ? "" : f.type === "checkbox" ? "" : " (optional)"}`}
                  htmlFor={fid}
                  help={f.type === "checkbox" ? undefined : f.help}
                >
                  {control}
                </Field>
              </div>
            );
          })}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            if ((await onSave(values)) !== null) onClose();
          }}
        >
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

const entityName = (full: FullOpsState, id: string | null) =>
  full.entities.find((e) => e.id === id)?.name ?? "—";

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
export function DocumentsTab() {
  const { full, run, busy, reload } = useFullOps();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [q, setQ] = useState("");
  if (!full) return null;
  const docs = full.documents.filter(
    (d) => !q || `${d.title} ${d.category} ${d.filename}`.toLowerCase().includes(q.toLowerCase()),
  );
  const person = (id: string | null) => full.people.find((p) => p.id === id)?.full_name ?? "—";
  return (
    <div>
      <SectionHeader
        title="Documents"
        description="Private storage — every document belongs to a legal entity and an employee or contract. New uploads become new versions; nothing is overwritten. Downloads are logged."
        actions={
          <>
            <Input
              aria-label="Search documents"
              className="h-9 w-56"
              placeholder="Search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {full.access.canConfigure ? (
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <FileUp className="h-4 w-4" aria-hidden /> Upload
              </Button>
            ) : null}
          </>
        }
      />
      <Table
        head={["Document", "Category", "Employee / contract", "Entity", "Status", "Uploaded", ""]}
        empty="No documents yet."
      >
        {docs.map((d) => (
          <tr key={d.id}>
            <td className={td}>
              <a href={`/api/ops/documents/${d.id}`} className="font-medium underline">
                {d.title}
              </a>
              <span className="block text-xs text-[var(--acton-muted)]">
                v{d.version} · {(d.size_bytes / 1024).toFixed(0)} KB
                {d.drive_file_id ? " · filed in Drive" : ""}
              </span>
            </td>
            <td className={td}>{d.category}</td>
            <td className={td}>
              {d.person_id
                ? person(d.person_id)
                : d.contract_id
                  ? (full.contracts.find((c) => c.id === d.contract_id)?.title ?? "Contract")
                  : "—"}
            </td>
            <td className={td}>{entityName(full, d.entity_id)}</td>
            <td className={td}>
              <TonePill
                tone={
                  d.status === "verified" || d.status === "filed"
                    ? "green"
                    : d.status === "rejected"
                      ? "red"
                      : "gray"
                }
              >
                {d.status}
              </TonePill>
            </td>
            <td className={td}>{formatDateTime(d.created_at)}</td>
            <td className={td}>
              {full.access.canConfigure && d.status === "received" ? (
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(
                        { op: "document_status", documentId: d.id, status: "verified" },
                        "Marked verified.",
                      )
                    }
                  >
                    Verify
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      run(
                        { op: "document_status", documentId: d.id, status: "rejected" },
                        "Marked rejected.",
                      )
                    }
                  >
                    Reject
                  </Button>
                </span>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
      {uploadOpen ? <UploadDialog onClose={() => setUploadOpen(false)} onDone={reload} /> : null}
    </div>
  );
}

function UploadDialog({
  onClose,
  onDone,
  contractId,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
  contractId?: string;
}) {
  const { full } = useFullOps();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState(contractId ? "contract" : "");
  const [personId, setPersonId] = useState("");
  const [entityId, setEntityId] = useState(full?.entities[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function upload() {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    form.set("category", category);
    if (personId) form.set("personId", personId);
    if (entityId) form.set("entityId", entityId);
    if (contractId) form.set("contractId", contractId);
    try {
      await aiFetch("/api/ops/documents", { method: "POST", body: form });
      await onDone();
      onClose();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Upload a document</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {msg ? <Notice tone="error">{msg}</Notice> : null}
        <Field label="File" htmlFor="up-file" help="PDF, DOCX, PNG, JPG, or TXT up to 25 MB.">
          <input
            id="up-file"
            type="file"
            accept=".pdf,.docx,.png,.jpg,.jpeg,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <Field
          label="Category"
          htmlFor="up-cat"
          help="e.g. signed_offer_letter, i9, contract, insurance_certificate"
        >
          <Input id="up-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        {!contractId ? (
          <Field label="Employee" htmlFor="up-person">
            <select
              id="up-person"
              className={selectClass}
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
            >
              <option value="">Not about one employee</option>
              {full?.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Legal entity" htmlFor="up-entity">
          <select
            id="up-entity"
            className={selectClass}
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
          >
            {full?.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || !file || !category.trim()} onClick={upload}>
          {busy ? "Uploading…" : "Upload"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Recruitment & interviews
// ---------------------------------------------------------------------------
export function RecruitmentTab() {
  const { full, run, busy } = useFullOps();
  const [editVacancy, setEditVacancy] = useState<Record<string, unknown> | null>(null);
  const [newInterview, setNewInterview] = useState(false);
  const [slots, setSlots] = useState<{
    id: string;
    slots: Array<{ start: string; end: string }>;
    manual: string | null;
  } | null>(null);
  if (!full) return null;
  const tz = "America/Los_Angeles";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  return (
    <div className="space-y-8">
      <section>
        <SectionHeader
          title="Job listings"
          description="Sam drafts listings; the CEO or COO approves the exact text. BetterTeams has no supported API, so an approved listing becomes a manual publishing task — record the posting link when it's live."
          actions={
            full.access.canConfigure ? (
              <Button size="sm" onClick={() => setEditVacancy({})}>
                New listing
              </Button>
            ) : null
          }
        />
        <Table head={["Role", "Entity", "Status", "Posting", ""]} empty="No listings yet.">
          {full.vacancies.map((v) => (
            <tr key={v.id}>
              <td className={td}>
                <span className="font-medium">{v.title}</span>
                <span className="block text-xs text-[var(--acton-muted)]">
                  {[v.department, v.location].filter(Boolean).join(" · ")}
                </span>
              </td>
              <td className={td}>{entityName(full, v.entity_id)}</td>
              <td className={td}>
                <StatusPill status={v.status} />
              </td>
              <td className={td}>
                {v.posting_url ? (
                  <a
                    className="underline"
                    href={v.posting_url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    View posting
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td className={td}>
                <span className="flex flex-wrap gap-1">
                  {full.access.canConfigure && v.status === "draft" ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setEditVacancy(v)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          run(
                            { op: "vacancy_publish", vacancyId: v.id, mode: "live" },
                            "Sent for approval.",
                          )
                        }
                      >
                        Request publication
                      </Button>
                    </>
                  ) : null}
                  {full.access.canConfigure && v.status === "approved" ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        const url = window.prompt("Paste the BetterTeams posting link");
                        if (url)
                          void run(
                            { op: "vacancy_posted", vacancyId: v.id, postingUrl: url },
                            "Recorded as published.",
                          );
                      }}
                    >
                      Record posting link
                    </Button>
                  ) : null}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      </section>
      <section>
        <SectionHeader
          title="Interviews"
          description={`Sam proposes times from interviewers' calendars (when Google Calendar access is granted) and books the approved slot after re-checking conflicts. Times are shown in Pacific time.`}
          actions={
            full.access.canConfigure ? (
              <Button size="sm" onClick={() => setNewInterview(true)}>
                Schedule an interview
              </Button>
            ) : null
          }
        />
        <Table
          head={["Candidate", "Interviewers", "Status", "When", ""]}
          empty="No interviews yet."
        >
          {full.interviews.map((iv) => (
            <tr key={iv.id}>
              <td className={td}>
                <span className="font-medium">{iv.candidate_name}</span>
                <span className="block text-xs text-[var(--acton-muted)]">
                  {full.vacancies.find((v) => v.id === iv.vacancy_id)?.title ?? ""}
                </span>
              </td>
              <td className={td}>
                {iv.interviewer_profile_ids.map((id) => nameOf(full.profiles, id)).join(", ")}
              </td>
              <td className={td}>
                <StatusPill status={iv.status} />
              </td>
              <td className={td}>{iv.scheduled_start ? fmt(iv.scheduled_start) : "—"}</td>
              <td className={td}>
                {full.access.canConfigure && ["requested", "proposed"].includes(iv.status) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={async () =>
                      setSlots({
                        id: iv.id,
                        ...((await run<{
                          slots: Array<{ start: string; end: string }>;
                          manual: string | null;
                        }>({ op: "interview_slots", interviewId: iv.id, durationMinutes: 45 })) ?? {
                          slots: [],
                          manual: null,
                        }),
                      })
                    }
                  >
                    Find times
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </section>
      {slots ? (
        <Dialog open onClose={() => setSlots(null)}>
          <DialogHeader>
            <DialogTitle>Choose a time</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            {slots.manual ? <Notice tone="warning">{slots.manual}</Notice> : null}
            {slots.slots.map((s) => (
              <div
                key={s.start}
                className="flex items-center justify-between gap-2 rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm"
              >
                <span>{fmt(s.start)}</span>
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={async () =>
                      (await run(
                        {
                          op: "interview_book",
                          interviewId: slots.id,
                          start: s.start,
                          end: s.end,
                          calendarId: "primary",
                          mode: "test",
                        },
                        "Test invitation created.",
                      )) && setSlots(null)
                    }
                  >
                    Test
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={async () =>
                      (await run(
                        {
                          op: "interview_book",
                          interviewId: slots.id,
                          start: s.start,
                          end: s.end,
                          calendarId: "primary",
                          mode: "live",
                        },
                        "Invitation sent for approval.",
                      )) && setSlots(null)
                    }
                  >
                    Request invitation
                  </Button>
                </span>
              </div>
            ))}
            {slots.manual || !slots.slots.length ? (
              <ManualTime interviewId={slots.id} onDone={() => setSlots(null)} />
            ) : null}
          </DialogBody>
        </Dialog>
      ) : null}
      {editVacancy ? (
        <RecordDialog
          title={editVacancy.id ? "Edit listing" : "New job listing"}
          initial={editVacancy}
          fields={[
            { key: "title", label: "Job title", required: true },
            { key: "entity_id", label: "Legal entity", type: "entity", required: true },
            { key: "department", label: "Department" },
            { key: "location", label: "Location" },
            {
              key: "description",
              label: "Listing text",
              type: "textarea",
              required: true,
              help: "Exactly what will be published once approved.",
            },
          ]}
          onSave={(values) =>
            run({ op: "vacancy_save", id: editVacancy.id, values }, "Saved as a draft.")
          }
          onClose={() => setEditVacancy(null)}
        />
      ) : null}
      {newInterview ? <NewInterviewDialog onClose={() => setNewInterview(false)} /> : null}
    </div>
  );
}

function ManualTime({ interviewId, onDone }: { interviewId: string; onDone: () => void }) {
  const { run, busy } = useFullOps();
  const [start, setStart] = useState("");
  const [minutes, setMinutes] = useState(45);
  return (
    <div className="space-y-2 rounded-md bg-[var(--acton-gray-50)] p-3">
      <p className="text-sm font-semibold text-[var(--acton-navy)]">Record a time agreed by hand</p>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Start"
          type="datetime-local"
          className="w-56"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <Input
          aria-label="Minutes"
          type="number"
          className="w-24"
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
        />
        <Button
          size="sm"
          disabled={busy || !start}
          onClick={async () => {
            const s = new Date(start);
            if (
              (await run(
                {
                  op: "interview_record",
                  interviewId,
                  start: s.toISOString(),
                  end: new Date(s.getTime() + minutes * 60_000).toISOString(),
                },
                "Interview time recorded.",
              )) !== null
            )
              onDone();
          }}
        >
          Save time
        </Button>
      </div>
    </div>
  );
}

function NewInterviewDialog({ onClose }: { onClose: () => void }) {
  const { full, run, busy } = useFullOps();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [vacancyId, setVacancyId] = useState("");
  const [interviewers, setInterviewers] = useState<string[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Schedule an interview</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <Field label="Candidate" htmlFor="ni-name">
          <Input id="ni-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Candidate email (optional)" htmlFor="ni-email">
          <Input
            id="ni-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Listing (optional)" htmlFor="ni-vac">
          <select
            id="ni-vac"
            className={selectClass}
            value={vacancyId}
            onChange={(e) => setVacancyId(e.target.value)}
          >
            <option value="">None</option>
            {full?.vacancies.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Interviewers" htmlFor="ni-int">
          <div className="flex gap-2">
            <PersonSelect
              id="ni-int"
              profiles={full?.profiles ?? []}
              value={pick}
              onChange={setPick}
            />
            <Button
              variant="secondary"
              disabled={!pick}
              onClick={() =>
                pick && !interviewers.includes(pick) && setInterviewers([...interviewers, pick])
              }
            >
              Add
            </Button>
          </div>
          <p className="text-sm">
            {interviewers.map((i) => nameOf(full?.profiles, i)).join(", ") || "None yet"}
          </p>
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy || !name.trim() || !interviewers.length}
          onClick={async () =>
            (await run(
              {
                op: "interview_create",
                vacancyId: vacancyId || null,
                candidateName: name,
                candidateEmail: email,
                interviewerIds: interviewers,
              },
              "Interview request created.",
            )) && onClose()
          }
        >
          Create
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Surveys
// ---------------------------------------------------------------------------
type SurveyResults = {
  respondents: number;
  suppressed: boolean;
  overall: Record<string, { average: number | null; counts: Record<string, number> }>;
  groups: Array<{
    group: string;
    respondents: number;
    suppressed: boolean;
    averages: Record<string, number | null>;
  }>;
};

export function SurveysTab() {
  const { full, run, busy } = useFullOps();
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [resultsFor, setResultsFor] = useState<string | null>(null);
  if (!full) return null;
  return (
    <div>
      <SectionHeader
        title="Surveys"
        description="Surveys are approved by the CEO or COO before launch. Results are stored only as aggregates; any group smaller than the minimum size is hidden. No BambooHR survey API was found, so distribution is manual for now."
        actions={
          full.access.canConfigure ? (
            <Button
              size="sm"
              onClick={() =>
                setEdit({ confidentiality: "anonymous", min_group_size: 5, questions: [] })
              }
            >
              New survey
            </Button>
          ) : null
        }
      />
      <div className="grid gap-3 md:grid-cols-2">
        {full.surveys.length === 0 ? (
          <p className="text-sm text-[var(--acton-muted)]">No surveys yet.</p>
        ) : null}
        {full.surveys.map((s) => {
          const r = s.results as SurveyResults | null;
          return (
            <Card key={s.id} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>{s.title}</CardTitle>
                  <CardDescription>
                    {s.questions.length} questions · {s.confidentiality} · min group{" "}
                    {s.min_group_size}
                  </CardDescription>
                </div>
                <StatusPill status={s.status} />
              </div>
              {s.completed_count !== null ? (
                <p className="text-sm">
                  Response rate:{" "}
                  <strong>
                    {s.invited_count
                      ? Math.round(((s.completed_count ?? 0) / s.invited_count) * 100)
                      : 0}
                    %
                  </strong>{" "}
                  ({s.completed_count}/{s.invited_count})
                </p>
              ) : null}
              {r ? (
                r.suppressed ? (
                  <Notice tone="info">
                    Too few responses to show results without identifying people.
                  </Notice>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {Object.entries(r.overall).map(([k, v]) => (
                      <li key={k}>
                        <span className="text-[var(--acton-muted)]">
                          {s.questions.find((q) => q.key === k)?.text ?? k}:
                        </span>{" "}
                        {v.average ?? "—"}
                      </li>
                    ))}
                    {r.groups.filter((g) => g.suppressed).length ? (
                      <li className="text-xs text-[var(--acton-muted)]">
                        {r.groups.filter((g) => g.suppressed).length} group(s) hidden (below minimum
                        size).
                      </li>
                    ) : null}
                  </ul>
                )
              ) : null}
              <div className="flex flex-wrap gap-2">
                {full.access.canConfigure && s.status === "draft" ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setEdit(s)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run({ op: "survey_request", surveyId: s.id }, "Sent for approval.")
                      }
                    >
                      Request launch
                    </Button>
                  </>
                ) : null}
                {full.access.canConfigure && ["approved", "in_progress"].includes(s.status) ? (
                  <Button size="sm" onClick={() => setResultsFor(s.id)}>
                    Enter results
                  </Button>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
      {edit ? <SurveyDialog initial={edit} onClose={() => setEdit(null)} /> : null}
      {resultsFor ? (
        <ResultsDialog surveyId={resultsFor} onClose={() => setResultsFor(null)} />
      ) : null}
    </div>
  );
}

function SurveyDialog({
  initial,
  onClose,
}: {
  initial: Record<string, unknown>;
  onClose: () => void;
}) {
  const { run } = useFullOps();
  const qs = (initial.questions as Array<{ text: string; type: string }>) ?? [];
  return (
    <RecordDialog
      title={initial.id ? "Edit survey" : "New survey"}
      initial={{ ...initial, questionsText: qs.map((q) => q.text).join("\n") }}
      fields={[
        { key: "title", label: "Title", required: true },
        { key: "entity_id", label: "Legal entity", type: "entity" },
        { key: "purpose", label: "Purpose", type: "textarea" },
        { key: "audience", label: "Audience", help: "e.g. All field staff" },
        { key: "schedule", label: "Schedule", help: "e.g. Quarterly" },
        {
          key: "confidentiality",
          label: "Confidentiality",
          type: "select",
          options: [
            ["anonymous", "Anonymous"],
            ["confidential", "Confidential"],
            ["identified", "Identified"],
          ],
          required: true,
        },
        {
          key: "min_group_size",
          label: "Minimum group size for results",
          type: "number",
          required: true,
          help: "Groups smaller than this are never shown (at least 3).",
        },
        { key: "owner_profile_id", label: "Owner", type: "person" },
        {
          key: "questionsText",
          label: "Questions (one per line; rated 1–5)",
          type: "textarea",
          required: true,
        },
      ]}
      onSave={(v) =>
        run(
          {
            op: "survey_save",
            id: initial.id,
            values: {
              ...v,
              questions: String(v.questionsText ?? "")
                .split("\n")
                .map((t, i) => ({ key: `q${i + 1}`, text: t.trim(), type: "scale" }))
                .filter((q) => q.text),
            },
          },
          "Survey saved.",
        )
      }
      onClose={onClose}
    />
  );
}

function ResultsDialog({ surveyId, onClose }: { surveyId: string; onClose: () => void }) {
  const { run, busy } = useFullOps();
  const [invited, setInvited] = useState(0);
  const [csv, setCsv] = useState("");
  async function save() {
    // CSV: group,q1,q2,…  (one row per response; nothing identifying)
    const lines = csv.trim().split("\n").filter(Boolean);
    const [header, ...rows] = lines;
    const cols = (header ?? "").split(",").map((c) => c.trim());
    const responses = rows.map((r) => {
      const cells = r.split(",").map((c) => c.trim());
      return {
        group: cells[0] ?? "All",
        answers: Object.fromEntries(
          cols
            .slice(1)
            .map((c, i) => [
              c,
              Number.isFinite(Number(cells[i + 1])) && cells[i + 1] !== ""
                ? Number(cells[i + 1])
                : (cells[i + 1] ?? ""),
            ]),
        ),
      };
    });
    if (
      (await run(
        { op: "survey_results", surveyId, invited, responses },
        "Results aggregated. Raw responses were not stored.",
      )) !== null
    )
      onClose();
  }
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Enter survey results</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <Notice tone="info">
          Paste an export with a header row: group,q1,q2,… Include no names or emails. Sam
          aggregates immediately and discards the raw rows.
        </Notice>
        <Field label="People invited" htmlFor="sr-inv">
          <Input
            id="sr-inv"
            type="number"
            value={invited}
            onChange={(e) => setInvited(Number(e.target.value))}
          />
        </Field>
        <Field label="Responses (CSV)" htmlFor="sr-csv">
          <textarea
            id="sr-csv"
            rows={8}
            className={cn(textareaClass, "font-mono text-xs")}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={"group,q1,q2\nField,4,5\nOffice,3,4"}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || !csv.trim()} onClick={save}>
          Aggregate
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Timecards
// ---------------------------------------------------------------------------
export function TimecardsTab() {
  const { full, run, busy } = useFullOps();
  if (!full) return null;
  const jt = full.integrations.find((i) => i.key === "jobtread");
  const cutoff = full.decisions.find((d) => d.key === "timecard_cutoff");
  return (
    <div>
      <SectionHeader
        title="Timecards"
        description="Sam checks timecard completeness, follows up, and reports status to finance. Sam never approves, edits, or submits payroll."
        actions={
          full.access.canConfigure ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run({ op: "timecard_check" }, "Checked last week.")}
            >
              Check last week
            </Button>
          ) : null
        }
      />
      <div className="mb-4 space-y-2">
        <Notice tone="warning">
          {jt?.detail ?? "JobTread status unknown."} Until crews log time in JobTread, follow-ups
          are manual (use the “Weekly timecard follow-up” workflow).
        </Notice>
        {cutoff?.status !== "confirmed" ? (
          <Notice tone="info">
            The weekly cutoff, reminder schedule, and escalation policy haven&apos;t been confirmed
            (Setup tab), so Sam doesn&apos;t run automatic weekly checks yet.
          </Notice>
        ) : null}
      </div>
      <Table head={["Week", "Status", "Summary"]} empty="No checks yet.">
        {full.timecards.map((t) => (
          <tr key={t.id}>
            <td className={td}>
              {formatDate(t.period_start)} – {formatDate(t.period_end)}
            </td>
            <td className={td}>
              <TonePill
                tone={
                  t.status === "complete" ? "green" : t.status === "incomplete" ? "red" : "amber"
                }
              >
                {t.status === "unavailable" ? "No data" : t.status}
              </TonePill>
            </td>
            <td className={td}>{String((t.summary as { message?: string }).message ?? "")}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------
type Review = {
  disclaimer: string;
  dates: Array<{ label: string; value: string; quote: string }>;
  clauses: Array<{ topic: string; found: boolean; quote: string | null; attention: string }>;
  questions: string[];
};

export function ContractsTab() {
  const { full, run, busy, reload } = useFullOps();
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [editTemplate, setEditTemplate] = useState<Record<string, unknown> | null>(null);
  const [review, setReview] = useState<{ title: string; review: Review } | null>(null);
  const [upload, setUpload] = useState<string | null>(null);
  const [generate, setGenerate] = useState<string | null>(null);
  if (!full) return null;
  return (
    <div className="space-y-8">
      <section>
        <SectionHeader
          title="Contracts"
          description="Track every contract's dates, signature status, and renewals. Reminders run only for contracts whose dates have been verified by a person. Sam's review is a first pass for the owner — not legal advice."
          actions={
            full.access.canConfigure ? (
              <Button size="sm" onClick={() => setEdit({ reminder_days: [90, 60, 30, 7] })}>
                Add contract
              </Button>
            ) : null
          }
        />
        <Table
          head={["Contract", "Entity", "Status", "Key date", "Signature", ""]}
          empty="No contracts yet."
        >
          {full.contracts.map((c) => {
            const key = c.renewal_date ?? c.expiration_date;
            const due = key ? dueLabel(`${key}T17:00:00Z`) : null;
            return (
              <tr key={c.id}>
                <td className={td}>
                  <span className="font-medium">{c.title}</span>
                  <span className="block text-xs text-[var(--acton-muted)]">
                    {c.counterparty} · {c.contract_type}
                  </span>
                </td>
                <td className={td}>{entityName(full, c.entity_id)}</td>
                <td className={td}>
                  <TonePill
                    tone={
                      ["signed", "active"].includes(c.status)
                        ? "green"
                        : c.status === "expired"
                          ? "red"
                          : "gray"
                    }
                  >
                    {c.status.replace(/_/g, " ")}
                  </TonePill>
                </td>
                <td className={td}>
                  {key ? (
                    <>
                      {formatDate(key)}{" "}
                      <span
                        className={cn(
                          "block text-xs",
                          due?.overdue ? "text-red-700" : "text-[var(--acton-muted)]",
                        )}
                      >
                        {c.renewal_date ? "renewal" : "expires"} · {due?.text}
                      </span>
                      {!c.dates_verified ? <TonePill tone="amber">Unverified</TonePill> : null}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={td}>{c.signature_status ?? "—"}</td>
                <td className={td}>
                  {full.access.canConfigure ? (
                    <span className="flex flex-wrap gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setEdit(c)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setUpload(c.id)}>
                        Upload
                      </Button>
                      {c.document_id ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={async () => {
                            const r = await run<Review>({
                              op: "contract_review",
                              contractId: c.id,
                            });
                            if (r) setReview({ title: c.title, review: r });
                          }}
                        >
                          Review
                        </Button>
                      ) : null}
                      {c.document_id && ["draft", "in_review", "approved"].includes(c.status) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            const name = window.prompt("Signer's full name");
                            const email = name ? window.prompt("Signer's email") : null;
                            if (name && email)
                              void run(
                                {
                                  op: "contract_sign",
                                  contractId: c.id,
                                  signers: [{ name, email }],
                                  mode: "live",
                                },
                                "Signature request sent for CEO/COO approval.",
                              );
                          }}
                        >
                          Send for signature
                        </Button>
                      ) : null}
                      {c.review ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setReview({ title: c.title, review: c.review as unknown as Review })
                          }
                        >
                          Last review
                        </Button>
                      ) : null}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </Table>
      </section>
      <section>
        <SectionHeader
          title="Contract templates"
          description="Only templates approved by the CEO or COO can generate contracts. Editing an approved template creates a new draft version."
          actions={
            full.access.canConfigure ? (
              <Button size="sm" variant="secondary" onClick={() => setEditTemplate({})}>
                New template
              </Button>
            ) : null
          }
        />
        <Table
          head={["Template", "Type", "Version", "Status", "Merge fields", ""]}
          empty="No templates yet. Leadership supplies the approved contract versions."
        >
          {full.contractTemplates.map((t) => (
            <tr key={t.id}>
              <td className={td}>{t.name}</td>
              <td className={td}>{t.contract_type}</td>
              <td className={td}>v{t.version}</td>
              <td className={td}>
                <TonePill
                  tone={
                    t.status === "approved" ? "green" : t.status === "inactive" ? "gray" : "amber"
                  }
                >
                  {t.status}
                </TonePill>
              </td>
              <td className={td}>{t.merge_fields.join(", ") || "—"}</td>
              <td className={td}>
                {full.access.canConfigure ? (
                  <span className="flex flex-wrap gap-1">
                    {t.status !== "inactive" ? (
                      <Button size="sm" variant="secondary" onClick={() => setEditTemplate(t)}>
                        Edit
                      </Button>
                    ) : null}
                    {t.status === "draft" ? (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          run(
                            { op: "contract_template_approve", templateId: t.id },
                            "Sent for approval.",
                          )
                        }
                      >
                        Request approval
                      </Button>
                    ) : null}
                    {t.status === "approved" ? (
                      <Button size="sm" onClick={() => setGenerate(t.id)}>
                        Generate contract
                      </Button>
                    ) : null}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </section>
      {edit ? (
        <RecordDialog
          title={edit.id ? "Edit contract" : "Add contract"}
          initial={edit}
          fields={[
            { key: "title", label: "Title", required: true },
            { key: "counterparty", label: "Counterparty", required: true },
            {
              key: "contract_type",
              label: "Type",
              help: "e.g. Vendor, Lease, Employment, Subcontractor (review only)",
            },
            { key: "entity_id", label: "Legal entity", type: "entity", required: true },
            {
              key: "status",
              label: "Status",
              type: "select",
              required: true,
              options: [
                "draft",
                "in_review",
                "approved",
                "out_for_signature",
                "signed",
                "active",
                "expired",
                "terminated",
                "archived",
              ].map((s) => [s, s.replace(/_/g, " ")]),
            },
            { key: "owner_profile_id", label: "Owner", type: "person" },
            { key: "effective_date", label: "Effective date", type: "date" },
            { key: "expiration_date", label: "Expiration date", type: "date" },
            { key: "renewal_date", label: "Renewal date", type: "date" },
            { key: "notice_days", label: "Notice period (days)", type: "number" },
            {
              key: "reminder_days",
              label: "Remind at (days before)",
              type: "list",
              help: "e.g. 90, 60, 30, 7",
            },
            {
              key: "dates_verified",
              label: "Dates verified",
              type: "checkbox",
              help: "I checked these dates against the signed contract.",
            },
            { key: "notes", label: "Notes", type: "textarea" },
          ]}
          onSave={(values) => run({ op: "contract_save", id: edit.id, values }, "Contract saved.")}
          onClose={() => setEdit(null)}
        />
      ) : null}
      {editTemplate ? (
        <RecordDialog
          title={editTemplate.id ? "Edit template" : "New contract template"}
          initial={editTemplate}
          note={
            <Notice tone="info">
              Use {"{{merge_field}}"} placeholders, e.g. {"{{counterparty_name}}"}. A contract can
              only be generated when every field is filled in.
            </Notice>
          }
          fields={[
            { key: "name", label: "Name", required: true },
            { key: "contract_type", label: "Type", required: true },
            { key: "entity_id", label: "Legal entity", type: "entity" },
            { key: "review_owner_profile_id", label: "Review owner", type: "person" },
            { key: "body", label: "Template text", type: "textarea", required: true },
          ]}
          onSave={(values) =>
            run(
              { op: "contract_template_save", id: editTemplate.id, values },
              "Template saved as a draft.",
            )
          }
          onClose={() => setEditTemplate(null)}
        />
      ) : null}
      {generate ? <GenerateDialog templateId={generate} onClose={() => setGenerate(null)} /> : null}
      {upload ? (
        <UploadDialog contractId={upload} onDone={reload} onClose={() => setUpload(null)} />
      ) : null}
      {review ? (
        <Dialog open onClose={() => setReview(null)} size="lg">
          <DialogHeader>
            <DialogTitle>First-pass review: {review.title}</DialogTitle>
          </DialogHeader>
          <DialogBody className="max-h-[68vh] space-y-4 overflow-y-auto text-sm">
            <Notice tone="warning">{review.review.disclaimer}</Notice>
            <section>
              <h3 className="font-semibold text-[var(--acton-navy)]">Dates found</h3>
              {review.review.dates.length ? (
                <ul className="mt-1 space-y-1">
                  {review.review.dates.map((d, i) => (
                    <li key={i}>
                      <strong>{d.label}:</strong> {d.value}{" "}
                      <span className="block text-xs text-[var(--acton-muted)]">“{d.quote}”</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[var(--acton-muted)]">None found.</p>
              )}
            </section>
            <section>
              <h3 className="font-semibold text-[var(--acton-navy)]">Key terms</h3>
              <ul className="mt-1 space-y-2">
                {review.review.clauses.map((c) => (
                  <li key={c.topic}>
                    <strong>{c.topic}</strong>{" "}
                    {c.found ? (
                      <TonePill tone="green">found</TonePill>
                    ) : (
                      <TonePill tone="amber">not found</TonePill>
                    )}
                    {c.quote ? (
                      <span className="block text-xs text-[var(--acton-muted)]">“{c.quote}”</span>
                    ) : null}
                    <span className="block text-xs">{c.attention}</span>
                  </li>
                ))}
              </ul>
            </section>
            {review.review.questions.length ? (
              <section>
                <h3 className="font-semibold text-[var(--acton-navy)]">Questions for the owner</h3>
                <ul className="mt-1 list-disc pl-5">
                  {review.review.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </DialogBody>
        </Dialog>
      ) : null}
    </div>
  );
}

function GenerateDialog({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const { full, run, busy } = useFullOps();
  const t = full?.contractTemplates.find((x) => x.id === templateId);
  const [values, setValues] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [entityId, setEntityId] = useState(t?.entity_id ?? full?.entities[0]?.id ?? "");
  if (!t) return null;
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Generate from {t.name}</DialogTitle>
      </DialogHeader>
      <DialogBody className="max-h-[68vh] space-y-3 overflow-y-auto">
        <Field label="Contract title" htmlFor="gen-title">
          <Input id="gen-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Counterparty" htmlFor="gen-cp">
          <Input
            id="gen-cp"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
          />
        </Field>
        <Field label="Legal entity" htmlFor="gen-ent">
          <select
            id="gen-ent"
            className={selectClass}
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
          >
            {full?.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        {t.merge_fields.map((f) => (
          <Field key={f} label={f.replace(/_/g, " ")} htmlFor={`gen-${f}`}>
            <Input
              id={`gen-${f}`}
              value={values[f] ?? ""}
              onChange={(e) => setValues((p) => ({ ...p, [f]: e.target.value }))}
            />
          </Field>
        ))}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={async () =>
            (await run(
              {
                op: "contract_generate",
                templateId,
                values,
                counterparty,
                title,
                entityId: entityId || null,
              },
              "Draft contract generated.",
            )) && onClose()
          }
        >
          Generate draft
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Insurance
// ---------------------------------------------------------------------------
export function InsuranceTab() {
  const { full, run } = useFullOps();
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  if (!full) return null;
  return (
    <div>
      <SectionHeader
        title="Insurance"
        description="Policy inventory with renewal reminders to each policy's owner (and the CEO/COO at the final threshold). Premium payments are finance tasks."
        actions={
          full.access.canConfigure ? (
            <Button
              size="sm"
              onClick={() => setEdit({ reminder_days: [90, 60, 30, 7], status: "active" })}
            >
              Add policy
            </Button>
          ) : null
        }
      />
      <Table
        head={["Coverage", "Insurer", "Entity", "Renewal", "Owner", "Status", ""]}
        empty="No policies yet. Leadership supplies the insurance inventory."
      >
        {full.insurance.map((p) => {
          const date = p.renewal_date ?? p.expiration_date;
          const due = date ? dueLabel(`${date}T17:00:00Z`) : null;
          return (
            <tr key={p.id}>
              <td className={td}>
                <span className="font-medium">{p.category}</span>
                <span className="block text-xs text-[var(--acton-muted)]">
                  {p.policy_number ?? ""}
                </span>
              </td>
              <td className={td}>{p.insurer}</td>
              <td className={td}>{entityName(full, p.entity_id)}</td>
              <td className={td}>
                {formatDate(date)}
                {due ? (
                  <span
                    className={cn(
                      "block text-xs",
                      due.overdue ? "text-red-700" : "text-[var(--acton-muted)]",
                    )}
                  >
                    {due.text}
                  </span>
                ) : null}
              </td>
              <td className={td}>{nameOf(full.profiles, p.owner_profile_id)}</td>
              <td className={td}>
                <TonePill
                  tone={
                    p.status === "active" || p.status === "renewed"
                      ? "green"
                      : p.status === "expired"
                        ? "red"
                        : "amber"
                  }
                >
                  {p.status}
                </TonePill>
              </td>
              <td className={td}>
                {full.access.canConfigure ? (
                  <Button size="sm" variant="secondary" onClick={() => setEdit(p)}>
                    Edit
                  </Button>
                ) : null}
              </td>
            </tr>
          );
        })}
      </Table>
      {edit ? (
        <RecordDialog
          title={edit.id ? "Edit policy" : "Add policy"}
          initial={edit}
          fields={[
            {
              key: "category",
              label: "Coverage",
              required: true,
              help: "e.g. General liability, Workers' comp, Auto",
            },
            { key: "insurer", label: "Insurer", required: true },
            { key: "policy_number", label: "Policy number" },
            { key: "entity_id", label: "Legal entity", type: "entity", required: true },
            { key: "owner_profile_id", label: "Renewal owner", type: "person" },
            {
              key: "status",
              label: "Status",
              type: "select",
              required: true,
              options: ["active", "renewing", "renewed", "expired", "cancelled"].map((s) => [s, s]),
            },
            { key: "effective_date", label: "Effective date", type: "date" },
            { key: "renewal_date", label: "Renewal date", type: "date" },
            { key: "expiration_date", label: "Expiration date", type: "date" },
            { key: "reminder_days", label: "Remind at (days before)", type: "list" },
            { key: "notes", label: "Notes", type: "textarea" },
          ]}
          onSave={(values) => run({ op: "insurance_save", id: edit.id, values }, "Policy saved.")}
          onClose={() => setEdit(null)}
        />
      ) : null}
    </div>
  );
}
