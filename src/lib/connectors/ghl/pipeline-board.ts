import "server-only";

import { getPipelineById } from "./resources/pipelines";
import { searchOpportunities } from "./resources/opportunities";
import { hydrateOpportunityRows, type HydratedOpportunityRow } from "./admin-views";
import { getGhlReferenceData } from "./reference-data";

export type PipelineBoardOptions = {
  q?: string;
  status?: "open" | "won" | "lost" | "abandoned" | "all";
  assignedTo?: string;
  source?: string;
  perStageLimit?: number;
  stagePages?: Record<string, number>;
};

export type PipelineBoardColumn = {
  stageId: string;
  stageName: string;
  position: number;
  cards: HydratedOpportunityRow[];
  loadedCount: number;
  hasMore: boolean;
  total: number | null;
};

export type PipelineBoardResult = {
  pipeline: {
    id: string;
    name: string;
    stages: Array<{ id: string; name: string; position: number }>;
  };
  columns: PipelineBoardColumn[];
  filters: {
    users: Array<{ id: string; name: string }>;
  };
};

export async function buildPipelineBoard(
  pipelineId: string,
  options: PipelineBoardOptions = {},
): Promise<PipelineBoardResult> {
  const pipeline = await getPipelineById(pipelineId);
  if (!pipeline) {
    throw new Error(`Pipeline ${pipelineId} not found`);
  }

  const stages = pipeline.stages.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const perStageLimit = options.perStageLimit ?? 25;
  const status = options.status ?? "open";

  let columns: PipelineBoardColumn[];

  if (options.q) {
    const searchResult = (await searchOpportunities({
      pipelineId,
      q: options.q,
      status,
      assignedTo: options.assignedTo,
      limit: 200,
    })) ?? { opportunities: [], hasMore: false, total: 0 };

    const opportunities = searchResult.opportunities ?? [];
    let hydrated = await hydrateOpportunityRows(opportunities);
    if (!Array.isArray(hydrated)) hydrated = [];

    if (options.source) {
      const sourceLower = options.source.toLowerCase();
      hydrated = hydrated.filter((h) => h.source?.toLowerCase().includes(sourceLower));
    }

    const byStage = new Map<string, HydratedOpportunityRow[]>();
    for (const stage of stages) {
      byStage.set(stage.id, []);
    }
    for (const opp of hydrated) {
      const cards = byStage.get(opp.stageId);
      if (cards) {
        cards.push(opp);
      }
    }

    columns = stages.map((stage) => {
      const cards = byStage.get(stage.id) ?? [];
      return {
        stageId: stage.id,
        stageName: stage.name,
        position: stage.position ?? 0,
        cards,
        loadedCount: cards.length,
        hasMore: false,
        total: cards.length,
      };
    });
  } else {
    const fetchConcurrency = 4;
    const stageGroups: Array<(typeof stages)[number][]> = [];
    for (let i = 0; i < stages.length; i += fetchConcurrency) {
      stageGroups.push(stages.slice(i, i + fetchConcurrency));
    }

    const stageResults = new Map<
      string,
      { opportunities: HydratedOpportunityRow[]; hasMore: boolean; total: number | null }
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
          };
        }),
      );

      for (const result of results) {
        stageResults.set(result.stageId, {
          opportunities: result.opportunities,
          hasMore: result.hasMore,
          total: result.total,
        });
      }
    }

    columns = stages.map((stage) => {
      const result = stageResults.get(stage.id);
      const cards = result?.opportunities ?? [];
      return {
        stageId: stage.id,
        stageName: stage.name,
        position: stage.position ?? 0,
        cards,
        loadedCount: cards.length,
        hasMore: result?.hasMore ?? false,
        total: result?.total ?? null,
      };
    });
  }

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
    filters: { users },
  };
}
