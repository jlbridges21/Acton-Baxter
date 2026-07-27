"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

type OppDetail = {
  opportunity: {
    id: string;
    name: string;
    contactId: string | null;
    contactName: string | null;
    pipelineName: string | null;
    stageName: string | null;
    stageId: string;
    valueLabel: string | null;
    ownerName: string | null;
    status: string;
    source: string | null;
  };
  stages: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
};

export function GhlOpportunityDetailClient({ canWrite }: { canWrite: boolean }) {
  const params = useParams<{ opportunityId: string }>();
  const opportunityId = params.opportunityId;
  const [data, setData] = useState<OppDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stageId, setStageId] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingSummary, setPendingSummary] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/connectors/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_opportunity_detail", opportunityId }),
      });
      const json = await response.json();
      if (!json.result?.pass || !json.result.data) {
        setError(json.result?.message || "Couldn't load opportunity.");
        setData(null);
        return;
      }
      setData(json.result.data);
      setStageId(json.result.data.opportunity.stageId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load opportunity.");
    } finally {
      setLoading(false);
    }
  }, [opportunityId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const proposeStageMove = async () => {
    if (!data || !canWrite) return;
    const stage = data.stages.find((s) => s.id === stageId);
    setBusy("propose");
    try {
      const response = await fetch("/api/admin/connectors/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "propose_admin_action",
          actionType: "move_opportunity_stage",
          resourceId: data.opportunity.id,
          resourceName: data.opportunity.name,
          proposedChanges: { pipelineStageId: stageId },
        }),
      });
      const json = await response.json();
      if (json.result?.pass && json.result.pending) {
        setPendingId(json.result.pending.id);
        setPendingSummary(
          `${data.opportunity.stageName || "Current"} → ${stage?.name || "Selected stage"}`,
        );
        setBanner("Confirm the stage move below.");
      } else {
        setBanner(json.result?.message || "Could not prepare stage move.");
      }
    } finally {
      setBusy(null);
    }
  };

  const confirmPending = async () => {
    if (!pendingId) return;
    setBusy("confirm");
    try {
      const response = await fetch("/api/admin/connectors/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm_admin_action", pendingActionId: pendingId }),
      });
      const json = await response.json();
      setBanner(json.result?.message || (json.result?.pass ? "Updated." : "Update failed."));
      if (json.result?.pass) {
        setPendingId(null);
        setPendingSummary(null);
        await load();
      }
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p className="p-6 text-sm text-[var(--acton-muted)]">Loading opportunity…</p>;
  if (error || !data) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-red-700">{error || "Not found."}</p>
        <Button onClick={() => void load()} variant="secondary" size="sm">
          Retry
        </Button>
      </div>
    );
  }

  const o = data.opportunity;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <Link
          href="/admin/connectors/ghl"
          className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-fg)]"
        >
          ← Acton CRM
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--acton-fg)]">{o.name}</h1>
        <p className="text-sm text-[var(--acton-muted)]">
          {[o.pipelineName, o.stageName].filter(Boolean).join(" · ")}
        </p>
      </div>

      {banner ? (
        <Card className="border-l-4 border-sky-600 bg-sky-50 p-4">
          <p className="text-sm text-sky-900">{banner}</p>
        </Card>
      ) : null}

      {pendingId && pendingSummary ? (
        <Card className="space-y-3 p-4">
          <CardTitle>Confirm GoHighLevel update</CardTitle>
          <CardDescription>{o.name}</CardDescription>
          <p className="text-sm">{pendingSummary}</p>
          <div className="flex gap-2">
            <Button onClick={() => void confirmPending()} disabled={busy === "confirm"}>
              Confirm
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                await fetch("/api/admin/connectors/ghl", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "cancel_admin_action",
                    pendingActionId: pendingId,
                  }),
                });
                setPendingId(null);
                setPendingSummary(null);
                setBanner("Cancelled. No GoHighLevel changes were made.");
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="grid gap-3 p-4 md:grid-cols-2">
        <Info label="Value" value={o.valueLabel || "—"} />
        <Info label="Owner" value={o.ownerName || "Unassigned"} />
        <Info label="Status" value={o.status} />
        <Info label="Source" value={o.source || "—"} />
        <Info
          label="Contact"
          value={
            o.contactId ? (
              <Link
                href={`/admin/connectors/ghl/contacts/${o.contactId}`}
                className="text-[var(--acton-navy)] hover:underline"
              >
                {o.contactName || "Open contact"}
              </Link>
            ) : (
              "—"
            )
          }
        />
      </Card>

      <Card className="space-y-3 p-4">
        <CardTitle>Move stage</CardTitle>
        {canWrite ? (
          <>
            <select
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              className="w-full rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm"
            >
              {data.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={busy === "propose" || stageId === o.stageId}
              onClick={() => void proposeStageMove()}
            >
              Propose stage move
            </Button>
          </>
        ) : (
          <p className="text-sm text-[var(--acton-muted)]">
            CRM updates through Baxter are currently restricted to admins.
          </p>
        )}
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="text-sm">
      <div className="text-[var(--acton-muted)]">{label}</div>
      <div className="text-[var(--acton-fg)]">{value}</div>
    </div>
  );
}
