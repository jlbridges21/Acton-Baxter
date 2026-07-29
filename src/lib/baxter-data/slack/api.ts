import type { SlackApiCallResult } from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Default per-request Slack Web API timeout (AbortController). */
export const SLACK_API_DEFAULT_TIMEOUT_MS = 15_000;
/** Cap Retry-After sleeps so a single call cannot stall for minutes. */
const MAX_RETRY_AFTER_SECONDS = 10;

/**
 * Low-level Slack Web API caller with bounded rate-limit retries and hard timeouts.
 * Never logs tokens or message bodies.
 */
export async function callSlackApi(
  method: string,
  options: {
    token: string;
    body?: Record<string, unknown>;
    form?: boolean;
    maxRetries?: number;
    timeoutMs?: number;
  },
): Promise<SlackApiCallResult> {
  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? SLACK_API_DEFAULT_TIMEOUT_MS;
  let last: SlackApiCallResult = { ok: false, error: "request_failed", data: {} };

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`https://slack.com/api/${method}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${options.token}`,
          "Content-Type": options.form
            ? "application/x-www-form-urlencoded"
            : "application/json; charset=utf-8",
        },
        body: options.form
          ? new URLSearchParams(
              Object.entries(options.body ?? {}).flatMap(([k, v]) => {
                if (v === undefined || v === null) return [];
                if (Array.isArray(v)) return [[k, v.join(",")] as [string, string]];
                if (typeof v === "boolean" || typeof v === "number") {
                  return [[k, String(v)] as [string, string]];
                }
                return [[k, String(v)] as [string, string]];
              }),
            ).toString()
          : JSON.stringify(options.body ?? {}),
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted =
        (error instanceof Error && error.name === "AbortError") ||
        (typeof DOMException !== "undefined" &&
          error instanceof DOMException &&
          error.name === "AbortError");
      last = {
        ok: false,
        error: aborted ? "timeout" : "request_failed",
        data: {},
        httpStatus: aborted ? 408 : undefined,
        retryAfterSeconds: null,
      };
      if (aborted || attempt >= maxRetries) return last;
      continue;
    } finally {
      clearTimeout(timer);
    }

    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : null;
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
      ok?: boolean;
      error?: string;
    };

    if (response.status === 429 || data.error === "ratelimited" || data.error === "rate_limited") {
      last = {
        ok: false,
        error: "ratelimited",
        data,
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 3,
        httpStatus: 429,
      };
      if (attempt < maxRetries) {
        const wait = Math.min(Math.max(last.retryAfterSeconds ?? 2, 1), MAX_RETRY_AFTER_SECONDS);
        await sleep(wait * 1000);
        continue;
      }
      return last;
    }

    // Do not retry auth/scope failures
    if (
      data.error === "invalid_auth" ||
      data.error === "missing_scope" ||
      data.error === "not_allowed_token_type" ||
      data.error === "access_denied"
    ) {
      return {
        ok: false,
        error: data.error,
        data,
        httpStatus: response.status,
        retryAfterSeconds: null,
      };
    }

    if (!response.ok || !data.ok) {
      return {
        ok: false,
        error: data.error ?? "request_failed",
        data,
        httpStatus: response.status,
        retryAfterSeconds: null,
      };
    }

    return { ok: true, data, httpStatus: response.status, retryAfterSeconds: null };
  }

  return last;
}

export type SlackApiCaller = typeof callSlackApi;
