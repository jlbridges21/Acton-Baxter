import "server-only";

import { isAdminRole } from "@/lib/auth/roles";
import {
  resolveGhlEntityGraph,
  formatCustomerSnapshot,
  type GhlEntityGraph,
} from "@/lib/connectors/ghl/entity-graph";
import {
  buildPemProspectIndex,
  matchProspectInIndex,
  type PemProspectIndexEntry,
} from "@/lib/baxter-data/pem-neats/prospect-index";
import { canAccessPemEvidence, pemNeatPath } from "@/lib/baxter-data/pem-neats/evidence";
import { getPemNeatStore } from "@/lib/pem-neat/store";
import { listProjectSetupRuns, getProjectSetupSteps } from "@/lib/project-setup/store";
import type { ProjectSetupRun, ProjectSetupStep } from "@/lib/project-setup/types";
import { listFindings } from "@/lib/monitoring/findings";
import type { MonitoringFinding } from "@/lib/monitoring/types";
import type {
  AssembleCustomerDossierInput,
  CustomerDossier,
  DossierGhlSection,
  DossierMonitoringSection,
  DossierPemSection,
  DossierProjectSetupRun,
  DossierProjectSetupSection,
} from "./types";

function asHttpLink(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("http") ? value : null;
}

function dossierPagePath(input: {
  contactId: string | null;
  pemNeatId: string | null;
  name: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.contactId) params.set("contactId", input.contactId);
  else if (input.pemNeatId) params.set("pemId", input.pemNeatId);
  else if (input.name) params.set("q", input.name);
  const qs = params.toString();
  return qs ? `/customers/lookup?${qs}` : "/customers/lookup";
}

function emptyGhl(
  error: string | null = null,
  status: DossierGhlSection["status"] = "empty",
): DossierGhlSection {
  return {
    status: error ? "error" : status,
    contactId: null,
    contactName: null,
    email: null,
    phone: null,
    ownerName: null,
    opportunities: [],
    snapshotText: null,
    ambiguous: false,
    clarificationMessage: null,
    error,
  };
}

function mapGhlSection(graph: GhlEntityGraph): DossierGhlSection {
  if (graph.ambiguous) {
    return {
      ...emptyGhl(null, "empty"),
      status: "empty",
      ambiguous: true,
      clarificationMessage: graph.clarificationMessage,
    };
  }
  if (!graph.contact) {
    return emptyGhl(null, "empty");
  }
  const contact = graph.contact;
  return {
    status: "ok",
    contactId: contact.id,
    contactName: contact.name ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    ownerName: graph.contactOwnerName ?? null,
    opportunities: graph.opportunities.map((row) => ({
      id: row.opportunity.id,
      name: row.opportunity.name ?? null,
      pipelineName: row.pipelineName,
      stageName: row.stageName,
      monetaryValue:
        typeof row.opportunity.monetaryValue === "number" ? row.opportunity.monetaryValue : null,
      status: row.opportunity.status ?? null,
    })),
    snapshotText: formatCustomerSnapshot(graph, {
      question: `tell me everything about ${contact.name ?? "this customer"}`,
    }),
    ambiguous: false,
    clarificationMessage: null,
    error: null,
  };
}

async function loadProjectSetupLinks(
  runId: string,
): Promise<Pick<DossierProjectSetupRun, "folderLink" | "charterLink" | "slackChannelId">> {
  try {
    const steps = await getProjectSetupSteps(runId);
    const byKey = new Map(steps.map((s: ProjectSetupStep) => [s.stepKey, s]));
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

function mapSetupRun(
  run: ProjectSetupRun,
  links: Pick<DossierProjectSetupRun, "folderLink" | "charterLink" | "slackChannelId">,
): DossierProjectSetupRun {
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
  };
}

/**
 * Optional overrides for unit tests — production callers omit this.
 */
export type AssembleCustomerDossierDeps = {
  resolveGhl?: typeof resolveGhlEntityGraph;
  buildPemIndex?: typeof buildPemProspectIndex;
  getPemById?: (id: string) => Promise<{
    id: string;
    prospect_name: string;
    meeting_date: string | null;
    meeting_outcome: string | null;
    qualification: string | null;
    status: string;
  } | null>;
  listSetupRuns?: (limit?: number) => Promise<ProjectSetupRun[]>;
  getSetupSteps?: typeof getProjectSetupSteps;
  listMonitoringFindings?: typeof listFindings;
};

/**
 * Assemble a read-only customer dossier across GHL, PEM NEAT, Project Setup,
 * and (admin-only) Process Monitoring. Each section fails independently.
 *
 * Hard scope: never suggests, links, or triggers Project Setup from a PEM outcome.
 */
export async function assembleCustomerDossier(
  input: AssembleCustomerDossierInput,
  deps: AssembleCustomerDossierDeps = {},
): Promise<CustomerDossier> {
  const includeMonitoring = input.includeMonitoring ?? isAdminRole(input.role ?? null);
  const resolveGhl = deps.resolveGhl ?? resolveGhlEntityGraph;
  const buildPemIndex = deps.buildPemIndex ?? buildPemProspectIndex;
  const listSetupRuns = deps.listSetupRuns ?? listProjectSetupRuns;
  const listMonitoring = deps.listMonitoringFindings ?? listFindings;
  const getPemById =
    deps.getPemById ??
    (async (id: string) => {
      const row = await getPemNeatStore().get(id);
      if (!row) return null;
      return {
        id: row.id,
        prospect_name: row.prospect_name,
        meeting_date: row.meeting_date,
        meeting_outcome: row.meeting_outcome,
        qualification: row.qualification,
        status: row.status,
      };
    });

  let displayName: string | null = input.name?.trim() || null;
  let ghlContactId: string | null = input.contactId?.trim() || null;
  const pemNeatId = input.pemNeatId?.trim() || null;

  // Seed identity from an explicit PEM id when provided.
  if (pemNeatId && !displayName) {
    try {
      const pem = await getPemById(pemNeatId);
      if (pem) displayName = pem.prospect_name;
    } catch {
      // PEM section will surface the error.
    }
  }

  // --- GHL (independent) ---
  let ghl: DossierGhlSection = emptyGhl(null, "unavailable");
  try {
    const query = displayName ?? "";
    const graph = await resolveGhl(query, {
      contactId: ghlContactId ?? undefined,
      includeAppointments: true,
      includeConversations: true,
    });
    ghl = mapGhlSection(graph);
    if (ghl.contactId) ghlContactId = ghl.contactId;
    if (ghl.contactName) displayName = ghl.contactName;
  } catch (err) {
    ghl = emptyGhl(err instanceof Error ? err.message : "Unable to load GoHighLevel data");
  }

  const matchName = displayName ?? input.name?.trim() ?? null;

  // --- PEM NEAT (independent) — reuse prospect-index name matching ---
  let pemNeats: DossierPemSection = { status: "unavailable", records: [], error: null };
  if (!canAccessPemEvidence(input.role)) {
    pemNeats = {
      status: "unavailable",
      records: [],
      error: "PEM NEAT evidence is not available for this role.",
    };
  } else {
    try {
      const records: DossierPemSection["records"] = [];
      if (pemNeatId) {
        const row = await getPemById(pemNeatId);
        if (row) {
          records.push({
            id: row.id,
            prospectName: row.prospect_name,
            meetingDate: row.meeting_date,
            meetingOutcome: row.meeting_outcome,
            qualification: row.qualification,
            status: row.status,
            matchScore: 100,
            href: pemNeatPath(row.id),
          });
        }
      }
      if (matchName) {
        const index = await buildPemIndex({ includeNeedsRegeneration: true });
        const matches = matchProspectInIndex(matchName, index);
        for (const match of matches) {
          if (records.some((r) => r.id === match.entry.pemId)) continue;
          records.push(await enrichPemFromIndex(match.entry, match.score, getPemById));
        }
      }
      pemNeats = {
        status: records.length > 0 ? "ok" : "empty",
        records,
        error: null,
      };
    } catch (err) {
      pemNeats = {
        status: "error",
        records: [],
        error: err instanceof Error ? err.message : "Unable to load PEM NEAT records",
      };
    }
  }

  // --- Project Setup (independent, display-only) ---
  let projectSetup: DossierProjectSetupSection = {
    status: "unavailable",
    runs: [],
    emptyMessage: null,
    error: null,
  };
  try {
    const allRuns = await listSetupRuns(100);
    const matched = allRuns.filter((run) => {
      if (ghlContactId && run.ghlContactId === ghlContactId) return true;
      if (!matchName) return false;
      const synthetic: PemProspectIndexEntry[] = [];
      const snapName = run.contactSnapshot?.name?.trim();
      const last = run.projectLastName?.trim();
      if (snapName) {
        synthetic.push({
          pemId: run.id,
          prospectName: snapName,
          normalizedName: snapName.toLowerCase(),
          baseName: snapName,
          normalizedBase: snapName.toLowerCase(),
          salesperson: "",
          meetingDate: null,
          status: run.status,
        });
      }
      if (last) {
        synthetic.push({
          pemId: `${run.id}:last`,
          prospectName: last,
          normalizedName: last.toLowerCase(),
          baseName: last,
          normalizedBase: last.toLowerCase(),
          salesperson: "",
          meetingDate: null,
          status: run.status,
        });
      }
      if (synthetic.length === 0) return false;
      return matchProspectInIndex(matchName, synthetic).length > 0;
    });

    // Deduplicate (name match may hit twice via last-name synthetic id)
    const byId = new Map<string, ProjectSetupRun>();
    for (const run of matched) byId.set(run.id, run);

    const runs: DossierProjectSetupRun[] = [];
    for (const run of byId.values()) {
      const links = await loadProjectSetupLinks(run.id);
      runs.push(mapSetupRun(run, links));
    }

    projectSetup = {
      status: runs.length > 0 ? "ok" : "empty",
      runs,
      emptyMessage: runs.length === 0 ? "No Project Setup run found for this customer." : null,
      error: null,
    };
  } catch (err) {
    projectSetup = {
      status: "error",
      runs: [],
      emptyMessage: null,
      error: err instanceof Error ? err.message : "Unable to load Project Setup runs",
    };
  }

  // --- Monitoring (admin-only) ---
  let monitoring: DossierMonitoringSection;
  if (!includeMonitoring) {
    monitoring = { status: "omitted", findings: [], error: null };
  } else {
    try {
      const findings: MonitoringFinding[] = ghlContactId
        ? await listMonitoring({
            contactId: ghlContactId,
            status: ["open", "alerted", "acknowledged"],
            limit: 50,
          })
        : [];
      monitoring = {
        status: findings.length > 0 ? "ok" : "empty",
        findings: findings.map((f) => ({
          id: f.id,
          title: f.title,
          severity: f.severity,
          status: f.status,
          checkKey: f.check_key,
          opportunityId: f.opportunity_id,
          href: "/admin/baxter/monitoring",
        })),
        error: null,
      };
    } catch (err) {
      monitoring = {
        status: "error",
        findings: [],
        error: err instanceof Error ? err.message : "Unable to load monitoring findings",
      };
    }
  }

  return {
    query: {
      contactId: input.contactId?.trim() || null,
      pemNeatId: pemNeatId,
      name: input.name?.trim() || null,
    },
    identity: {
      displayName,
      ghlContactId,
    },
    pagePath: dossierPagePath({
      contactId: ghlContactId,
      pemNeatId,
      name: displayName,
    }),
    ghl,
    pemNeats,
    projectSetup,
    monitoring,
  };
}

async function enrichPemFromIndex(
  entry: PemProspectIndexEntry,
  score: number,
  getPemById: NonNullable<AssembleCustomerDossierDeps["getPemById"]>,
): Promise<DossierPemSection["records"][number]> {
  try {
    const row = await getPemById(entry.pemId);
    if (row) {
      return {
        id: row.id,
        prospectName: row.prospect_name,
        meetingDate: row.meeting_date,
        meetingOutcome: row.meeting_outcome,
        qualification: row.qualification,
        status: row.status,
        matchScore: score,
        href: pemNeatPath(row.id),
      };
    }
  } catch {
    // Fall through to index-only shape.
  }
  return {
    id: entry.pemId,
    prospectName: entry.prospectName,
    meetingDate: entry.meetingDate,
    meetingOutcome: null,
    qualification: null,
    status: entry.status,
    matchScore: score,
    href: pemNeatPath(entry.pemId),
  };
}
