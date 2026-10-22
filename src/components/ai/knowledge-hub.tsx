"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Archive, Download, FileText, RefreshCw, Search, Trash2, Upload } from "lucide-react";
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

type Doc = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  sensitivity: "internal" | "confidential" | "restricted";
  status: "processing" | "ready" | "failed" | "archived";
  filename: string | null;
  size_bytes: number | null;
  chunk_count: number;
  index_error: string | null;
  version: number;
  updated_at: string;
  created_at: string;
  agentIds: string[];
};

type HubData = {
  canManage: boolean;
  agents: Array<{ id: string; slug: string; name: string }>;
  categories: Array<{ slug: string; label: string }>;
  documents: Doc[];
};

const SENSITIVITY = {
  internal: {
    label: "Internal",
    help: "Anyone who can use the agent",
    tone: "bg-slate-100 text-slate-700",
  },
  confidential: {
    label: "Confidential",
    help: "Agent users; kept out of public channels",
    tone: "bg-amber-100 text-amber-900",
  },
  restricted: {
    label: "Restricted",
    help: "Only people granted restricted-document access",
    tone: "bg-red-100 text-red-800",
  },
};

const STATUS = {
  processing: { label: "Indexing…", tone: "bg-sky-100 text-sky-900" },
  ready: { label: "Ready", tone: "bg-emerald-100 text-emerald-900" },
  failed: { label: "Couldn't read", tone: "bg-red-100 text-red-800" },
  archived: { label: "Archived", tone: "bg-slate-200 text-slate-600" },
};

function UploadDialog({
  open,
  onClose,
  data,
  replacing,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  data: HubData;
  replacing: Doc | null;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(replacing?.title ?? "");
  const [description, setDescription] = useState(replacing?.description ?? "");
  const [category, setCategory] = useState(replacing?.category ?? "onboarding");
  const [sensitivity, setSensitivity] = useState<Doc["sensitivity"]>(
    replacing?.sensitivity ?? "confidential",
  );
  const [agentIds, setAgentIds] = useState<string[]>(
    replacing?.agentIds ??
      (data.agents[0] ? [data.agents.find((a) => a.slug === "sam")?.id ?? data.agents[0].id] : []),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file) return setError("Choose a file.");
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", title || file.name.replace(/\.[^.]+$/, ""));
      form.append("description", description);
      form.append("category", category);
      form.append("sensitivity", sensitivity);
      agentIds.forEach((id) => form.append("agentIds", id));
      if (replacing) form.append("replacesDocumentId", replacing.id);
      const res = await aiFetch<{ document: Doc }>("/api/ai/knowledge", {
        method: "POST",
        body: form,
      });
      if (res.document.status === "failed") {
        setError(
          `Uploaded, but the text couldn't be read: ${res.document.index_error ?? "unknown error"}`,
        );
      } else {
        onUploaded();
        onClose();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>
          {replacing ? `Replace “${replacing.title}”` : "Upload an approved document"}
        </DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <Notice>
            Only upload approved Acton ADU documents. Agents treat document text as information,
            never as instructions. Don&apos;t upload real employee records (SSNs, pay, medical
            details).
          </Notice>
          <Field
            label="File"
            help="PDF, Word (.docx), Markdown, text, CSV, or Excel — up to 25 MB."
          >
            <input
              type="file"
              accept=".pdf,.docx,.md,.txt,.csv,.xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. New Hire Onboarding SOP"
              />
            </Field>
            <Field label="Category">
              <select
                className={selectClass}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {data.categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Description (optional)">
            <textarea
              className={textareaClass}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Who may see answers from this document">
            <div className="space-y-2">
              {(Object.keys(SENSITIVITY) as Array<Doc["sensitivity"]>).map((s) => (
                <label key={s} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="sensitivity"
                    className="mt-1"
                    checked={sensitivity === s}
                    onChange={() => setSensitivity(s)}
                  />
                  <span>
                    <b>{SENSITIVITY[s].label}</b> —{" "}
                    <span className="text-[var(--acton-muted)]">{SENSITIVITY[s].help}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Which agents use it">
            <div className="flex flex-wrap gap-3">
              {data.agents.map((a) => (
                <label key={a.id} className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={agentIds.includes(a.id)}
                    onChange={(e) =>
                      setAgentIds(
                        e.target.checked ? [...agentIds, a.id] : agentIds.filter((x) => x !== a.id),
                      )
                    }
                  />
                  {a.name}
                </label>
              ))}
            </div>
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={busy || !file || agentIds.length === 0}>
          {busy ? "Uploading and indexing…" : replacing ? "Replace" : "Upload"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

type Preview = {
  document: Doc;
  canManage: boolean;
  preview: Array<{ ordinal: number; heading: string | null; content: string }>;
};

export function KnowledgeHub({ isAdmin }: { isAdmin: boolean }) {
  const search = useSearchParams();
  const [data, setData] = useState<HubData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState({ q: "", category: "all", showArchived: false });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [replacing, setReplacing] = useState<Doc | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [deleting, setDeleting] = useState<Doc | null>(null);
  const [probe, setProbe] = useState({ agent: "", q: "" });
  const [probeResult, setProbeResult] = useState<{
    hits: Array<{ documentTitle: string; heading: string | null; excerpt: string; score: number }>;
    searchedDocuments: number;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(
        await aiFetch<HubData>(`/api/ai/knowledge${filter.showArchived ? "?archived=1" : ""}`),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [filter.showArchived]);

  useLoad(load);

  const openPreview = useCallback(async (id: string) => {
    try {
      setPreview(await aiFetch<Preview>(`/api/ai/knowledge/${id}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const documentParam = search.get("document");
  useLoad(
    useCallback(async () => {
      if (documentParam) await openPreview(documentParam);
    }, [documentParam, openPreview]),
  );

  const docs = useMemo(
    () =>
      (data?.documents ?? []).filter(
        (d) =>
          (filter.category === "all" || d.category === filter.category) &&
          (!filter.q ||
            `${d.title} ${d.description ?? ""} ${d.filename ?? ""}`
              .toLowerCase()
              .includes(filter.q.toLowerCase())),
      ),
    [data, filter],
  );

  async function archive(doc: Doc, status: "archived" | "ready") {
    try {
      await aiFetch(`/api/ai/knowledge/${doc.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      await aiFetch(`/api/ai/knowledge/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function runProbe() {
    try {
      setProbeResult(
        await aiFetch(
          `/api/ai/knowledge/search?agent=${encodeURIComponent(probe.agent || data?.agents[0]?.slug || "")}&q=${encodeURIComponent(probe.q)}`,
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (error && !data) return <Notice tone="error">{error}</Notice>;
  if (!data) return <div className="h-64 animate-pulse rounded-lg bg-[var(--acton-gray-100)]" />;

  const agentName = (id: string) => data.agents.find((a) => a.id === id)?.name ?? "Agent";

  return (
    <div className="space-y-6">
      {preview ? null : error ? <Notice tone="error">{error}</Notice> : null}
      {!data.canManage ? (
        <Notice>
          You don&apos;t manage any agents, so there are no documents to manage here. Documents
          cited in an answer you received can still be opened from that answer.
        </Notice>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="relative flex-1">
              <span className="sr-only">Search documents</span>
              <Search
                className="absolute top-3.5 left-3 h-4 w-4 text-[var(--acton-muted)]"
                aria-hidden
              />
              <Input
                className="pl-9"
                placeholder="Search titles and descriptions"
                value={filter.q}
                onChange={(e) => setFilter({ ...filter, q: e.target.value })}
              />
            </label>
            <select
              aria-label="Category"
              className={cn(selectClass, "sm:w-52")}
              value={filter.category}
              onChange={(e) => setFilter({ ...filter, category: e.target.value })}
            >
              <option value="all">All categories</option>
              {data.categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </select>
            <label className="inline-flex h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filter.showArchived}
                onChange={(e) => setFilter({ ...filter, showArchived: e.target.checked })}
              />
              Show archived
            </label>
            <Button
              type="button"
              onClick={() => {
                setReplacing(null);
                setUploadOpen(true);
              }}
            >
              <Upload className="h-4 w-4" /> Upload
            </Button>
          </div>

          {docs.length === 0 ? (
            <EmptyState
              title="No approved documents yet"
              action={
                <Button type="button" onClick={() => setUploadOpen(true)}>
                  <Upload className="h-4 w-4" /> Upload the first document
                </Button>
              }
            >
              Sam answers HR questions only from documents uploaded here. Until Acton ADU&apos;s
              SOPs and policies are added, Sam will say the information is missing rather than
              guess.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--acton-border)] bg-white">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-[var(--acton-gray-50)] text-xs text-[var(--acton-muted)] uppercase">
                  <tr>
                    <th className="px-4 py-2">Document</th>
                    <th className="px-4 py-2">Category</th>
                    <th className="px-4 py-2">Visibility</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Agents</th>
                    <th className="px-4 py-2">Updated</th>
                    <th className="px-4 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id} className="border-t border-[var(--acton-border)] align-top">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openPreview(d.id)}
                          className="flex items-start gap-2 text-left font-semibold text-[var(--acton-navy)] hover:underline"
                        >
                          <FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                          <span>
                            {d.title}
                            <span className="block text-xs font-normal text-[var(--acton-muted)]">
                              {d.filename} · v{d.version} · {d.chunk_count} passages
                            </span>
                          </span>
                        </button>
                        {d.index_error ? (
                          <p className="mt-1 text-xs text-amber-800">{d.index_error}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {data.categories.find((c) => c.slug === d.category)?.label ?? d.category}
                      </td>
                      <td className="px-4 py-3">
                        <Pill className={SENSITIVITY[d.sensitivity].tone}>
                          {SENSITIVITY[d.sensitivity].label}
                        </Pill>
                      </td>
                      <td className="px-4 py-3">
                        <Pill className={STATUS[d.status].tone}>{STATUS[d.status].label}</Pill>
                      </td>
                      <td className="px-4 py-3">{d.agentIds.map(agentName).join(", ")}</td>
                      <td className="px-4 py-3 text-[var(--acton-muted)]">
                        {formatDateTime(d.updated_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setReplacing(d);
                              setUploadOpen(true);
                            }}
                            aria-label={`Replace ${d.title}`}
                            title="Replace with a new version"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              archive(d, d.status === "archived" ? "ready" : "archived")
                            }
                            aria-label={
                              d.status === "archived" ? `Restore ${d.title}` : `Archive ${d.title}`
                            }
                            title={d.status === "archived" ? "Restore" : "Archive"}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                          {isAdmin ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleting(d)}
                              aria-label={`Delete ${d.title}`}
                              title="Delete permanently"
                            >
                              <Trash2 className="h-4 w-4 text-red-700" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Card className="space-y-3">
            <CardTitle>See what an agent would find</CardTitle>
            <CardDescription>
              Searches exactly the documents the agent can use, with your access level.
            </CardDescription>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                aria-label="Agent"
                className={cn(selectClass, "sm:w-48")}
                value={probe.agent}
                onChange={(e) => setProbe({ ...probe, agent: e.target.value })}
              >
                {data.agents.map((a) => (
                  <option key={a.id} value={a.slug}>
                    {a.name}
                  </option>
                ))}
              </select>
              <Input
                value={probe.q}
                onChange={(e) => setProbe({ ...probe, q: e.target.value })}
                placeholder="e.g. what forms does a new hire complete"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={runProbe}
                disabled={probe.q.trim().length < 2}
              >
                Search
              </Button>
            </div>
            {probeResult ? (
              probeResult.hits.length === 0 ? (
                <p className="text-sm text-[var(--acton-muted)]">
                  No matching passages in {probeResult.searchedDocuments} document(s).
                </p>
              ) : (
                <ul className="space-y-2">
                  {probeResult.hits.map((h, i) => (
                    <li
                      key={i}
                      className="rounded-md border border-[var(--acton-border)] p-3 text-sm"
                    >
                      <p className="font-semibold text-[var(--acton-navy)]">
                        {h.documentTitle}
                        {h.heading ? ` › ${h.heading}` : ""}{" "}
                        <span className="text-xs font-normal text-[var(--acton-muted)]">
                          relevance {h.score}
                        </span>
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-[var(--acton-muted)]">
                        {h.excerpt}
                      </p>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </Card>
        </>
      )}

      {uploadOpen ? (
        <UploadDialog
          open
          data={data}
          replacing={replacing}
          onClose={() => setUploadOpen(false)}
          onUploaded={load}
        />
      ) : null}
      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} size="lg">
        <DialogHeader>
          <DialogTitle>{preview?.document.title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {preview ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs text-[var(--acton-muted)]">
                <Pill className={SENSITIVITY[preview.document.sensitivity].tone}>
                  {SENSITIVITY[preview.document.sensitivity].label}
                </Pill>
                <span>{preview.document.filename}</span>
                <span>Version {preview.document.version}</span>
                <span>Updated {formatDateTime(preview.document.updated_at)}</span>
              </div>
              {preview.document.description ? (
                <p className="text-sm">{preview.document.description}</p>
              ) : null}
              <div className="max-h-[50vh] space-y-3 overflow-y-auto rounded-md bg-[var(--acton-gray-50)] p-3">
                {preview.preview.map((c) => (
                  <div key={c.ordinal}>
                    {c.heading ? <p className="text-sm font-semibold">{c.heading}</p> : null}
                    <p className="text-sm whitespace-pre-wrap">
                      {c.content.replace(/^Document: .*\n(Section: .*\n)?\n?/u, "")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {preview ? (
            <a
              href={`/api/ai/knowledge/${preview.document.id}/download`}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--acton-border)] px-4 text-sm font-semibold text-[var(--acton-navy)]"
            >
              <Download className="h-4 w-4" /> Original file
            </a>
          ) : null}
          <Button type="button" variant="secondary" onClick={() => setPreview(null)}>
            Close
          </Button>
        </DialogFooter>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete this document permanently?"
        description="The file and its searchable text are removed for every agent. This can't be undone — archive it instead if you might need it again."
        confirmLabel="Delete permanently"
        destructive
        requireTypedPhrase="DELETE"
      />
    </div>
  );
}
