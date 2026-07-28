import "server-only";

import { getPipelineById } from "./resources/pipelines";
import { getOpportunityCount, searchOpportunities } from "./resources/opportunities";
import { hydrateOpportunityRows, type HydratedOpportunityRow } from "./admin-views";
import { getGhlReferenceData } from "./reference-data";

export type PipelineBoardOptions = {
  q?: string;
  status?: "open" | "won" | "lost" | "abandoned" | "all";
  assignedTo?: string;
  source?: string;
  perStageLimit?: number;
  /** 1-based page per stage. Default page 1. */
  stagePages?: Record<string, number>;
  /**
   * When set, only this stage is fetched (Load more).
   * Other columns are returned with `fetched: false` so the client can merge.
   */
  singleStageId?: string;
};

export type PipelineBoardColumn = {
  stageId: string;
  stageName: string;
  position: number;
  cards: HydratedOpportunityRow[];
  loadedCount: number;
  page: number;
  hasMore: boolean;
  /** Authoritative stage total from GHL meta when available. */
  total: number | null;
  /** False when this response intentionally skipped the stage (load-more merge). */
  fetched: boolean;
};

export type PipelineBoardResult = {
  pipeline: {
    id: string;
    name: string;
    stages: Array<{ id: string; name: string; position: number }>;
  };
  columns: PipelineBoardColumn[];
  /** Sum of stage totals when all known; otherwise pipeline-level count. */
  pipelineTotal: number | null;
  /** Cards currently loaded across fetched columns. */
  loadedTotal: number;
  /** True when search mode could not guarantee complete coverage. */
  searchIncomplete: boolean;
  searchIncompleteReason: string | null;
  filters: {
    users: Array<{ id: string; name: string }>;
    status: "open" | "won" | "lost" | "abandoned" | "all";
  };
};

const DEFAULT_PER_STAGE = 25;
const SEARCH_PAGE_LIMIT = 100;

export async function buildPipelineBoard(
  pipelineId: string,
  options: PipelineBoardOptions = {},
): Promise<PipelineBoardResult> {
  const pipeline = await getPipelineById(pipelineId);
  if (!pipeline) {
    throw new Error(`Pipeline ${pipelineId} not found`);
  }

  const stages = pipeline.stages.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const perStageLimit = options.perStageLimit ?? DEFAULT_PER_STAGE;
  // Default ALL statuses so Closed Won / Closed Lost appear (GHL omits status param).
  const status = options.status ?? "all";

  let columns: PipelineBoardColumn[];
  let searchIncomplete = false;
  let searchIncompleteReason: string | null = null;
  let searchMetaTotal: number | null = null;

  if (options.q) {
    const searchResult = (await searchOpportunities({
      pipelineId,
      q: options.q,
      status,
      assignedTo: options.assignedTo,
      limit: SEARCH_PAGE_LIMIT,
    })) ?? { opportunities: [], hasMore: false, total: null };

    searchMetaTotal = searchResult.total;
    const opportunities = searchResult.opportunities ?? [];
    let hydrated = await hydrateOpportunityRows(opportunities);
    if (!Array.isArray(hydrated)) hydrated = [];

    if (options.source) {
      const sourceLower = options.source.toLowerCase();
      hydrated = hydrated.filter((h) => h.source?.toLowerCase().includes(sourceLower));
    }

    searchIncomplete = Boolean(searchResult.hasMore);
    if (searchIncomplete) {
      searchIncompleteReason = `Search returned a partial result set (up to ${SEARCH_PAGE_LIMIT} matches). Refine the query or clear search to browse by stage with accurate totals.`;
    }

    const byStage = new Map<string, HydratedOpportunityRow[]>();
    for (const stage of stages) {
      byStage.set(stage.id, []);
    }
    for (const opp of hydrated) {
      const cards = byStage.get(opp.stageId);
      if (cards) cards.push(opp);
    }

    columns = stages.map((stage) => {
      const cards = byStage.get(stage.id) ?? [];
      return {
        stageId: stage.id,
        stageName: stage.name,
        position: stage.position ?? 0,
        cards,
        loadedCount: cards.length,
        page: 1,
        hasMore: false,
        total: searchIncomplete ? null : cards.length,
        fetched: true,
      };
    });
  } else {
    if (options.singleStageId && !stages.some((s) => s.id === options.singleStageId)) {
      throw new Error(`Stage ${options.singleStageId} not found on pipeline`);
    }

    const stagesToFetch = options.singleStageId
      ? stages.filter((s) => s.id === options.singleStageId)
      : stages;

    const fetchConcurrency = 4;
    const stageGroups: Array<(typeof stages)[number][]> = [];
    for (let i = 0; i < stagesToFetch.length; i += fetchConcurrency) {
      stageGroups.push(stagesToFetch.slice(i, i + fetchConcurrency));
    }

    const stageResults = new Map<
      string,
      {
        opportunities: HydratedOpportunityRow[];
        hasMore: boolean;
        total: number | null;
        page: number;
      }
    >();

    for (const group of stageGroups) {
      const results = await Promise.all(
        group.map(async (stage) => {
          const page = options.stagePages?.[stage.id] ?? 1;
          const result = (await searchOpportunities({
            pipelineId,
            pipelineStageId: stage.id,
            status,
            assignedTo: options.assignedTo,
            limit: perStageLimit,
            page,
          })) ?? { opportunities: [], hasMore: false, total: null };

          const opportunities = result.opportunities ?? [];
          const hydratedRaw = await hydrateOpportunityRows(opportunities);
          let hydrated = Array.isArray(hydratedRaw) ? hydratedRaw : [];
          if (options.source) {
            const sourceLower = options.source.toLowerCase();
            hydrated = hydrated.filter((h) => h.source?.toLowerCase().includes(sourceLower));
          }

          return {
            stageId: stage.id,
            opportunities: hydrated,
            hasMore: result.hasMore,
            total: result.total,
            page,
          };
        }),
      );

      for (const result of results) {
        stageResults.set(result.stageId, {
          opportunities: result.opportunities,
          hasMore: result.hasMore,
          total: result.total,
          page: result.page,
        });
      }
    }

    columns = stages.map((stage) => {
      const result = stageResults.get(stage.id);
      if (!result) {
        return {
          stageId: stage.id,
          stageName: stage.name,
          position: stage.position ?? 0,
          cards: [],
          loadedCount: 0,
          page: 1,
          hasMore: false,
          total: null,
          fetched: false,
        };
      }
      return {
        stageId: stage.id,
        stageName: stage.name,
        position: stage.position ?? 0,
        cards: result.opportunities,
        loadedCount: result.opportunities.length,
        page: result.page,
        hasMore: result.hasMore,
        total: result.total,
        fetched: true,
      };
    });
  }

  let pipelineTotal: number | null = null;
  if (options.q) {
    pipelineTotal = searchMetaTotal;
  } else if (!options.singleStageId) {
    const fetchedTotals = columns.filter((c) => c.fetched).map((c) => c.total);
    if (fetchedTotals.length > 0 && fetchedTotals.every((t) => typeof t === "number")) {
      pipelineTotal = fetchedTotals.reduce((sum, t) => sum + (t as number), 0);
    } else {
      try {
        pipelineTotal = await getOpportunityCount({ pipelineId, status });
      } catch {
        pipelineTotal = null;
      }
    }
  }

  const loadedTotal = columns.reduce((sum, c) => sum + (c.fetched ? c.loadedCount : 0), 0);

  const refs = await getGhlReferenceData();
  const users =
    refs?.users.map((u) => ({
      id: u.id,
      name: u.name || u.email,
    })) ?? [];

  return {
    pipeline: {
      id: pipeline.id,
      name: pipeline.name,
      stages: stages.map((s) => ({
        id: s.id,
        name: s.name,
        position: s.position ?? 0,
      })),
    },
    columns,
    pipelineTotal,
    loadedTotal,
    searchIncomplete,
    searchIncompleteReason,
    filters: { users, status },
  };
}
