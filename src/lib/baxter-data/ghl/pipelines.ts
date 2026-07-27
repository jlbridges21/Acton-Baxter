import "server-only";

import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import {
  listPipelines,
  getPipelineById,
  findPipelineByName,
  getPipelineSummary,
} from "@/lib/connectors/ghl/resources/pipelines";
import { searchOpportunities } from "@/lib/connectors/ghl/resources/opportunities";
import type { BaxterGhlPipelineContext, GhlPipeline, GhlEvidenceSource } from "./types";
import { createPipelineEvidenceSource, createOpportunityEvidenceSource } from "./evidence";

export async function getBaxterPipelineContext(
  pipelineId: string,
): Promise<BaxterGhlPipelineContext | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const pipeline = await getPipelineById(pipelineId);
  if (!pipeline) {
    return null;
  }

  const evidenceSources: GhlEvidenceSource[] = [
    createPipelineEvidenceSource(pipeline.id, pipeline.name, `${pipeline.stages.length} stages`),
  ];

  const opportunityCounts: Record<string, number> = {};
  let totalValue = 0;

  for (const stage of pipeline.stages) {
    const result = await searchOpportunities({
      pipelineId: pipeline.id,
      stageId: stage.id,
      status: "open",
      limit: 100,
    });

    opportunityCounts[stage.id] = result.opportunities.length;

    for (const opp of result.opportunities) {
      totalValue += opp.monetaryValue ?? 0;
    }

    if (result.opportunities.length > 0) {
      evidenceSources.push(
        createOpportunityEvidenceSource(
          `stage-${stage.id}`,
          stage.name,
          `${result.opportunities.length} open opportunities`,
        ),
      );
    }
  }

  return {
    pipeline,
    opportunityCounts,
    totalValue,
    evidenceSources,
  };
}

export async function listBaxterPipelines(): Promise<{
  pipelines: GhlPipeline[];
  evidenceSources: GhlEvidenceSource[];
} | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const pipelines = await listPipelines();
  const evidenceSources = pipelines.map((p) =>
    createPipelineEvidenceSource(p.id, p.name, `${p.stages.length} stages`),
  );

  return { pipelines, evidenceSources };
}

export async function findBaxterPipelineByName(
  name: string,
): Promise<{ pipeline: GhlPipeline | null; evidenceSources: GhlEvidenceSource[] } | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const pipeline = await findPipelineByName(name);
  const evidenceSources: GhlEvidenceSource[] = [];

  if (pipeline) {
    evidenceSources.push(
      createPipelineEvidenceSource(pipeline.id, pipeline.name, `Found by name: "${name}"`),
    );
  }

  return { pipeline, evidenceSources };
}

export async function getBaxterPipelineSummary(): Promise<{
  totalPipelines: number;
  pipelines: Array<{
    id: string;
    name: string;
    stageCount: number;
    stageNames: string[];
  }>;
  evidenceSources: GhlEvidenceSource[];
} | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const summary = await getPipelineSummary();
  const evidenceSources = summary.pipelines.map((p) =>
    createPipelineEvidenceSource(p.id, p.name, `${p.stageCount} stages`),
  );

  return {
    ...summary,
    evidenceSources,
  };
}
