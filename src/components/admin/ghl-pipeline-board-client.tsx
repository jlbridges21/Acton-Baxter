"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
  page: number;
  hasMore: boolean;
  total: number | null;
  fetched: boolean;
};

type PipelineInfo = {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string; position: number }>;
};

type BoardData = {
  pipeline: PipelineInfo;
  columns: BoardColumn[];
  pipelineTotal: number | null;
  loadedTotal: number;
  searchIncomplete: boolean;
  searchIncompleteReason: string | null;
  filters: {
    users: Array<{ id: string; name: string }>;
    status: string;
  };
};

export type GhlPipelineBoardClientProps = {
  canWrite: boolean;
  pipelineId: string;
  /** When embedded under /admin/connectors/ghl, hide standalone chrome. */
  embedded?: boolean;
  onPipelineChange?: (pipelineId: string) => void;
};

function formatCount(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

export function GhlPipelineBoardClient({
  canWrite,
  pipelineId,
  embedded = false,
}: GhlPipelineBoardClientProps) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMoreStage, setLoadingMoreStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [status, setStatus] = useState<"all" | "open" | "won" | "lost" | "abandoned">("all");
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

  const loadBoard = useCallback(async () => {
    setBoard(null);
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        action: "get_pipeline_board",
        pipelineId,
        status,
      };
      if (debouncedQuery) body.query = debouncedQuery;
      if (assignedTo) body.assignedTo = assignedTo;
      if (source) body.source = source;

      const response = await fetch("/api/admin/connectors/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();

      if (!json.result?.pass || !json.result.data) {
        setError(json.result?.message || "Unable to load opportunities for this pipeline.");
        setBoard(null);
        return;
      }

      const data = json.result.data as BoardData;
      setBoard(data);
      if (data.pipeline.stages.length > 0) {
        setMobileStageId(data.pipeline.stages[0]!.id);
      }
    } catch {
      setError(
        "Unable to load opportunities. Baxter could not retrieve this pipeline from GoHighLevel.",
      );
    } finally {
      setLoading(false);
    }
  }, [pipelineId, debouncedQuery, status, assignedTo, source]);

  const loadMoreStage = useCallback(
    async (stageId: string, nextPage: number) => {
      if (!board) return;
      setLoadingMoreStage(stageId);
      try {
        const body: Record<string, unknown> = {
          action: "get_pipeline_board",
          pipelineId,
          status,
          stageId,
          page: nextPage,
        };
        if (assignedTo) body.assignedTo = assignedTo;
        if (source) body.source = source;

        const response = await fetch("/api/admin/connectors/ghl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await response.json();
        if (!json.result?.pass || !json.result.data) {
          setBanner(json.result?.message || "Could not load more opportunities.");
          return;
        }

        const next = json.result.data as BoardData;
        const nextCol = next.columns.find((c) => c.stageId === stageId && c.fetched);
        if (!nextCol) return;

        setBoard((prev) => {
          if (!prev) return next;
          return {
            ...prev,
            columns: prev.columns.map((col) => {
              if (col.stageId !== stageId) return col;
              const seen = new Set(col.cards.map((c) => c.id));
              const appended = nextCol.cards.filter((c) => !seen.has(c.id));
              const cards = [...col.cards, ...appended];
              return {
                ...col,
                cards,
                loadedCount: cards.length,
                page: nextCol.page,
                hasMore: nextCol.hasMore,
                total: nextCol.total ?? col.total,
                fetched: true,
              };
            }),
            loadedTotal: prev.columns.reduce((sum, col) => {
              if (col.stageId === stageId) {
                const seen = new Set(col.cards.map((c) => c.id));
                const appended = nextCol.cards.filter((c) => !seen.has(c.id));
                return sum + col.cards.length + appended.length;
              }
              return sum + col.loadedCount;
            }, 0),
            pipelineTotal: prev.pipelineTotal ?? next.pipelineTotal,
          };
        });
      } catch {
        setBanner("Unable to load more opportunities.");
      } finally {
        setLoadingMoreStage(null);
      }
    },
    [board, pipelineId, status, assignedTo, source],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void loadBoard();
    });
    return () => {
      cancelled = true;
    };
  }, [loadBoard]);

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
    return (
      <div className={embedded ? "space-y-3 py-4" : "p-6"}>
        <p className="text-sm text-[var(--acton-muted)]">Loading pipeline board…</p>
        <div className="flex gap-4 overflow-x-auto">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-64 w-80 shrink-0 animate-pulse rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-100)]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !board) {
    return (
      <div className={`space-y-3 ${embedded ? "py-4" : "p-6"}`}>
        <p className="text-sm text-red-700">{error || "Unable to load this pipeline."}</p>
        <p className="text-xs text-[var(--acton-muted)]">
          Baxter could not retrieve opportunities from GoHighLevel.
        </p>
        <Button onClick={() => void loadBoard()} variant="secondary" size="sm">
          Try Again
        </Button>
      </div>
    );
  }

  const mobileColumn =
    board.columns.find((c) => c.stageId === mobileStageId) ?? board.columns[0] ?? null;

  const totalLabel =
    board.pipelineTotal != null
      ? `${formatCount(board.pipelineTotal)} opportunities across ${board.columns.length} stages`
      : `${formatCount(board.loadedTotal)} loaded across ${board.columns.length} stages`;

  const boardBody = (
    <div className="space-y-4">
      {!embedded ? (
        <div>
          <Link
            href="/admin/connectors/ghl?tab=opportunities"
            className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-fg)]"
          >
            ← Acton CRM
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--acton-fg)]">
            {board.pipeline.name}
          </h1>
          <p className="text-sm text-[var(--acton-muted)]">{totalLabel}</p>
        </div>
      ) : (
        <p className="text-sm text-[var(--acton-muted)]">
          {board.pipeline.name} · {totalLabel}
          {loading ? " · Refreshing…" : ""}
        </p>
      )}

      {banner ? (
        <Card className="border-l-4 border-sky-600 bg-sky-50 p-4">
          <p className="text-sm text-sky-900">{banner}</p>
        </Card>
      ) : null}

      {board.searchIncomplete ? (
        <Card className="border-l-4 border-amber-500 bg-amber-50 p-4">
          <p className="text-sm text-amber-950">
            {board.searchIncompleteReason ||
              "Search results may be incomplete. Clear search to browse full stage totals."}
          </p>
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
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="abandoned">Abandoned</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--acton-muted)]">Source</span>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="All sources"
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
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--acton-fg)]">{column.stageName}</h3>
                <span className="shrink-0 text-xs text-[var(--acton-muted)] tabular-nums">
                  {formatCount(column.total)}
                </span>
              </div>
              <div className="space-y-2">
                {column.cards.length === 0 ? (
                  <p className="py-4 text-center text-xs text-[var(--acton-muted)]">
                    No opportunities
                  </p>
                ) : (
                  column.cards.map((card) => (
                    <OpportunityCardComponent
                      key={card.id}
                      card={card}
                      pipeline={board.pipeline}
                      canWrite={canWrite}
                      busy={busy === `propose:${card.id}`}
                      isPending={pendingOppId === card.id}
                      onMove={proposeStageMove}
                    />
                  ))
                )}
                {column.hasMore ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    disabled={loadingMoreStage === column.stageId}
                    onClick={() => void loadMoreStage(column.stageId, column.page + 1)}
                  >
                    {loadingMoreStage === column.stageId ? "Loading…" : "Load more"}
                  </Button>
                ) : null}
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
                {col.stageName} ({formatCount(col.total)})
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
                  disabled={loadingMoreStage === mobileColumn.stageId}
                  onClick={() => void loadMoreStage(mobileColumn.stageId, mobileColumn.page + 1)}
                >
                  {loadingMoreStage === mobileColumn.stageId ? "Loading…" : "Load more"}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (embedded) return boardBody;

  return (
    <div className="min-h-screen bg-[var(--acton-bg)]">
      <div className="mx-auto max-w-[1600px] space-y-4 p-4">{boardBody}</div>
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
  const title = card.contactName || card.name || "Untitled opportunity";

  return (
    <Card className={`space-y-2 p-3 ${isPending ? "ring-2 ring-sky-500" : ""}`}>
      <Link
        href={`/admin/connectors/ghl/opportunities/${card.id}`}
        className="block space-y-1 hover:underline"
      >
        <p className="text-sm font-medium text-[var(--acton-fg)]">{title}</p>
        {card.valueLabel ? (
          <p className="text-sm font-semibold text-[var(--acton-fg)]">{card.valueLabel}</p>
        ) : null}
        <p className="text-xs text-[var(--acton-muted)]">
          {card.ownerName || "Unassigned"}
          {card.source ? ` · ${card.source}` : ""}
        </p>
        {card.updatedLabel ? (
          <p className="text-xs text-[var(--acton-muted)]">{card.updatedLabel}</p>
        ) : null}
      </Link>
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
