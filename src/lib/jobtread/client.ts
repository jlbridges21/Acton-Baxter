/**
 * JobTread Pave API client (server-only, read-only).
 *
 * - Endpoint: POST https://api.jobtread.com/pave with `{ query: { $: { grantKey }, ... } }`.
 * - The grant key is read from JOBTREAD_GRANT_KEY and never logged, returned, or sent to a model.
 * - Read-only is enforced here: any query containing a mutation-style field is rejected
 *   before it leaves the server (the current grant is unrestricted, so this guard matters).
 * - Retries 429/5xx/timeouts with exponential backoff; surfaces 413 (response too large)
 *   as a typed error so pagers can shrink their page size.
 */

import "server-only";

import { createFixtureFetcher, isJobTreadFixtureEnabled } from "./fixture";

export const JOBTREAD_ENDPOINT = "https://api.jobtread.com/pave";
/** Acton ADU's organization (from currentGrant.user.memberships). Overridable per environment. */
export const DEFAULT_JOBTREAD_ORGANIZATION_ID = "22PfjMkZrDjJ";

export type JobTreadConfig = { grantKey: string; organizationId: string };

export function getJobTreadConfig(): JobTreadConfig | null {
  const grantKey = (process.env.JOBTREAD_GRANT_KEY ?? "").trim();
  if (!grantKey) return null;
  return {
    grantKey,
    organizationId:
      (process.env.JOBTREAD_ORGANIZATION_ID ?? "").trim() || DEFAULT_JOBTREAD_ORGANIZATION_ID,
  };
}

export function isJobTreadConfigured(): boolean {
  return getJobTreadConfig() !== null;
}

export class JobTreadError extends Error {
  readonly code:
    | "NOT_CONFIGURED"
    | "AUTH_FAILED"
    | "RATE_LIMITED"
    | "TOO_LARGE"
    | "BAD_QUERY"
    | "UNAVAILABLE"
    | "TIMEOUT"
    | "WRITE_BLOCKED";
  readonly status: number | null;
  constructor(message: string, code: JobTreadError["code"], status: number | null = null) {
    super(message);
    this.name = "JobTreadError";
    this.code = code;
    this.status = status;
  }
}

/** Field names that mutate data in Pave (createJob, updateAccount, deleteFile, sendDocument, …). */
const MUTATION_PATTERN =
  /^(create|update|delete|send|copy|cancel|rerun|mark|notify|close|rename|submit|sign|upload|merge|archive)[A-Z]/;

/** Throws if any key in the query tree looks like a mutation. Exported for tests. */
export function assertReadOnlyQuery(query: unknown, path = "query"): void {
  if (!query || typeof query !== "object" || Array.isArray(query)) return;
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (key === "$") continue; // inputs (where/sortBy/ids) are data, not fields
    const target = key === "_" ? String(value) : key;
    if (MUTATION_PATTERN.test(target) || target === "signQuery") {
      throw new JobTreadError(
        `Write operation "${target}" is not allowed (${path}).`,
        "WRITE_BLOCKED",
      );
    }
    if (key !== "_") assertReadOnlyQuery(value, `${path}.${key}`);
  }
}

export type PaveStats = { requests: number; retries: number; ms: number };

export function newStats(): PaveStats {
  return { requests: 0, retries: 0, ms: 0 };
}

type Fetcher = (body: string, signal: AbortSignal) => Promise<{ status: number; text: string }>;

let testFetcher: Fetcher | null = null;

/** Unit tests replace the network. */
export function setJobTreadFetcherForTests(fetcher: Fetcher | null): void {
  testFetcher = fetcher;
}

const defaultFetcher: Fetcher = async (body, signal) => {
  const response = await fetch(JOBTREAD_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
    cache: "no-store",
  });
  return { status: response.status, text: await response.text() };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Execute a read-only Pave query. `query` is everything under the root except `$`.
 */
export async function pave<T = Record<string, unknown>>(
  query: Record<string, unknown>,
  options: { stats?: PaveStats; timeoutMs?: number; maxRetries?: number } = {},
): Promise<T> {
  const config = getJobTreadConfig();
  if (!config) {
    throw new JobTreadError(
      "JobTread isn't connected. An administrator must set JOBTREAD_GRANT_KEY in Vercel.",
      "NOT_CONFIGURED",
    );
  }
  assertReadOnlyQuery(query);
  const body = JSON.stringify({ query: { $: { grantKey: config.grantKey }, ...query } });
  const maxRetries = options.maxRetries ?? 3;
  // E2E runs (never production) answer from the synthetic fixture instead of JobTread.
  const fetcher =
    testFetcher ?? (isJobTreadFixtureEnabled() ? createFixtureFetcher() : defaultFetcher);
  let attempt = 0;
  for (;;) {
    const started = Date.now();
    let result: { status: number; text: string };
    try {
      result = await fetcher(body, AbortSignal.timeout(options.timeoutMs ?? 30_000));
    } catch (error) {
      const timeout =
        error instanceof Error && /timeout|abort/i.test(`${error.name} ${error.message}`);
      if (attempt < maxRetries) {
        attempt++;
        if (options.stats) options.stats.retries++;
        await sleep(400 * 2 ** attempt);
        continue;
      }
      throw new JobTreadError(
        timeout ? "JobTread timed out." : "JobTread is unreachable.",
        timeout ? "TIMEOUT" : "UNAVAILABLE",
      );
    } finally {
      if (options.stats) {
        options.stats.requests++;
        options.stats.ms += Date.now() - started;
      }
    }
    const { status, text } = result;
    if (status === 200) {
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new JobTreadError("JobTread returned an unreadable response.", "UNAVAILABLE", status);
      }
    }
    // Never echo the request (it contains the grant key); response bodies are safe to excerpt.
    const detail = text.replace(config.grantKey, "[redacted]").slice(0, 300);
    if (status === 401 || status === 403) {
      throw new JobTreadError(
        "JobTread rejected the grant key (expired or revoked).",
        "AUTH_FAILED",
        status,
      );
    }
    if (status === 413)
      throw new JobTreadError("JobTread response too large.", "TOO_LARGE", status);
    if (status === 400)
      throw new JobTreadError(`JobTread rejected the query: ${detail}`, "BAD_QUERY", status);
    const retryable = status === 429 || status >= 500;
    if (retryable && attempt < maxRetries) {
      attempt++;
      if (options.stats) options.stats.retries++;
      await sleep((status === 429 ? 1500 : 500) * 2 ** attempt);
      continue;
    }
    throw new JobTreadError(
      status === 429
        ? "JobTread rate limit reached. Try again shortly."
        : `JobTread error (${status}).`,
      status === 429 ? "RATE_LIMITED" : "UNAVAILABLE",
      status,
    );
  }
}

/**
 * Page through an organization connection (jobs, costGroups, customFields, …) with cursor
 * pagination. Halves the page size when JobTread says the response is too large.
 */
export async function paginate<N>(input: {
  connection: string;
  alias?: string;
  args?: Record<string, unknown>;
  nodes: Record<string, unknown>;
  pageSize: number;
  maxPages?: number;
  stats?: PaveStats;
}): Promise<N[]> {
  const config = getJobTreadConfig();
  if (!config) throw new JobTreadError("JobTread isn't connected.", "NOT_CONFIGURED");
  const key = input.alias ?? input.connection;
  const out: N[] = [];
  let page: string | null = null;
  let size = input.pageSize;
  const maxPages = input.maxPages ?? 200;
  for (let i = 0; i < maxPages; i++) {
    const conn: Record<string, unknown> = {
      $: { ...(input.args ?? {}), size, ...(page ? { page } : {}) },
      nextPage: {},
      nodes: input.nodes,
    };
    if (input.alias) conn._ = input.connection;
    try {
      const res = await pave<{
        organization: Record<string, { nextPage: string | null; nodes: N[] }>;
      }>(
        { organization: { $: { id: config.organizationId }, id: {}, [key]: conn } },
        { stats: input.stats },
      );
      const block = res.organization[key]!;
      out.push(...block.nodes);
      page = block.nextPage;
      if (!page) return out;
    } catch (error) {
      if (error instanceof JobTreadError && error.code === "TOO_LARGE" && size > 5) {
        size = Math.max(5, Math.floor(size / 2));
        i--;
        continue;
      }
      throw error;
    }
  }
  throw new JobTreadError(`Stopped after ${maxPages} pages of ${input.connection}.`, "TOO_LARGE");
}

export function jobTreadJobUrl(jobId: string): string {
  return `https://app.jobtread.com/jobs/${encodeURIComponent(jobId)}`;
}
