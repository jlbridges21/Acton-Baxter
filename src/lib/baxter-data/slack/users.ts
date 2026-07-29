import type { ResolvedSlackPerson, SlackPersonAmbiguity, SlackSearchDeps } from "./types";

const ALIASES: Record<string, string[]> = {
  jess: ["jessica", "jess"],
  jessica: ["jess", "jessica"],
  maxx: ["max", "maxx"],
  max: ["maxx", "max"],
  jackson: ["jackson bridges", "jackson"],
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

function personMatches(person: ResolvedSlackPerson, query: string): boolean {
  const aliases = aliasSet(query);
  const candidates = [
    person.displayName,
    person.realName ?? "",
    person.username ?? "",
    (person.realName ?? "").split(/\s+/)[0] ?? "",
    (person.displayName ?? "").split(/\s+/)[0] ?? "",
  ]
    .map(normalizeName)
    .filter(Boolean);

  for (const c of candidates) {
    if (aliases.has(c)) return true;
    for (const a of aliases) {
      if (c === a || c.startsWith(`${a} `) || c.endsWith(` ${a}`) || c.includes(` ${a} `)) {
        return true;
      }
    }
  }
  return false;
}

export type PersonResolution =
  | { status: "resolved"; person: ResolvedSlackPerson }
  | { status: "ambiguous"; ambiguity: SlackPersonAmbiguity }
  | { status: "not_found"; query: string };

export function resolvePersonFromDirectory(
  query: string,
  directory: ResolvedSlackPerson[],
): PersonResolution {
  const q = query.trim();
  if (!q) return { status: "not_found", query: q };

  // Exact ID pass-through for internal use (never shown to employees).
  if (/^U[A-Z0-9]+$/i.test(q)) {
    const byId = directory.find((p) => p.id === q);
    if (byId) return { status: "resolved", person: byId };
    return { status: "not_found", query: q };
  }

  const matches = directory.filter((p) => personMatches(p, q));
  if (matches.length === 1) return { status: "resolved", person: matches[0]! };
  if (matches.length > 1) {
    // Prefer exact first-name uniqueness among display/real names
    const exactFirst = matches.filter((p) => {
      const first = normalizeName((p.realName || p.displayName).split(/\s+/)[0] ?? "");
      return aliasSet(q).has(first);
    });
    if (exactFirst.length === 1) return { status: "resolved", person: exactFirst[0]! };
    return {
      status: "ambiguous",
      ambiguity: { query: q, candidates: matches.slice(0, 8) },
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
