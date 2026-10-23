"use client";

/**
 * Dexter, the reporting specialist, as a chat panel. Floating (bottom-right, expandable)
 * on a report, or inline on "Create with Dexter". Dexter answers and edits reports through
 * validated tools; report changes arrive as platform-verified artifacts.
 *
 * Attachments upload as soon as they're chosen (screenshots are analyzed once, server-side).
 * The plan panel shows Dexter's structured requirements and open questions for this thread.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Loader2,
  Maximize2,
  Minimize2,
  Paperclip,
  RotateCcw,
  Send,
  Target,
  X,
} from "lucide-react";
import { AgentAvatar, aiFetch, errorMessage, useLoad } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatArtifact, ChatMessage } from "./types";

const DEXTER_COLOR = "#0f766e";

const ACCEPT: Record<string, number> = {
  png: 5,
  jpg: 5,
  jpeg: 5,
  webp: 5,
  pdf: 20,
  csv: 10,
  xlsx: 10,
  docx: 10,
  txt: 2,
};
const MAX_FILES = 6;

type Pending = { requestId: string; steps: string[] };

export type ChatAttachment = {
  localId: string;
  id: string | null;
  filename: string;
  kind: string;
  sizeBytes: number;
  status: "uploading" | "processing" | "ready" | "failed" | "rejected";
  progress: number;
  error: string | null;
  previewUrl: string | null;
  summary: string | null;
};

type Question = {
  id: string;
  question: string;
  why?: string;
  options?: string[];
  status: "open" | "answered" | "dismissed";
  answer?: string;
};
type PlanItem = { title: string; kind?: string; status: string; note?: string };
export type Session = {
  title: string;
  status: string;
  requirements: {
    goal?: string;
    questions?: Question[];
    plan?: PlanItem[];
    assumptions?: Array<{ text: string; confirmed: boolean }>;
    feasibility?: string;
  };
} | null;

type ServerAttachment = {
  id: string;
  filename: string;
  kind: string;
  sizeBytes: number;
  status: string;
  error: string | null;
  summary: string | null;
};

const PLAN_TONES: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-800",
  done: "bg-emerald-50 text-emerald-800",
  building: "bg-sky-50 text-sky-800",
  awaiting_clarification: "bg-amber-50 text-amber-800",
  unavailable: "bg-red-50 text-red-800",
};
const PLAN_TEXT: Record<string, string> = {
  ready: "Ready",
  done: "Done",
  building: "Building",
  awaiting_clarification: "Needs your answer",
  unavailable: "Unavailable",
};

function fileExt(name: string) {
  return (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
}
function kindOf(ext: string) {
  return ["png", "jpg", "jpeg", "webp"].includes(ext)
    ? "image"
    : ext === "pdf"
      ? "pdf"
      : ["csv", "xlsx"].includes(ext)
        ? "spreadsheet"
        : ext === "docx"
          ? "document"
          : "text";
}
function prettySize(n: number) {
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Upload with progress (fetch has no upload progress). */
function uploadFile(
  file: File,
  reportId: string | null,
  onProgress: (p: number) => void,
): Promise<ServerAttachment & { status: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    if (reportId) form.append("reportId", reportId);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/reports/chat/attachments");
    xhr.upload.onprogress = (e) =>
      e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as {
          attachments?: Array<ServerAttachment & { status: string }>;
          error?: { message?: string };
        };
        if (xhr.status >= 400 || !body.attachments?.[0])
          reject(new Error(body.error?.message ?? "Upload failed."));
        else resolve(body.attachments[0]);
      } catch {
        reject(new Error("Upload failed."));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection."));
    xhr.send(form);
  });
}

function AttachmentChip({
  a,
  onRemove,
}: {
  a: Pick<
    ChatAttachment,
    "filename" | "kind" | "status" | "progress" | "error" | "previewUrl" | "sizeBytes"
  >;
  onRemove?: () => void;
}) {
  const Icon = a.kind === "spreadsheet" ? FileSpreadsheet : FileText;
  const failed = a.status === "failed" || a.status === "rejected";
  return (
    <div
      className={cn(
        "relative flex w-44 items-center gap-2 rounded-lg border bg-white p-1.5 text-xs",
        failed ? "border-red-300" : "border-[var(--acton-border)]",
      )}
      title={a.error ?? a.filename}
    >
      {a.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL / authorized file route
        <img src={a.previewUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[var(--acton-gray-50)]">
          <Icon className="h-4 w-4 text-[var(--acton-muted)]" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-[var(--acton-navy)]">{a.filename}</p>
        <p className={cn("truncate", failed ? "text-red-700" : "text-[var(--acton-muted)]")}>
          {a.status === "uploading"
            ? `Uploading ${a.progress}%`
            : a.status === "processing"
              ? "Reading…"
              : failed
                ? (a.error ?? "Couldn't read")
                : prettySize(a.sizeBytes)}
        </p>
      </div>
      {a.status === "uploading" || a.status === "processing" ? (
        <Loader2
          className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--acton-muted)]"
          aria-hidden
        />
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 rounded-full border border-[var(--acton-border)] bg-white p-0.5 text-[var(--acton-muted)] hover:text-red-700"
          aria-label={`Remove ${a.filename}`}
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function PlanPanel({
  session,
  disabled,
  onAnswer,
}: {
  session: NonNullable<Session>;
  disabled: boolean;
  onAnswer: (answers: Array<{ id: string; question: string; answer: string }>) => void;
}) {
  const [openPanel, setOpenPanel] = useState(true);
  const r = session.requirements;
  const openQuestions = (r.questions ?? []).filter((q) => q.status === "open");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  if (!r.goal && !r.plan?.length && !(r.questions ?? []).length) return null;
  const ready = openQuestions.filter((q) => answers[q.id]?.trim());
  return (
    <div className="border-b border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-4 py-2 text-xs">
      <button
        type="button"
        onClick={() => setOpenPanel((v) => !v)}
        className="flex w-full items-center justify-between gap-2 font-semibold text-[var(--acton-navy)]"
        aria-expanded={openPanel}
      >
        <span className="flex items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5" aria-hidden /> Plan
          {session.title && session.title !== "New report" ? `: ${session.title}` : ""}
          {openQuestions.length ? (
            <span className="rounded-full bg-amber-100 px-1.5 text-amber-800">
              {openQuestions.length} question{openQuestions.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </span>
        {openPanel ? (
          <ChevronUp className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
      {openPanel ? (
        <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
          {r.goal ? <p className="text-[var(--acton-navy)]">{r.goal}</p> : null}
          {r.plan?.length ? (
            <ul className="space-y-1">
              {r.plan.map((p, i) => (
                <li key={`${p.title}-${i}`} className="flex items-center justify-between gap-2">
                  <span className="truncate text-[var(--acton-navy)]" title={p.note}>
                    {p.title}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 font-semibold",
                      PLAN_TONES[p.status] ?? "bg-slate-100 text-slate-700",
                    )}
                  >
                    {PLAN_TEXT[p.status] ?? p.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {openQuestions.length ? (
            <div className="space-y-2">
              {openQuestions.map((q) => (
                <div key={q.id} className="rounded-md border border-amber-200 bg-white p-2">
                  <p className="font-medium text-[var(--acton-navy)]">{q.question}</p>
                  {q.why ? <p className="text-[var(--acton-muted)]">{q.why}</p> : null}
                  {q.options?.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {q.options.map((o) => (
                        <button
                          key={o}
                          type="button"
                          disabled={disabled}
                          onClick={() => setAnswers((a) => ({ ...a, [q.id]: o }))}
                          className={cn(
                            "rounded-full border px-2 py-0.5",
                            answers[q.id] === o
                              ? "border-[var(--acton-navy)] bg-[var(--acton-navy)] text-white"
                              : "border-[var(--acton-border)] text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
                          )}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <input
                    aria-label={`Answer: ${q.question}`}
                    value={answers[q.id] ?? ""}
                    disabled={disabled}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    placeholder={q.options?.length ? "Or type your own answer" : "Your answer"}
                    className="mt-1.5 h-8 w-full rounded border border-[var(--acton-border)] px-2"
                  />
                </div>
              ))}
              <Button
                size="sm"
                disabled={disabled || !ready.length}
                onClick={() => {
                  onAnswer(
                    ready.map((q) => ({
                      id: q.id,
                      question: q.question,
                      answer: answers[q.id]!.trim(),
                    })),
                  );
                  setAnswers({});
                }}
              >
                Send {ready.length > 1 ? `${ready.length} answers` : "answer"}
              </Button>
            </div>
          ) : null}
          {(r.questions ?? []).filter((q) => q.status === "answered").length ? (
            <details>
              <summary className="cursor-pointer text-[var(--acton-muted)]">
                Answered ({(r.questions ?? []).filter((q) => q.status === "answered").length})
              </summary>
              <ul className="mt-1 space-y-0.5">
                {(r.questions ?? [])
                  .filter((q) => q.status === "answered")
                  .map((q) => (
                    <li key={q.id} className="text-[var(--acton-muted)]">
                      {q.question} → <span className="text-[var(--acton-navy)]">{q.answer}</span>
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DexterChat({
  reportId,
  variant = "floating",
  canChat,
  blockedReason,
  suggestions = [],
  onArtifact,
  open: openProp,
  onOpenChange,
  avatarUrl = null,
  initialDraft = "",
  focus = null,
  onClearFocus,
}: {
  reportId: string | null;
  variant?: "floating" | "inline";
  canChat: boolean;
  /** When set, sending is paused with this explanation (e.g. unsaved layout edits). */
  blockedReason?: string | null;
  suggestions?: string[];
  onArtifact?: (artifact: ChatArtifact) => void;
  /** Optional controlled open state for the floating panel (e.g. "Ask Dexter to build it"). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Dexter's portrait (from AI Studio). */
  avatarUrl?: string | null;
  /** Prefilled message (e.g. from a suggested report). */
  initialDraft?: string;
  /** The widget the user asked about ("this chart"). */
  focus?: { widgetId: string; title: string } | null;
  onClearFocus?: () => void;
}) {
  const [openState, setOpenState] = useState(variant === "inline");
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [session, setSession] = useState<Session>(null);
  const [draft, setDraft] = useState(initialDraft);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!open) return;
    try {
      const res = await aiFetch<{ messages: ChatMessage[]; session: Session }>(
        `/api/reports/chat${reportId ? `?reportId=${reportId}` : ""}`,
      );
      setMessages(res.messages);
      setSession(res.session);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [open, reportId]);
  useLoad(load);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, pending]);

  // Poll the task's progress while Dexter works.
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(async () => {
      try {
        const p = await aiFetch<{ status: string; steps: string[] }>(
          `/api/reports/chat/progress?requestId=${pending.requestId}`,
        );
        setPending((cur) =>
          cur && cur.requestId === pending.requestId ? { ...cur, steps: p.steps } : cur,
        );
      } catch {
        // progress is best-effort
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [pending]);

  const patchAttachment = (localId: string, patch: Partial<ChatAttachment>) =>
    setAttachments((list) => list.map((a) => (a.localId === localId ? { ...a, ...patch } : a)));

  const addFiles = (files: File[]) => {
    setError(null);
    const room = MAX_FILES - attachments.length;
    if (files.length > room) setError(`Attach up to ${MAX_FILES} files per message.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      const ext = fileExt(file.name);
      const localId = crypto.randomUUID();
      const kind = kindOf(ext);
      const base: ChatAttachment = {
        localId,
        id: null,
        filename: file.name,
        kind,
        sizeBytes: file.size,
        status: "uploading",
        progress: 0,
        error: null,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : null,
        summary: null,
      };
      const limit = ACCEPT[ext];
      if (!limit) {
        setAttachments((l) => [
          ...l,
          { ...base, status: "rejected", error: `.${ext || "?"} isn't supported` },
        ]);
        continue;
      }
      if (file.size > limit * 1024 * 1024) {
        setAttachments((l) => [
          ...l,
          { ...base, status: "rejected", error: `Larger than ${limit} MB` },
        ]);
        continue;
      }
      setAttachments((l) => [...l, base]);
      uploadFile(file, reportId, (p) =>
        patchAttachment(localId, { progress: p, status: p >= 100 ? "processing" : "uploading" }),
      )
        .then((server) =>
          patchAttachment(localId, {
            id: server.id ?? null,
            status:
              server.status === "ready"
                ? "ready"
                : server.status === "rejected"
                  ? "rejected"
                  : "failed",
            error: server.error,
            summary: server.summary,
          }),
        )
        .catch((e: unknown) =>
          patchAttachment(localId, { status: "rejected", error: errorMessage(e) }),
        );
    }
  };

  const removeAttachment = (a: ChatAttachment) => {
    setAttachments((l) => l.filter((x) => x.localId !== a.localId));
    if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    if (a.id)
      void aiFetch(`/api/reports/chat/attachments?id=${a.id}`, { method: "DELETE" }).catch(
        () => undefined,
      );
  };

  const uploading = attachments.some((a) => a.status === "uploading" || a.status === "processing");

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || pending || blockedReason || uploading) return;
    const requestId = crypto.randomUUID();
    const sent = attachments.filter((a) => a.id && a.status !== "rejected");
    setDraft("");
    setError(null);
    const optimistic: ChatMessage = {
      id: `local-${requestId}`,
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
      artifacts: [],
      outcome: null,
      failed: false,
      attachments: sent.map((a) => ({
        id: a.id!,
        filename: a.filename,
        kind: a.kind,
        status: a.status,
      })),
    };
    setMessages((m) => [...m, optimistic]);
    setAttachments([]);
    setPending({ requestId, steps: [] });
    try {
      const res = await aiFetch<{ user: ChatMessage; reply: ChatMessage; session: Session }>(
        "/api/reports/chat",
        {
          method: "POST",
          body: JSON.stringify({
            reportId,
            message,
            requestId,
            attachmentIds: sent.map((a) => a.id),
            focusWidgetId: focus?.widgetId ?? null,
          }),
        },
      );
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), res.user, res.reply]);
      setSession(res.session);
      for (const a of res.reply.artifacts) onArtifact?.(a);
    } catch (e) {
      setError(errorMessage(e));
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setDraft(message);
      setAttachments(sent);
    } finally {
      setPending(null);
      inputRef.current?.focus();
    }
  };

  const answerQuestions = async (
    answers: Array<{ id: string; question: string; answer: string }>,
  ) => {
    try {
      const res = await aiFetch<{ session: Session }>("/api/reports/session", {
        method: "PATCH",
        body: JSON.stringify({
          reportId,
          answers: answers.map(({ id, answer }) => ({ id, answer })),
        }),
      });
      setSession(res.session);
    } catch {
      // The answers still go to Dexter in the message below.
    }
    await send(
      `Here are my answers:\n${answers.map((a) => `• ${a.question} → ${a.answer}`).join("\n")}`,
    );
  };

  const startOver = async () => {
    try {
      await aiFetch(`/api/reports/chat${reportId ? `?reportId=${reportId}` : ""}`, {
        method: "DELETE",
      });
      setMessages([]);
      setSession(null);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (variant === "floating" && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-30 inline-flex items-center gap-2 rounded-full bg-[var(--acton-navy)] py-2 pr-4 pl-2 text-sm font-semibold text-white shadow-lg hover:bg-[var(--acton-navy-dark)] focus-visible:ring-2 focus-visible:ring-[var(--acton-yellow)] focus-visible:outline-none print:hidden"
      >
        <AgentAvatar name="Dexter" url={avatarUrl} size={32} color={DEXTER_COLOR} />
        Ask Dexter
      </button>
    );
  }

  const disabledSend =
    !draft.trim() || Boolean(pending) || Boolean(blockedReason) || !canChat || uploading;

  return (
    <section
      aria-label="Chat with Dexter"
      onDragOver={(e) => {
        if (!canChat || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        if (!canChat) return;
        e.preventDefault();
        setDragging(false);
        addFiles([...e.dataTransfer.files]);
      }}
      className={cn(
        "relative flex flex-col overflow-hidden border border-[var(--acton-border)] bg-white print:hidden",
        variant === "floating"
          ? cn(
              "fixed z-30 shadow-2xl max-sm:inset-0 max-sm:rounded-none sm:right-5 sm:bottom-5 sm:rounded-xl",
              expanded
                ? "sm:h-[min(85vh,900px)] sm:w-[min(calc(100vw-2.5rem),760px)]"
                : "sm:h-[min(78vh,640px)] sm:w-[min(calc(100vw-2.5rem),420px)]",
            )
          : "h-[min(75vh,720px)] rounded-xl shadow-sm",
      )}
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-[var(--acton-navy)] bg-white/90 text-sm font-semibold text-[var(--acton-navy)]">
          Drop screenshots or files for Dexter
        </div>
      ) : null}
      <header className="flex items-center gap-3 border-b border-[var(--acton-border)] px-4 py-3">
        <AgentAvatar name="Dexter" url={avatarUrl} size={36} color={DEXTER_COLOR} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[var(--acton-navy)]">Dexter</p>
          <p className="truncate text-xs text-[var(--acton-muted)]">
            AI Reporting &amp; Data Analytics Specialist
          </p>
        </div>
        {messages.length && !pending ? (
          <button
            type="button"
            onClick={() => void startOver()}
            className="rounded p-1.5 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)]"
            aria-label="New conversation"
            title="New conversation"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        {variant === "floating" ? (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded p-1.5 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] max-sm:hidden"
              aria-label={expanded ? "Shrink chat" : "Expand chat"}
            >
              {expanded ? (
                <Minimize2 className="h-4 w-4" aria-hidden />
              ) : (
                <Maximize2 className="h-4 w-4" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1.5 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)]"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </>
        ) : null}
      </header>

      {session ? (
        <PlanPanel
          session={session}
          disabled={Boolean(pending) || !canChat}
          onAnswer={(a) => void answerQuestions(a)}
        />
      ) : null}

      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
        aria-live="polite"
      >
        {messages.length === 0 && !pending ? (
          <div className="space-y-3 text-sm text-[var(--acton-muted)]">
            <p>
              {reportId
                ? "Ask me about this report or tell me what to change — add a chart, filter to a phase, explain a number. You can attach screenshots too."
                : "Describe the report you need, or attach a screenshot of one you like. I'll check what JobTread actually has, ask about anything that matters, and build it."}
            </p>
            {suggestions.length ? (
              <div className="flex flex-col gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!canChat || Boolean(blockedReason)}
                    onClick={() => void send(s)}
                    className="rounded-lg border border-[var(--acton-border)] px-3 py-2 text-left text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)] disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex items-end gap-2",
              m.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            {m.role === "dexter" ? (
              <AgentAvatar name="Dexter" url={avatarUrl} size={24} color={DEXTER_COLOR} />
            ) : null}
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                m.role === "user"
                  ? "bg-[var(--acton-navy)] text-white"
                  : m.failed
                    ? "border border-red-200 bg-red-50 text-red-900"
                    : "bg-[var(--acton-gray-50)] text-[var(--acton-navy)]",
              )}
            >
              {m.attachments?.length ? (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {m.attachments.map((a) =>
                    a.kind === "image" && !a.id.startsWith("local") ? (
                      // eslint-disable-next-line @next/next/no-img-element -- authorized, owner-only file route
                      <img
                        key={a.id}
                        src={`/api/reports/chat/attachments/${a.id}`}
                        alt={a.filename}
                        className="h-16 max-w-[10rem] rounded border border-white/30 object-cover"
                      />
                    ) : (
                      <span
                        key={a.id}
                        className="inline-flex items-center gap-1 rounded bg-white/15 px-1.5 py-0.5 text-xs"
                      >
                        <FileText className="h-3 w-3" aria-hidden /> {a.filename}
                      </span>
                    ),
                  )}
                </div>
              ) : null}
              {m.content}
              {m.artifacts.map((a) => (
                <Link
                  key={`${a.id}-${a.version}`}
                  href={a.url}
                  className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--acton-border)] bg-white px-3 py-2 font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
                >
                  <BarChart3 className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{a.title}</span>
                  <span className="ml-auto shrink-0 text-xs font-normal text-[var(--acton-muted)]">
                    v{a.version}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
        {pending ? (
          <div className="flex items-end justify-start gap-2">
            <AgentAvatar name="Dexter" url={avatarUrl} size={24} color={DEXTER_COLOR} />
            <div className="max-w-[85%] rounded-2xl bg-[var(--acton-gray-50)] px-3.5 py-2 text-sm text-[var(--acton-navy)]">
              <p className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Dexter is working…
              </p>
              {pending.steps.length ? (
                <ul className="mt-1 list-disc pl-5 text-xs text-[var(--acton-muted)]">
                  {pending.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <form
        className="border-t border-[var(--acton-border)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        {error ? (
          <p className="mb-2 text-xs text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        {blockedReason ? <p className="mb-2 text-xs text-amber-800">{blockedReason}</p> : null}
        {!canChat ? (
          <p className="mb-2 text-xs text-[var(--acton-muted)]">
            Chatting with Dexter needs “Chat directly” access. Ask an administrator.
          </p>
        ) : null}
        {focus ? (
          <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-900">
            <Target className="h-3 w-3" aria-hidden /> About: {focus.title}
            <button
              type="button"
              onClick={onClearFocus}
              aria-label="Stop focusing on this widget"
              className="hover:text-red-700"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </p>
        ) : null}
        {attachments.length ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <AttachmentChip key={a.localId} a={a} onRemove={() => removeAttachment(a)} />
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={Object.keys(ACCEPT)
              .map((e) => `.${e}`)
              .join(",")}
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!canChat || attachments.length >= MAX_FILES}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--acton-border)] text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] hover:text-[var(--acton-navy)] disabled:opacity-50"
            aria-label="Attach screenshots or files"
            title="Attach screenshots, PDFs, spreadsheets (PNG, JPG, WebP, PDF, CSV, XLSX, DOCX, TXT)"
          >
            <Paperclip className="h-4 w-4" aria-hidden />
          </button>
          <label className="sr-only" htmlFor={`dexter-input-${variant}`}>
            Message Dexter
          </label>
          <textarea
            id={`dexter-input-${variant}`}
            ref={inputRef}
            rows={variant === "inline" ? 3 : 2}
            value={draft}
            disabled={!canChat}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            placeholder={
              reportId
                ? "Ask about or change this report…"
                : "e.g. Show active projects by phase and project manager"
            }
            className="block min-h-10 flex-1 resize-none rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm text-[var(--acton-navy)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none"
          />
          <Button
            type="submit"
            aria-label="Send"
            disabled={disabledSend}
            title={uploading ? "Waiting for attachments to finish" : undefined}
          >
            <Send className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </form>
    </section>
  );
}
