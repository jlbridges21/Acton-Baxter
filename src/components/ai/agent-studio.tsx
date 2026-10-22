"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { AgentConfig } from "@/lib/agents/types";
import { cn } from "@/lib/utils";
import {
  AccessSection,
  ChangeList,
  DirectChatSection,
  HistorySection,
  OverviewSection,
  TestSection,
} from "./studio-admin-sections";
import {
  DelegationSection,
  InstructionsSection,
  ModelSection,
  ToolsSection,
} from "./studio-config-sections";
import type { ConfigEditor, StudioData } from "./studio-types";
import {
  AgentAvatar,
  AgentStatusPill,
  Notice,
  RuntimePill,
  aiFetch,
  errorMessage,
  useLoad,
} from "./ui";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "instructions", label: "Instructions", config: true },
  { key: "model", label: "AI model", config: true },
  { key: "delegation", label: "Delegation", config: true },
  { key: "tools", label: "Tools", config: true },
  { key: "access", label: "Access" },
  { key: "history", label: "History" },
  { key: "test", label: "Test" },
  { key: "chat", label: "Chat" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function AgentStudio({
  slug,
  departments,
  agents,
}: {
  slug: string;
  departments: Array<{ id: string; slug: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [data, setData] = useState<StudioData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [working, setWorking] = useState<AgentConfig | null>(null);
  const [savedJson, setSavedJson] = useState<string>("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    tone: "success" | "error" | "warning";
    text: string;
  } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirm, setConfirm] = useState<"publish" | "discard" | null>(null);

  const tab = (TABS.find((t) => t.key === search.get("tab"))?.key ?? "overview") as TabKey;

  const load = useCallback(async () => {
    try {
      const next = await aiFetch<StudioData>(`/api/ai/agents/${slug}`);
      setData(next);
      const base = next.config?.draft?.parsed ?? next.config?.published?.parsed ?? null;
      setWorking(base ? structuredClone(base) : null);
      setSavedJson(base ? JSON.stringify(base) : "");
      setSummary(next.config?.draft?.change_summary ?? "");
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [slug]);

  useLoad(load);

  const dirty = working ? JSON.stringify(working) !== savedJson : false;

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const canEdit = Boolean(data?.access.includes("manage"));
  const editor: ConfigEditor | null = useMemo(
    () =>
      working
        ? {
            config: working,
            readOnly: !canEdit,
            update: (fn) =>
              setWorking((prev) => {
                if (!prev) return prev;
                const next = structuredClone(prev);
                fn(next);
                return next;
              }),
          }
        : null,
    [working, canEdit],
  );

  function setTab(key: TabKey) {
    const params = new URLSearchParams(search.toString());
    params.set("tab", key);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  async function saveDraft(): Promise<boolean> {
    if (!working) return false;
    setBusy("save");
    setNotice(null);
    try {
      const res = await aiFetch<{ problems: string[] }>(`/api/ai/agents/${slug}/draft`, {
        method: "PUT",
        body: JSON.stringify({ config: working, changeSummary: summary || null }),
      });
      await load();
      setNotice(
        res.problems.length
          ? { tone: "warning", text: `Draft saved. Before publishing: ${res.problems.join(" ")}` }
          : { tone: "success", text: "Draft saved. It isn't live until you publish." },
      );
      return true;
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    setBusy("publish");
    try {
      if (dirty && !(await saveDraft())) return;
      await aiFetch(`/api/ai/agents/${slug}/publish`, { method: "POST" });
      setConfirm(null);
      await load();
      setNotice({ tone: "success", text: "Published. The new configuration is live." });
    } catch (e) {
      setConfirm(null);
      setNotice({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    setBusy("discard");
    try {
      await aiFetch(`/api/ai/agents/${slug}/draft`, { method: "DELETE" });
      setConfirm(null);
      await load();
      setNotice({ tone: "success", text: "Draft discarded." });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return <Notice tone="error">{loadError}</Notice>;
  if (!data) return <div className="h-64 animate-pulse rounded-lg bg-[var(--acton-gray-100)]" />;

  const a = data.agent;
  const draft = data.config?.draft ?? null;
  const published = data.config?.published ?? null;
  const changes = published && working ? diffConfigs(published.parsed, working) : [];
  const activeTab = TABS.find((t) => t.key === tab)!;
  const showSaveBar = canEdit && "config" in activeTab && (dirty || draft);

  return (
    <div className="space-y-6 pb-24">
      <Link
        href="/ai/agents"
        className="inline-flex items-center gap-1 text-sm text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
      >
        <ArrowLeft className="h-4 w-4" /> All agents
      </Link>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <AgentAvatar name={a.name} url={a.avatarUrl} size={72} color={a.departmentColor} />
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">
            {a.name} <span className="font-normal text-[var(--acton-muted)]">— {a.title}</span>
          </h1>
          <p className="text-sm text-[var(--acton-muted)]">
            {a.department ?? "No department"}
            {a.managerName ? ` · Reports to ${a.managerName}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <AgentStatusPill status={a.status} />
            <RuntimePill state={a.runtime?.state} />
            {draft ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                Unpublished draft
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Agent settings"
        className="flex gap-1 overflow-x-auto border-b border-[var(--acton-border)]"
      >
        {TABS.filter((t) =>
          t.key === "chat" || t.key === "test" ? a.kind === "specialist" : true,
        ).map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-sm font-medium",
              tab === t.key
                ? "border-[var(--acton-navy)] text-[var(--acton-navy)]"
                : "border-transparent text-[var(--acton-muted)] hover:text-[var(--acton-navy)]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {"config" in activeTab && !data.config ? (
        <Notice>
          You can see this agent but not its configuration. Ask an administrator for review access.
        </Notice>
      ) : null}
      {"config" in activeTab && data.config && !canEdit ? (
        <Notice>Read-only — you can review but not change this agent.</Notice>
      ) : null}

      <div role="tabpanel">
        {tab === "overview" ? (
          <OverviewSection data={data} departments={departments} agents={agents} onSaved={load} />
        ) : null}
        {tab === "instructions" && editor ? (
          <InstructionsSection editor={editor} data={data} />
        ) : null}
        {tab === "model" && editor ? <ModelSection editor={editor} data={data} /> : null}
        {tab === "delegation" && editor ? <DelegationSection editor={editor} data={data} /> : null}
        {tab === "tools" && editor ? <ToolsSection editor={editor} data={data} /> : null}
        {tab === "access" ? <AccessSection data={data} onChanged={load} /> : null}
        {tab === "history" ? <HistorySection data={data} onRestored={load} /> : null}
        {tab === "test" ? <TestSection data={data} hasDraft={Boolean(draft)} /> : null}
        {tab === "chat" ? <DirectChatSection data={data} /> : null}
      </div>

      {showSaveBar ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--acton-border)] bg-white/95 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-6">
            <p className="text-sm text-[var(--acton-navy)] sm:flex-1" aria-live="polite">
              {dirty ? (
                <b>Unsaved changes.</b>
              ) : (
                <>
                  <b>Draft v{draft?.version_number}</b> is saved but not live.
                </>
              )}{" "}
              <span className="text-[var(--acton-muted)]">
                {changes.length} change{changes.length === 1 ? "" : "s"} from the live version.
              </span>
            </p>
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What changed? (optional)"
              className="h-9 sm:w-64"
              aria-label="Change summary"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setPreviewOpen(true)}
                disabled={!published}
              >
                Preview changes
              </Button>
              {dirty ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void saveDraft()}
                  disabled={busy !== null}
                >
                  {busy === "save" ? "Saving…" : "Save draft"}
                </Button>
              ) : null}
              {a.kind === "specialist" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={dirty || !draft}
                  onClick={() => setTab("test")}
                  title={dirty ? "Save the draft first" : undefined}
                >
                  Test draft
                </Button>
              ) : null}
              {draft && !dirty ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirm("discard")}
                >
                  Discard
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                onClick={() => setConfirm("publish")}
                disabled={busy !== null || (!dirty && !draft)}
              >
                Publish
              </Button>
            </div>
          </div>
          {data.config?.draftProblems.length && !dirty ? (
            <p className="mx-auto max-w-7xl px-4 pb-3 text-xs text-amber-800 sm:px-6">
              Before publishing: {data.config.draftProblems.join(" ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} size="lg">
        <DialogHeader>
          <DialogTitle>Changes compared with the live version</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <ChangeList changes={changes} />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setPreviewOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </Dialog>
      <ConfirmDialog
        open={confirm === "publish"}
        onClose={() => setConfirm(null)}
        onConfirm={publish}
        busy={busy === "publish"}
        title={`Publish changes to ${a.name}?`}
        description={`${changes.length} change${changes.length === 1 ? "" : "s"} will go live right away for web chat and Slack. The current version stays in History so you can restore it.`}
        confirmLabel="Publish"
      />
      <ConfirmDialog
        open={confirm === "discard"}
        onClose={() => setConfirm(null)}
        onConfirm={discard}
        busy={busy === "discard"}
        title="Discard this draft?"
        description="The live configuration is not affected."
        confirmLabel="Discard draft"
        destructive
      />
    </div>
  );
}
