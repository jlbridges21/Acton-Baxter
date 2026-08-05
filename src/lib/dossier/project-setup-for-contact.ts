/**
 * Shared Project Setup lookup for Customer Center + GHL answer enrichment.
 * Contact matching for linked Slack channels uses exact `ghlContactId` only.
 */

import "server-only";

import {
  listProjectSetupRunsByGhlContactId,
  getProjectSetupSteps,
} from "@/lib/project-setup/store";
import type { ProjectSetupRun, ProjectSetupStep } from "@/lib/project-setup/types";
import type { DossierProjectSetupRun } from "./types";

export type LinkedProjectSetupRun = DossierProjectSetupRun & {
  createdAt: string;
};

export type ProjectSetupForContactDeps = {
  listSetupRuns?: (limit?: number) => Promise<ProjectSetupRun[]>;
  /** Prefer over scanning recent runs — exact contact id query. */
  listSetupRunsByContactId?: (ghlContactId: string) => Promise<ProjectSetupRun[]>;
  getSetupSteps?: (runId: string) => Promise<ProjectSetupStep[]>;
};

function asHttpLink(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("http") ? value : null;
}

async function loadProjectSetupLinks(
  runId: string,
  getSteps: (runId: string) => Promise<ProjectSetupStep[]>,
): Promise<Pick<DossierProjectSetupRun, "folderLink" | "charterLink" | "slackChannelId">> {
  try {
    const steps = await getSteps(runId);
    const byKey = new Map(steps.map((s) => [s.stepKey, s]));
    const folder = byKey.get("copy_template_folder");
    const charter = byKey.get("copy_charter_spreadsheet");
    const slack = byKey.get("create_slack_channel");
    return {
      folderLink: asHttpLink(folder?.outputJson?.webViewLink),
      charterLink: asHttpLink(charter?.outputJson?.webViewLink),
      slackChannelId:
        typeof slack?.outputJson?.channelId === "string" ? slack.outputJson.channelId : null,
    };
  } catch {
    return { folderLink: null, charterLink: null, slackChannelId: null };
  }
}

export function mapProjectSetupRunForDossier(
  run: ProjectSetupRun,
  links: Pick<DossierProjectSetupRun, "folderLink" | "charterLink" | "slackChannelId">,
): LinkedProjectSetupRun {
  return {
    id: run.id,
    status: run.status,
    projectNumber: run.projectNumber,
    dryRun: run.dryRun,
    folderName: run.folderName,
    charterName: run.charterName,
    slackChannelName: run.slackChannelName,
    folderLink: links.folderLink,
    charterLink: links.charterLink,
    slackChannelId: links.slackChannelId,
    href: `/projects/setup/${run.id}`,
    createdAt: run.createdAt,
  };
}

/**
 * Exact `ghl_contact_id` match only — never fuzzy last-name matching.
 * Same id filter the Customer Center uses when a GHL contact id is known.
 */
export async function listProjectSetupRunsForGhlContact(
  ghlContactId: string,
  deps: ProjectSetupForContactDeps = {},
): Promise<LinkedProjectSetupRun[]> {
  const contactId = ghlContactId.trim();
  if (!contactId) return [];

  const getSetupSteps = deps.getSetupSteps ?? getProjectSetupSteps;
  let matched: ProjectSetupRun[];
  if (deps.listSetupRunsByContactId) {
    matched = await deps.listSetupRunsByContactId(contactId);
  } else if (deps.listSetupRuns) {
    // Test inject: filter a provided universe by exact id.
    const allRuns = await deps.listSetupRuns(100);
    matched = allRuns.filter((run) => run.ghlContactId === contactId);
  } else {
    matched = await listProjectSetupRunsByGhlContactId(contactId);
  }

  const out: LinkedProjectSetupRun[] = [];
  for (const run of matched) {
    const links = await loadProjectSetupLinks(run.id, getSetupSteps);
    out.push(mapProjectSetupRunForDossier(run, links));
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Prefer the most recent COMPLETE run that has a linked Slack channel.
 * Failed / draft / cancelled / incomplete runs are not treated as current.
 */
export function pickPreferredCompleteRunWithSlackChannel(
  runs: LinkedProjectSetupRun[],
): LinkedProjectSetupRun | null {
  const eligible = runs
    .filter(
      (r) =>
        r.status === "complete" &&
        !r.dryRun &&
        Boolean(r.slackChannelId?.trim() || r.slackChannelName?.trim()),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return eligible[0] ?? null;
}

/** Re-export link loader for Customer Center assemble (single implementation). */
export async function loadProjectSetupLinksForRun(
  runId: string,
  getSteps: (runId: string) => Promise<ProjectSetupStep[]> = getProjectSetupSteps,
): Promise<Pick<DossierProjectSetupRun, "folderLink" | "charterLink" | "slackChannelId">> {
  return loadProjectSetupLinks(runId, getSteps);
}
