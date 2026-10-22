"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AgentAvatar,
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

type Approval = {
  id: string;
  taskId: string | null;
  agentName: string;
  avatarUrl: string | null;
  actionType: string;
  actionLabel: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  status: string;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
};

function ApprovalCard({ approval, onDecided }: { approval: Approval; onDecided: () => void }) {
  const isDraft = approval.actionType === "employee_communication";
  const [subject, setSubject] = useState(String(approval.payload.subject ?? ""));
  const [body, setBody] = useState(String(approval.payload.body ?? ""));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pending = approval.status === "pending";

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      await aiFetch(`/api/ai/approvals/${approval.id}`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          note: note || null,
          ...(isDraft ? { subject, body } : {}),
        }),
      });
      onDecided();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <AgentAvatar name={approval.agentName} url={approval.avatarUrl} size={36} />
          <div>
            <p className="font-semibold text-[var(--acton-navy)]">{approval.title}</p>
            <p className="text-xs text-[var(--acton-muted)]">
              {approval.actionLabel} from {approval.agentName} ·{" "}
              {formatDateTime(approval.createdAt)}
              {approval.taskId ? (
                <>
                  {" · "}
                  <Link className="underline" href={`/ai/tasks/${approval.taskId}`}>
                    task
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <Pill
          className={
            pending
              ? "bg-violet-100 text-violet-900"
              : approval.status === "approved"
                ? "bg-emerald-100 text-emerald-900"
                : "bg-slate-100 text-slate-700"
          }
        >
          {pending ? "Waiting for review" : approval.status}
        </Pill>
      </div>
      <p className="text-sm text-[var(--acton-navy)]">{approval.summary}</p>
      {isDraft ? (
        <div className="space-y-3 rounded-md border border-[var(--acton-border)] p-3">
          <p className="text-xs text-[var(--acton-muted)]">
            For: {String(approval.payload.recipientDescription ?? "—")}
          </p>
          <Field label="Subject">
            <Input
              value={subject}
              readOnly={!pending}
              onChange={(e) => setSubject(e.target.value)}
            />
          </Field>
          <Field label="Message">
            <textarea
              className={textareaClass}
              rows={8}
              value={body}
              readOnly={!pending}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={async () => {
              await navigator.clipboard.writeText(`${subject}\n\n${body}`);
              setCopied(true);
            }}
          >
            <Copy className="h-4 w-4" /> {copied ? "Copied" : "Copy text"}
          </Button>
        </div>
      ) : approval.payload.reason ? (
        <p className="text-sm">
          <b>Reason:</b> {String(approval.payload.reason)}
        </p>
      ) : null}
      {pending ? (
        <>
          <Field label="Note (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {isDraft ? (
            <Notice>
              Approving marks the draft as ready. Baxter does not send email yet — copy the text and
              send it yourself.
            </Notice>
          ) : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="flex gap-2">
            <Button type="button" onClick={() => decide("approved")} disabled={busy}>
              <Check className="h-4 w-4" /> {isDraft ? "Approve draft" : "Mark reviewed"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => decide("rejected")}
              disabled={busy}
            >
              <X className="h-4 w-4" /> Reject
            </Button>
          </div>
        </>
      ) : approval.decisionNote ? (
        <p className="text-sm text-[var(--acton-muted)]">Note: {approval.decisionNote}</p>
      ) : null}
    </Card>
  );
}

export function ApprovalsQueue() {
  const [status, setStatus] = useState("pending");
  const [data, setData] = useState<{ approvals: Approval[]; canApprove: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await aiFetch(`/api/ai/approvals?status=${status}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [status]);
  useLoad(load);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <div className="h-40 animate-pulse rounded-lg bg-[var(--acton-gray-100)]" />;
  if (!data.canApprove) return <Notice>You don&apos;t have approval access for any agent.</Notice>;
  return (
    <div className="space-y-4">
      <select
        aria-label="Show"
        className={`${selectClass} sm:w-56`}
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="pending">Waiting for review</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
      </select>
      {data.approvals.length === 0 ? (
        <EmptyState title={status === "pending" ? "Nothing waiting for review" : "Nothing here"}>
          When an agent drafts an employee communication or flags something for a person, it appears
          here. Nothing is sent without review.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {data.approvals.map((a) => (
            <ApprovalCard key={a.id} approval={a} onDecided={load} />
          ))}
        </div>
      )}
    </div>
  );
}
