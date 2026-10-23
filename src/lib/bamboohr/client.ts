/**
 * Authorized, read-only HTTP client for BambooHR's REST API:
 *   https://{companyDomain}.bamboohr.com/api/v1/...  with  Authorization: Bearer <access token>
 * GET only — this module cannot write. Retries 429/5xx with backoff (honoring Retry-After),
 * refreshes once on 401, and turns every failure into a BambooError with an actionable message.
 */

import "server-only";

import {
  accessToken,
  bambooFetch,
  recordFailure,
  recordSuccess,
  refreshAccessToken,
  type ConnectionRow,
} from "./connection";
import { BambooError } from "./errors";

const MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let sleeper: (ms: number) => Promise<void> = sleep;
export function setBambooSleepForTests(f: ((ms: number) => Promise<void>) | null) {
  sleeper = f ?? sleep;
}

export type ApiResult<T> = { body: T; status: number; headers: Headers; connection: ConnectionRow };

/** GET a BambooHR API path (e.g. "/v1/employees/123?fields=jobTitle"). `scopeHint` names the scope a 403 most likely means. */
export async function bambooGet<T>(
  path: string,
  opts: { scopeHint?: string; what: string } = { what: "BambooHR data" },
): Promise<ApiResult<T>> {
  if (!path.startsWith("/v1/")) throw new Error("bambooGet expects an /v1/ path");
  const auth = await accessToken();
  const row = auth.row;
  let token = auth.token;
  const url = `https://${row.company_domain}.bamboohr.com/api${path}`;
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await bambooFetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
    } catch {
      if (attempt < MAX_RETRIES) {
        await sleeper(500 * 2 ** attempt);
        continue;
      }
      await recordFailure(row, "BambooHR couldn't be reached.");
      throw new BambooError("BambooHR couldn't be reached. Try again shortly.", "temporary", true);
    }
    if (res.ok) {
      await recordSuccess(row);
      const body = res.status === 204 ? (null as T) : ((await res.json().catch(() => null)) as T);
      return { body, status: res.status, headers: res.headers, connection: row };
    }
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      token = await refreshAccessToken(row, true);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleeper(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 30) * 1000
          : 500 * 2 ** attempt,
      );
      continue;
    }
    const providerMessage = (res.headers.get("x-bamboohr-error-message") ?? "").slice(0, 160);
    switch (res.status) {
      case 401:
        await recordFailure(row, "BambooHR rejected the access token.", true);
        throw new BambooError("Your BambooHR connection needs to be reauthorized.", "reauthorize");
      case 403:
        throw new BambooError(
          `BambooHR is connected, but the application does not have permission to read ${opts.what}${opts.scopeHint ? ` (needs the "${opts.scopeHint}" scope or BambooHR access-level permission)` : ""}.${providerMessage ? ` BambooHR says: ${providerMessage}` : ""}`,
          "missing_scope",
        );
      case 404:
        throw new BambooError(
          `BambooHR found nothing for ${opts.what}. Check the employee id.`,
          "not_found",
        );
      case 429:
        await recordFailure(row, "BambooHR rate limit reached.");
        throw new BambooError(
          "BambooHR is rate-limiting requests. Try again in a minute.",
          "rate_limited",
          true,
        );
      default:
        if (res.status >= 500) {
          await recordFailure(row, `BambooHR returned ${res.status}.`);
          throw new BambooError(
            "BambooHR is temporarily unavailable. Try again shortly.",
            "temporary",
            true,
          );
        }
        throw new BambooError(
          `BambooHR refused the request for ${opts.what} (${res.status}).`,
          "unsupported",
        );
    }
  }
}
