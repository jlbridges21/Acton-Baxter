/**
 * Resolve "the [Name] project" via Project Setup runs → linked GHL contact.
 * Prefer this over fuzzy surname contact search when exactly one run matches.
 */

import "server-only";

import { normalizeEntitySearchName } from "@/lib/baxter-ai/entity-name-normalize";
import { listProjectSetupRuns } from "@/lib/project-setup/store";
import type { ProjectSetupRun } from "@/lib/project-setup/types";
import { extractProjectNameQueries } from "@/lib/baxter-data/slack/project-status";

export type ProjectSetupNameMatch = {
  run: ProjectSetupRun;
  ghlContactId: string;
  displayName: string;
  matchVia: "project_last_name" | "slack_channel" | "contact_snapshot";
};

export type ResolveProjectSetupByNameDeps = {
  listSetupRuns?: (limit?: number) => Promise<ProjectSetupRun[]>;
};

/** Strong phrasing: "the Yeh project", "Yeh project", "Liniger's project". */
export function extractProjectReferenceName(question: string): string | null {
  const q = question.trim();
  if (!q) return null;

  const possessive = q.match(
    /\b([A-Za-z][A-Za-z'-]{1,40}(?:\s+[A-Za-z][A-Za-z'-]{1,40}){0,2})(?:'s|’s)\s+project\b/i,
  );
  if (possessive?.[1]) {
    const name = normalizeEntitySearchName(possessive[1]) || possessive[1].trim();
    if (name.length >= 2) return name;
  }

  // Require "the … project" so "What city is the Yeh project" → "Yeh", not "city is the Yeh".
  const theProject = q.match(
    /\bthe\s+([A-Za-z][A-Za-z'-]{1,40}(?:\s+[A-Za-z][A-Za-z'-]{1,40}){0,3})\s+project\b/i,
  );
  if (theProject?.[1]) {
    const raw = theProject[1].trim();
    if (/^(his|her|their|its|my|your|our|this|that|a|an)$/i.test(raw)) return null;
    if (/^(new|adu|sales|design|slack|pem|neat)$/i.test(raw)) return null;
    const name = normalizeEntitySearchName(raw) || raw;
    if (name.length >= 2) return name;
  }

  // "Yeh project" / "Katie Liniger project" without leading "the"
  const bare = q.match(
    /\b([A-Za-z][A-Za-z'-]{1,40}(?:\s+[A-Za-z][A-Za-z'-]{1,40}){0,2})\s+project\b/i,
  );
  if (bare?.[1]) {
    const raw = bare[1].trim();
    if (
      /^(his|her|their|its|my|your|our|this|that|a|an|the|new|adu|what|which|whose|city|is)$/i.test(
        raw,
      )
    ) {
      return null;
    }
    // Reject if the capture includes filler verbs/articles (over-greedy).
    if (/\b(is|are|was|were|city|email|phone|address|about|info|information)\b/i.test(raw)) {
      return null;
    }
    const name = normalizeEntitySearchName(raw) || raw;
    if (name.length >= 2) return name;
  }

  const fromExtract = extractProjectNameQueries(q)[0];
  if (fromExtract && fromExtract.length >= 2) return fromExtract;
  return null;
}

function scoreRunAgainstName(
  run: ProjectSetupRun,
  query: string,
): {
  score: number;
  via: ProjectSetupNameMatch["matchVia"] | null;
} {
  const q = (normalizeEntitySearchName(query) || query).trim().toLowerCase();
  if (!q) return { score: 0, via: null };

  const last = (run.projectLastName ?? "").trim().toLowerCase();
  if (last && (last === q || last.includes(q) || q.includes(last))) {
    const score = last === q ? 100 : Math.min(90, 60 + Math.min(last.length, q.length));
    return { score, via: "project_last_name" };
  }

  const channel = (run.slackChannelName ?? "").replace(/^#/, "").trim().toLowerCase();
  if (channel) {
    const slug = q.replace(/\s+/g, "-");
    if (channel === slug || channel.endsWith(`-${slug}`) || channel.includes(slug)) {
      return {
        score: channel.endsWith(`-${slug}`) || channel === slug ? 95 : 70,
        via: "slack_channel",
      };
    }
  }

  const snap =
    run.contactSnapshot?.name?.trim().toLowerCase() ||
    [run.contactSnapshot?.firstName, run.contactSnapshot?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toLowerCase();
  if (snap && (snap === q || snap.includes(q) || q.includes(snap.split(/\s+/).pop() ?? ""))) {
    return { score: snap === q ? 85 : 55, via: "contact_snapshot" };
  }

  return { score: 0, via: null };
}

function displayNameForRun(run: ProjectSetupRun): string {
  const snap = run.contactSnapshot?.name?.trim();
  if (snap) return snap;
  const parts = [run.contactSnapshot?.firstName, run.contactSnapshot?.lastName].filter(Boolean);
  if (parts.length) return parts.join(" ");
  if (run.projectLastName?.trim()) return run.projectLastName.trim();
  return run.projectNumber ?? "Project";
}

/**
 * Find Project Setup run(s) matching a project name / last name / channel slug.
 * Prefer complete (non-dry-run) runs with a linked GHL contact.
 */
export async function resolveProjectSetupRunsByName(
  projectName: string,
  deps: ResolveProjectSetupByNameDeps = {},
): Promise<ProjectSetupNameMatch[]> {
  const name = (normalizeEntitySearchName(projectName) || projectName).trim();
  if (name.length < 2) return [];

  const list = deps.listSetupRuns ?? listProjectSetupRuns;
  const runs = await list(200);
  const scored: ProjectSetupNameMatch[] = [];

  for (const run of runs) {
    if (run.dryRun) continue;
    const contactId = run.ghlContactId?.trim();
    if (!contactId) continue;
    if (run.status !== "complete" && run.status !== "failed") {
      // Allow complete primarily; also in-progress with channel already set.
      if (!run.slackChannelName?.trim()) continue;
    }
    const { score, via } = scoreRunAgainstName(run, name);
    if (score < 55 || !via) continue;
    scored.push({
      run,
      ghlContactId: contactId,
      displayName: displayNameForRun(run),
      matchVia: via,
    });
  }

  scored.sort((a, b) => {
    const statusBoost = (r: ProjectSetupNameMatch) => (r.run.status === "complete" ? 10 : 0);
    return (
      scoreRunAgainstName(b.run, name).score +
      statusBoost(b) -
      (scoreRunAgainstName(a.run, name).score + statusBoost(a))
    );
  });

  // Deduplicate by ghl contact id (prefer best score).
  const byContact = new Map<string, ProjectSetupNameMatch>();
  for (const m of scored) {
    if (!byContact.has(m.ghlContactId)) byContact.set(m.ghlContactId, m);
  }
  return [...byContact.values()];
}

/** Exactly one project match → confident entity resolution. */
export async function resolveUniqueProjectSetupByName(
  projectName: string,
  deps: ResolveProjectSetupByNameDeps = {},
): Promise<ProjectSetupNameMatch | null> {
  const matches = await resolveProjectSetupRunsByName(projectName, deps);
  return matches.length === 1 ? matches[0]! : null;
}
