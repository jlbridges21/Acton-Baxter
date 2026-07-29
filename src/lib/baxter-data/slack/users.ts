import type { ResolvedSlackPerson, SlackPersonAmbiguity, SlackSearchDeps } from "./types";

const ALIASES: Record<string, string[]> = {
  jess: ["jessica", "jess"],
  jessica: ["jess", "jessica"],
  maxx: ["max", "maxx"],
  max: ["maxx", "max"],
  jackson: ["jackson bridges", "jackson"],
  zach: ["zach", "zachary"],
  zachary: ["zach", "zachary"],
};

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasSet(query: string): Set<string> {
  const n = normalizeName(query);
  const set = new Set<string>([n]);
  for (const a of ALIASES[n] ?? []) set.add(normalizeName(a));
  return set;
}

function firstName(value: string | null | undefined): string {
  return normalizeName((value ?? "").split(/\s+/)[0] ?? "");
}

export type PersonResolution =
  | { status: "resolved"; person: ResolvedSlackPerson }
  | { status: "ambiguous"; ambiguity: SlackPersonAmbiguity }
  | { status: "not_found"; query: string };

/**
 * Resolve a person against the directory.
 * Order: exact display → exact real → exact username → unique first-name → alias → ambiguity.
 * Bots should already be excluded from the directory list.
 */
export function resolvePersonFromDirectory(
  query: string,
  directory: ResolvedSlackPerson[],
): PersonResolution {
  const q = query.trim();
  if (!q) return { status: "not_found", query: q };

  if (/^U[A-Z0-9]+$/i.test(q)) {
    const byId = directory.find((p) => p.id === q);
    if (byId) return { status: "resolved", person: byId };
    return { status: "not_found", query: q };
  }

  const nq = normalizeName(q);
  const aliases = aliasSet(q);

  const exactDisplay = directory.filter((p) => normalizeName(p.displayName) === nq);
  if (exactDisplay.length === 1) return { status: "resolved", person: exactDisplay[0]! };
  if (exactDisplay.length > 1) {
    return { status: "ambiguous", ambiguity: { query: q, candidates: exactDisplay.slice(0, 8) } };
  }

  const exactReal = directory.filter((p) => p.realName && normalizeName(p.realName) === nq);
  if (exactReal.length === 1) return { status: "resolved", person: exactReal[0]! };
  if (exactReal.length > 1) {
    return { status: "ambiguous", ambiguity: { query: q, candidates: exactReal.slice(0, 8) } };
  }

  const exactUser = directory.filter((p) => p.username && normalizeName(p.username) === nq);
  if (exactUser.length === 1) return { status: "resolved", person: exactUser[0]! };

  // Unique first-name match (active humans only in directory)
  const firstMatches = directory.filter((p) => {
    const firsts = [firstName(p.realName), firstName(p.displayName)].filter(Boolean);
    return firsts.some((f) => aliases.has(f) || f === nq);
  });
  if (firstMatches.length === 1) return { status: "resolved", person: firstMatches[0]! };
  if (firstMatches.length > 1) {
    return {
      status: "ambiguous",
      ambiguity: { query: q, candidates: firstMatches.slice(0, 8) },
    };
  }

  return { status: "not_found", query: q };
}

export async function resolvePeople(
  queries: string[],
  teamId: string,
  deps?: SlackSearchDeps,
): Promise<{
  people: ResolvedSlackPerson[];
  ambiguities: SlackPersonAmbiguity[];
  notFound: string[];
}> {
  const directory = deps?.listCachedUsers ? await deps.listCachedUsers(teamId) : [];
  const people: ResolvedSlackPerson[] = [];
  const ambiguities: SlackPersonAmbiguity[] = [];
  const notFound: string[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    const result = resolvePersonFromDirectory(query, directory);
    if (result.status === "resolved") {
      if (!seen.has(result.person.id)) {
        seen.add(result.person.id);
        people.push(result.person);
      }
    } else if (result.status === "ambiguous") {
      ambiguities.push(result.ambiguity);
    } else {
      notFound.push(result.query);
    }
  }

  return { people, ambiguities, notFound };
}

export function formatPersonLabel(person: ResolvedSlackPerson): string {
  return person.displayName || person.realName || person.username || "Slack user";
}
