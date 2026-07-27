import "server-only";

import { ghlGet } from "../client";
import { ghlPipelinesResponseSchema, type GhlPipeline, type GhlPipelineStage } from "../types";
import { normalizePipeline } from "../normalize";
import { requireGhlLocationId } from "../config";
import { getCachedReference, setCachedReference } from "../cache";

export async function listPipelines(options: { useCache?: boolean } = {}): Promise<GhlPipeline[]> {
  const locationId = requireGhlLocationId();

  if (options.useCache !== false) {
    const cached = await getCachedReference<GhlPipeline[]>(locationId, "pipelines");
    if (cached) {
      return cached;
    }
  }

  const response = await ghlGet("/opportunities/pipelines", undefined, { resource: "pipelines" });
  const parsed = ghlPipelinesResponseSchema.safeParse(response);

  let pipelines: GhlPipeline[];

  if (!parsed.success) {
    console.warn("[GHL Pipelines] Response validation warning:", parsed.error.message);
    const raw = response as { pipelines?: unknown[] };
    pipelines = Array.isArray(raw.pipelines)
      ? (raw.pipelines as Record<string, unknown>[]).map((p) => normalizePipeline(p, locationId))
      : [];
  } else {
    pipelines = parsed.data.pipelines.map((p) =>
      normalizePipeline(p as Record<string, unknown>, locationId),
    );
  }

  await setCachedReference(locationId, "pipelines", pipelines);
  return pipelines;
}

export async function getPipelineById(
  pipelineId: string,
  options: { useCache?: boolean } = {},
): Promise<GhlPipeline | null> {
  const pipelines = await listPipelines(options);
  return pipelines.find((p) => p.id === pipelineId) ?? null;
}

export async function getPipelineStages(
  pipelineId: string,
  options: { useCache?: boolean } = {},
): Promise<GhlPipelineStage[]> {
  const pipeline = await getPipelineById(pipelineId, options);
  return pipeline?.stages ?? [];
}

export async function getStageById(
  pipelineId: string,
  stageId: string,
  options: { useCache?: boolean } = {},
): Promise<GhlPipelineStage | null> {
  const stages = await getPipelineStages(pipelineId, options);
  return stages.find((s) => s.id === stageId) ?? null;
}

export async function findPipelineByName(
  name: string,
  options: { useCache?: boolean } = {},
): Promise<GhlPipeline | null> {
  const pipelines = await listPipelines(options);
  const lower = name.toLowerCase();
  return pipelines.find((p) => p.name.toLowerCase().includes(lower)) ?? null;
}

export async function findStageByName(
  pipelineId: string,
  stageName: string,
  options: { useCache?: boolean } = {},
): Promise<GhlPipelineStage | null> {
  const stages = await getPipelineStages(pipelineId, options);
  const lower = stageName.toLowerCase();
  return stages.find((s) => s.name.toLowerCase().includes(lower)) ?? null;
}

export async function getPipelineSummary(options: { useCache?: boolean } = {}): Promise<{
  totalPipelines: number;
  pipelines: Array<{
    id: string;
    name: string;
    stageCount: number;
    stageNames: string[];
  }>;
}> {
  const pipelines = await listPipelines(options);

  return {
    totalPipelines: pipelines.length,
    pipelines: pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      stageCount: p.stages.length,
      stageNames: p.stages.map((s) => s.name),
    })),
  };
}
