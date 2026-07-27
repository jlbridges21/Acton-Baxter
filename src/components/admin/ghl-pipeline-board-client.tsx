"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

type OpportunityCard = {
  id: string;
  name: string;
  contactId: string | null;
  contactName: string | null;
  pipelineName: string | null;
  stageId: string;
  stageName: string | null;
  valueLabel: string | null;
  ownerName: string | null;
  status: string;
  source: string | null;
  updatedLabel: string | null;
};

type BoardColumn = {
  stageId: string;
  stageName: string;
  position: number;
  cards: OpportunityCard[];
  loadedCount: number;
  hasMore: boolean;
  total: number | null;
};

type PipelineInfo = {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string; position: number }>;
};

type BoardData = {
  pipeline: PipelineInfo;
  columns: BoardColumn[];
  filters: {
    users: Array<{ id: string; name: string }>;
  };
};

type PipelineCard = {
  id: string;
  name: string;
  stageCount: number;
};

export function GhlPipelineBoardClient({ canWrite }: { canWrite: boolean }) {
  const params = useParams<{ pipelineId: string }>();
  const pipelineId = params.pipelineId;

  const [board, setBoard] = useState<BoardData | null>(null);
  const [pipelines, setPipelines] = useState<PipelineCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [status, setStatus] = useState<"all" | "open" | "won" | "lost" | "abandoned">("open");
  const [assignedTo, setAssignedTo] = useState("");
  const [source, setSource] = useState("");
  const [mobileStageId, setMobileStageId] = useState("");

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingSummary, setPendingSummary] = useState<string | null>(null);
  const [pendingOppId, setPendingOppId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const loadBoard = useCallback(
    async (stageId?: string, page?: number) => {
      setLoading(true);
      setError(null);
      try {
        const body: Record<string, unknown> = {
          action: "get_pipeline_board",
          pipelineId,
        };
        if (debouncedQuery) body.query = debouncedQuery;
        if (status !== "open") body.status = status;
        if (assignedTo) body.assignedTo = assignedTo;
        if (source) body.source = source;
        if (stageId && page) {
          body.stageId = stageId;
          body.page = page;
        }

        const response = await fetch("/api/admin/connectors/ghl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await response.json();

        if (!json.result?.pass || !json.result.data) {
          setError(json.result?.message || "Couldn't load pipeline board.");
          setBoard(null);
          return;
        }

        setBoard(json.result.data);
        if (!mobileStageId && json.result.data.pipeline.stages.length > 0) {
          setMobileStageId(json.result.data.pipeline.stages[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load pipeline board.");
      } finally {
        setLoading(false);
      }
    },
    [pipelineId, debouncedQuery, status, assignedTo, source, mobileStageId],
  );

  const loadPipelines = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/connectors/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_pipelines_for_opportunities" }),
      });
      const json = await response.json();
      if (json.result?.pass) {
        setPipelines(json.result.pipelines || []);
      }
    } catch (err) {
      console.error("Failed to load pipelines:", err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void loadBoard();
        void loadPipelines();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadBoard, loadPipelines]);

  const proposeStageMove = async (oppId: string, oppName: string, toStageId: string) => {
    if (!board || !canWrite) return;
    const stage = board.pipeline.stages.find((s) => s.id === toStageId);
    const opp = board.columns.flatMap((c) => c.cards).find((c) => c.id === oppId);
    if (!opp) return;

    setBusy(`propose:${oppId}`);
    try {
      const response = await fetch("/api/admin/connectors/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "propose_admin_action",
          actionType: "move_opportunity_stage",
          resourceId: oppId,
          resourceName: oppName,
          proposedChanges: { pipelineStageId: toStageId },
        }),
      });
      const json = await response.json();
      if (json.result?.pass && json.result.pending) {
        setPendingId(json.result.pending.id);
        setPendingOppId(oppId);
        setPendingSummary(`${opp.stageName || "Current"} → ${stage?.name || "Selected stage"}`);
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
        setPendingOppId(null);
        await loadBoard();
      }
    } finally {
      setBusy(null);
    }
  };

  const cancelPending = async () => {
    if (!pendingId) return;
    try {
      await fetch("/api/admin/connectors/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_admin_action", pendingActionId: pendingId }),
      });
      setPendingId(null);
      setPendingSummary(null);
      setPendingOppId(null);
      setBanner("Cancelled. No GoHighLevel changes were made.");
    } catch {
      setBanner("Failed to cancel.");
    }
  };

  if (loading && !board) {
    return <p className="p-6 text-sm text-[var(--acton-muted)]">Loading pipeline board…</p>;
  }

  if (error || !board) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-red-700">{error || "Not found."}</p>
        <Button onClick={() => void loadBoard()} variant="secondary" size="sm">
          Retry
        </Button>
      </div>
    );
  }

  const mobileColumn =
    board.columns.find((c) => c.stageId === mobileStageId) ?? board.columns[0] ?? null;

  return (
    <div className="min-h-screen bg-[var(--acton-bg)]">
      <div className="mx-auto max-w-[1600px] space-y-4 p-4">
        <div>
          <Link
            href="/admin/connectors/ghl"
            className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-fg)]"
          >
            ← Acton CRM
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--acton-fg)]">
            {board.pipeline.name}
          </h1>
          <p className="text-sm text-[var(--acton-muted)]">
            {board.columns.reduce((sum, c) => sum + c.loadedCount, 0)} opportunities across{" "}
            {board.columns.length} stages
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
            <p className="text-sm">{pendingSummary}</p>
            <div className="flex gap-2">
              <Button onClick={() => void confirmPending()} disabled={busy === "confirm"}>
                Confirm
              </Button>
              <Button variant="secondary" onClick={() => void cancelPending()}>
                Cancel
              </Button>
            </div>
          </Card>
        ) : null}

        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            {pipelines && pipelines.length > 1 ? (
              <label className="text-sm">
                <span className="mb-1 block text-xs text-[var(--acton-muted)]">Pipeline</span>
                <select
                  value={pipelineId}
                  onChange={(e) => {
                    window.location.href = `/admin/connectors/ghl/opportunities/pipeline/${e.target.value}`;
                  }}
                  className="h-9 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-fg)] outline-none focus:ring-2 focus:ring-[var(--acton-navy)]"
                >
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="min-w-[200px] flex-1 text-sm">
              <span className="mb-1 block text-xs text-[var(--acton-muted)]">Search</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search this pipeline…"
                className="h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-fg)] outline-none focus:ring-2 focus:ring-[var(--acton-navy)]"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-xs text-[var(--acton-muted)]">Owner</span>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-9 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-fg)] outline-none focus:ring-2 focus:ring-[var(--acton-navy)]"
              >
                <option value="">All owners</option>
                {board.filters.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-xs text-[var(--acton-muted)]">Status</span>
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as "all" | "open" | "won" | "lost" | "abandoned")
                }
                className="h-9 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-fg)] outline-none focus:ring-2 focus:ring-[var(--acton-navy)]"
              >
                <option value="open">Open</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
                <option value="abandoned">Abandoned</option>
                <option value="all">All</option>
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-xs text-[var(--acton-muted)]">Source</span>
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Filter by source…"
                className="h-9 rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-fg)] outline-none focus:ring-2 focus:ring-[var(--acton-navy)]"
              />
            </label>
          </div>
        </Card>

        <div className="hidden lg:block">
          <div className="flex gap-4 overflow-x-auto pb-4">
            {board.columns.map((column) => (
              <div
                key={column.stageId}
                className="w-80 shrink-0 rounded-md border border-[var(--acton-border)] bg-white p-3"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--acton-fg)]">
                    {column.stageName}
                  </h3>
                  <span className="text-xs text-[var(--acton-muted)]">
                    {column.total !== null ? column.total : column.loadedCount}
                  </span>
                </div>
                <div className="space-y-2">
                  {column.cards.length === 0 ? (
                    <p className="py-4 text-center text-xs text-[var(--acton-muted)]">
                      No opportunities
                    </p>
                  ) : (
                    <>
                      {column.cards.map((card) => (
                        <OpportunityCardComponent
                          key={card.id}
                          card={card}
                          pipeline={board.pipeline}
                          canWrite={canWrite}
                          busy={busy === `propose:${card.id}`}
                          isPending={pendingOppId === card.id}
                          onMove={proposeStageMove}
                        />
                      ))}
                      {column.hasMore ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="w-full"
                          onClick={() => {
                            const page = Math.ceil(column.loadedCount / 25) + 1;
                            void loadBoard(column.stageId, page);
                          }}
                        >
                          Load more
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 lg:hidden">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--acton-muted)]">Stage</span>
            <select
              value={mobileStageId}
              onChange={(e) => setMobileStageId(e.target.value)}
              className="h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-fg)] outline-none focus:ring-2 focus:ring-[var(--acton-navy)]"
            >
              {board.columns.map((col) => (
                <option key={col.stageId} value={col.stageId}>
                  {col.stageName} ({col.total !== null ? col.total : col.loadedCount})
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-2">
            {!mobileColumn || mobileColumn.cards.length === 0 ? (
              <Card className="p-4">
                <p className="text-center text-sm text-[var(--acton-muted)]">
                  No opportunities in this stage
                </p>
              </Card>
            ) : (
              <>
                {mobileColumn.cards.map((card) => (
                  <OpportunityCardComponent
                    key={card.id}
                    card={card}
                    pipeline={board.pipeline}
                    canWrite={canWrite}
                    busy={busy === `propose:${card.id}`}
                    isPending={pendingOppId === card.id}
                    onMove={proposeStageMove}
                  />
                ))}
                {mobileColumn.hasMore ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      const page = Math.ceil(mobileColumn.loadedCount / 25) + 1;
                      void loadBoard(mobileColumn.stageId, page);
                    }}
                  >
                    Load more
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OpportunityCardComponent({
  card,
  pipeline,
  canWrite,
  busy,
  isPending,
  onMove,
}: {
  card: OpportunityCard;
  pipeline: PipelineInfo;
  canWrite: boolean;
  busy: boolean;
  isPending: boolean;
  onMove: (oppId: string, oppName: string, toStageId: string) => void;
}) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  return (
    <Card className={`space-y-2 p-3 ${isPending ? "ring-2 ring-sky-500" : ""}`}>
      <Link
        href={`/admin/connectors/ghl/opportunities/${card.id}`}
        className="block hover:underline"
      >
        <p className="text-sm font-medium text-[var(--acton-fg)]">
          {card.name || "Untitled opportunity"}
        </p>
      </Link>
      {card.valueLabel ? (
        <p className="text-sm font-semibold text-[var(--acton-fg)]">{card.valueLabel}</p>
      ) : null}
      <p className="text-xs text-[var(--acton-muted)]">
        {card.ownerName || "Unassigned"}
        {card.status ? ` · ${card.status}` : ""}
      </p>
      {card.source ? (
        <p className="text-xs text-[var(--acton-muted)]">Source: {card.source}</p>
      ) : null}
      {card.updatedLabel ? (
        <p className="text-xs text-[var(--acton-muted)]">{card.updatedLabel}</p>
      ) : null}
      {canWrite ? (
        <div className="pt-1">
          {!showMoveMenu ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowMoveMenu(true)}
              disabled={busy}
              className="w-full"
            >
              {busy ? "Moving…" : "Move Stage"}
            </Button>
          ) : (
            <div className="space-y-2">
              <select
                onChange={(e) => {
                  if (e.target.value && e.target.value !== card.stageId) {
                    onMove(card.id, card.name, e.target.value);
                    setShowMoveMenu(false);
                  }
                }}
                className="h-8 w-full rounded-md border border-[var(--acton-border)] bg-white px-2 text-xs text-[var(--acton-fg)] outline-none focus:ring-2 focus:ring-[var(--acton-navy)]"
                defaultValue=""
                aria-label="Select stage to move to"
              >
                <option value="">Select stage…</option>
                {pipeline.stages
                  .filter((s) => s.id !== card.stageId)
                  .map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowMoveMenu(false)}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}
