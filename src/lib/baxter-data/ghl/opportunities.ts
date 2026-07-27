import "server-only";

import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import {
  searchOpportunities,
  getOpportunityById,
  listOpportunitiesByPipeline,
  listOpenOpportunities,
} from "@/lib/connectors/ghl/resources/opportunities";
import { getContactById } from "@/lib/connectors/ghl/resources/contacts";
import { getPipelineById, getStageById } from "@/lib/connectors/ghl/resources/pipelines";
import { getUserById } from "@/lib/connectors/ghl/resources/users";
import type { BaxterGhlOpportunityContext, GhlOpportunity, GhlEvidenceSource } from "./types";
import {
  createOpportunityEvidenceSource,
  createContactEvidenceSource,
  createPipelineEvidenceSource,
  createUserEvidenceSource,
} from "./evidence";

export async function getBaxterOpportunityContext(
  opportunityId: string,
): Promise<BaxterGhlOpportunityContext | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const opportunity = await getOpportunityById(opportunityId);
  if (!opportunity) {
    return null;
  }

  const evidenceSources: GhlEvidenceSource[] = [
    createOpportunityEvidenceSource(
      opportunity.id,
      opportunity.name,
      `Status: ${opportunity.status}`,
    ),
  ];

  const [contact, pipeline] = await Promise.all([
    opportunity.contactId ? getContactById(opportunity.contactId) : null,
    opportunity.pipelineId ? getPipelineById(opportunity.pipelineId) : null,
  ]);

  if (contact) {
    evidenceSources.push(
      createContactEvidenceSource(contact.id, contact.name, "Associated contact"),
    );
  }

  let stageName: string | null = null;
  if (pipeline) {
    evidenceSources.push(
      createPipelineEvidenceSource(pipeline.id, pipeline.name, "Opportunity pipeline"),
    );
    if (opportunity.pipelineStageId) {
      const stage = await getStageById(pipeline.id, opportunity.pipelineStageId);
      stageName = stage?.name ?? null;
    }
  }

  let assignedUser = null;
  if (opportunity.assignedTo) {
    assignedUser = await getUserById(opportunity.assignedTo);
    if (assignedUser) {
      evidenceSources.push(
        createUserEvidenceSource(assignedUser.id, assignedUser.name, "Assigned user"),
      );
    }
  }

  return {
    opportunity,
    contact,
    pipeline,
    stageName,
    assignedUser,
    evidenceSources,
  };
}

export async function searchBaxterOpportunities(
  options: {
    pipelineId?: string;
    status?: "open" | "won" | "lost" | "abandoned" | "all";
    limit?: number;
  } = {},
): Promise<{ opportunities: GhlOpportunity[]; evidenceSources: GhlEvidenceSource[] } | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const result = await searchOpportunities({
    pipelineId: options.pipelineId,
    status: options.status,
    limit: options.limit ?? 20,
  });

  const evidenceSources = result.opportunities.map((o) =>
    createOpportunityEvidenceSource(
      o.id,
      o.name,
      `Status: ${o.status}, Value: ${o.monetaryValue ?? "N/A"}`,
    ),
  );

  return {
    opportunities: result.opportunities,
    evidenceSources,
  };
}

export async function getBaxterOpenOpportunities(
  limit = 20,
): Promise<{ opportunities: GhlOpportunity[]; evidenceSources: GhlEvidenceSource[] } | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const opportunities = await listOpenOpportunities(limit);
  const evidenceSources = opportunities.map((o) =>
    createOpportunityEvidenceSource(
      o.id,
      o.name,
      `Open opportunity, Value: ${o.monetaryValue ?? "N/A"}`,
    ),
  );

  return { opportunities, evidenceSources };
}

export async function getBaxterOpportunitiesByPipeline(
  pipelineId: string,
  options: {
    stageId?: string;
    status?: "open" | "won" | "lost" | "abandoned" | "all";
    limit?: number;
  } = {},
): Promise<{ opportunities: GhlOpportunity[]; evidenceSources: GhlEvidenceSource[] } | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const opportunities = await listOpportunitiesByPipeline(pipelineId, options);
  const evidenceSources = opportunities.map((o) =>
    createOpportunityEvidenceSource(o.id, o.name, `Pipeline: ${pipelineId}`),
  );

  return { opportunities, evidenceSources };
}
