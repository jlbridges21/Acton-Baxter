"use client";

import { CheckCircle2, Clock, ExternalLink, Loader2, RotateCcw, Rocket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui/dialog";
import type { AdminWorkspaceData } from "@/lib/configurator/server";
import type { PublishSummary, ReleaseSummary } from "@/lib/configurator/store";
import type { Issue } from "@/lib/configurator/validate";
import { cn } from "@/lib/utils";
import { useAdmin } from "./admin-context";
import { PageHeader } from "./admin-shell";
import { Panel, Pill, inputClass } from "./admin-ui";

type PlanResponse = { summary: PublishSummary; globalErrors: Issue[]; releases: ReleaseSummary[] };

export function PublishPage() {
  const { dirtyCount, save, saving, live, setLive, revision } = useAdmin();
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [restoring, setRestoring] = useState<ReleaseSummary | null>(null);

  const fetchPlan = useCallback(
    () =>
      fetch("/api/admin/configurator/publish").then(async (res) => ({
        ok: res.ok,
        payload: (await res.json().catch(() => null)) as PlanResponse | null,
      })),
    [],
  );
  const load = useCallback(async () => {
    const { ok, payload } = await fetchPlan();
    setPlan(ok ? payload : null);
    setLoading(false);
  }, [fetchPlan]);

  useEffect(() => {
    let cancelled = false;
    fetchPlan().then(({ ok, payload }) => {
      if (cancelled) return;
      setPlan(ok ? payload : null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPlan, revision]);

  const afterRelease = async (res: Response, success: string) => {
    const payload = (await res.json().catch(() => ({}))) as {
      live?: AdminWorkspaceData["live"];
      error?: { message?: string };
    };
    if (!res.ok) {
      setMessage({ tone: "error", text: payload.error?.message ?? "Publishing failed." });
      return;
    }
    setLive(payload.live ?? null);
    setMessage({ tone: "ok", text: success });
    setNotes("");
    await load();
  };

  const publish = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/configurator/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      await afterRelease(res, "Published. Customers now see the new version.");
    } finally {
      setBusy(false);
    }
  };

  const s = plan?.summary;
  const canPublish = Boolean(
    s &&
    (s.publishedModels.length || s.keptPreviousModels.length) &&
    !plan?.globalErrors.length &&
    dirtyCount === 0,
  );

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader
        title="Publish"
        description="Publishing copies the saved draft to the live customer configurator. Models with unresolved problems keep their last published version."
        actions={
          <a
            href="/design"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)] hover:bg-gray-50"
          >
            <ExternalLink className="h-4 w-4" /> View live {live ? `(v${live.version})` : ""}
          </a>
        }
      />

      {dirtyCount > 0 ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <span>You have {dirtyCount} unsaved changes. Save the draft before publishing.</span>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="h-9 rounded-md bg-[var(--acton-navy)] px-4 font-semibold text-white disabled:opacity-50"
          >
            Save draft
          </button>
        </div>
      ) : null}

      {message ? (
        <div
          role="status"
          className={cn(
            "mb-4 rounded-xl p-4 text-sm",
            message.tone === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800",
          )}
          data-testid="publish-message"
        >
          {message.text}
        </div>
      ) : null}

      <Panel title="What will go live" className="mb-5">
        {loading || !s ? (
          <p className="flex items-center gap-2 text-sm text-[var(--acton-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking the draft…
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            {plan!.globalErrors.length ? (
              <div className="rounded-lg bg-red-50 p-3 text-red-800">
                <p className="font-semibold">These must be fixed before anything can publish:</p>
                <ul className="mt-1 list-disc pl-5">
                  {plan!.globalErrors.map((e, i) => (
                    <li key={i}>{e.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Group
              tone="green"
              title={`Goes live as drafted (${s.publishedModels.length})`}
              items={s.publishedModels.map((name) => ({ name, reasons: [] }))}
              empty="No model is fully ready yet."
            />
            <Group
              tone="blue"
              title={`Keeps the previously published version (${s.keptPreviousModels.length})`}
              items={s.keptPreviousModels}
            />
            <Group
              tone="amber"
              title={`Not ready — stays off the live site (${s.skippedModels.length})`}
              items={s.skippedModels}
            />
          </div>
        )}
        <div className="mt-5 border-t border-[var(--acton-border)] pt-4">
          <label className="mb-1 block text-sm font-semibold text-[var(--acton-navy)]">
            Notes for this version (optional)
          </label>
          <textarea
            className={cn(inputClass, "h-16 py-2")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Updated Bay Area exterior prices"
          />
          <button
            type="button"
            disabled={!canPublish || busy}
            onClick={() => void publish()}
            data-testid="publish-now"
            className="mt-3 inline-flex h-11 items-center gap-2 rounded-md bg-[var(--acton-navy)] px-6 text-sm font-semibold text-white hover:bg-[var(--acton-navy-dark)] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}{" "}
            Publish to customers
          </button>
        </div>
      </Panel>

      <Panel title="Version history">
        {plan?.releases.length ? (
          <ul className="divide-y divide-[var(--acton-border)]" data-testid="release-history">
            {plan.releases.map((r, i) => (
              <li key={r.version} className="flex flex-wrap items-start gap-3 py-3">
                <span className="mt-0.5">
                  {i === 0 ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <Clock className="h-5 w-5 text-gray-400" />
                  )}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-[var(--acton-navy)]">
                    Version {r.version} {i === 0 ? <Pill tone="green">Live</Pill> : null}
                  </p>
                  <p className="text-[var(--acton-muted)]">
                    {new Date(r.publishedAt).toLocaleString()}
                    {r.publishedByName ? ` · ${r.publishedByName}` : ""}
                    {r.rolledBackFrom ? ` · restored from v${r.rolledBackFrom}` : ""}
                  </p>
                  {r.notes ? <p className="mt-1">{r.notes}</p> : null}
                  <p className="mt-1 text-xs text-[var(--acton-muted)]">
                    {r.summary.publishedModels.length} models published
                    {r.summary.keptPreviousModels.length
                      ? `, ${r.summary.keptPreviousModels.length} kept previous`
                      : ""}
                  </p>
                </div>
                {i > 0 ? (
                  <button
                    type="button"
                    onClick={() => setRestoring(r)}
                    className="inline-flex h-9 items-center gap-1 rounded-md border border-[var(--acton-border)] px-3 text-sm font-semibold text-[var(--acton-navy)] hover:bg-gray-50"
                  >
                    <RotateCcw className="h-4 w-4" /> Restore
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--acton-muted)]">
            Nothing has been published yet. The existing design.actonadu.com stays as it is until
            DNS is pointed here.
          </p>
        )}
      </Panel>

      <ConfirmDialog
        open={Boolean(restoring)}
        onClose={() => setRestoring(null)}
        onConfirm={async () => {
          if (!restoring) return;
          const version = restoring.version;
          setRestoring(null);
          setBusy(true);
          try {
            const res = await fetch("/api/admin/configurator/rollback", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ version }),
            });
            await afterRelease(
              res,
              `Version ${version} is live again. Your draft was not changed.`,
            );
          } finally {
            setBusy(false);
          }
        }}
        title={`Restore version ${restoring?.version}?`}
        description="Customers immediately see that version again. It is added to the history as a new version, and your current draft stays untouched."
        confirmLabel="Restore"
      />
    </div>
  );
}

function Group({
  title,
  items,
  tone,
  empty,
}: {
  title: string;
  items: { name: string; reasons: string[] }[];
  tone: "green" | "blue" | "amber";
  empty?: string;
}) {
  if (!items.length && !empty) return null;
  return (
    <div>
      <p className="mb-1 font-semibold text-[var(--acton-navy)]">{title}</p>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.name}>
              <Pill tone={tone}>{item.name}</Pill>
              {item.reasons.length ? (
                <ul className="mt-1 ml-4 list-disc text-xs text-[var(--acton-muted)]">
                  {item.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[var(--acton-muted)]">{empty}</p>
      )}
    </div>
  );
}
