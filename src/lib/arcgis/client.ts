import "server-only";
import { getEnv } from "@/lib/env";
import { ArcgisError } from "./errors";
import type { ArcgisRequestResult } from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function arcgisFetchJson<T>(
  url: string,
  options?: {
    timeoutMs?: number;
    maxRetries?: number;
    init?: RequestInit;
  },
): Promise<ArcgisRequestResult<T>> {
  const env = getEnv();
  const timeoutMs = options?.timeoutMs ?? env.EXTERNAL_API_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? env.EXTERNAL_API_MAX_RETRIES;
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const response = await fetch(url, {
        ...options?.init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(options?.init?.headers ?? {}),
        },
      });
      const responseTimeMs = Date.now() - started;
      const text = await response.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new ArcgisError("ArcGIS returned non-JSON response", {
          statusCode: response.status,
          endpoint: url.split("?")[0] ?? url,
        });
      }

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < maxRetries) {
          attempt += 1;
          await sleep(250 * 2 ** attempt);
          continue;
        }
        throw new ArcgisError(`ArcGIS request failed with HTTP ${response.status}`, {
          statusCode: response.status,
          endpoint: url.split("?")[0] ?? url,
        });
      }

      return {
        data: data as T,
        responseTimeMs,
        httpStatus: response.status,
        endpoint: url.split("?")[0] ?? url,
      };
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("fetch failed"));
      if (retryable && attempt < maxRetries) {
        attempt += 1;
        await sleep(250 * 2 ** attempt);
        continue;
      }
      if (error instanceof ArcgisError) throw error;
      throw new ArcgisError(error instanceof Error ? error.message : "ArcGIS request failed", {
        endpoint: url.split("?")[0] ?? url,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ArcgisError("ArcGIS request failed", { endpoint: url });
}
