import "server-only";

import { GHL_API_VERSION, GHL_API_BASE_URL } from "./types";
import { getGhlRuntimeConfig, requireGhlLocationId } from "./config";
import { resolveGhlCredentialProvider } from "./auth";
import {
  GhlConnectorError,
  GhlRateLimitError,
  classifyGhlApiError,
  isRetryableGhlError,
} from "./errors";

export type GhlRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  version?: string;
  injectLocationId?: boolean;
  locationIdParam?: "locationId" | "location_id";
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_BASE_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  return null;
}

export async function ghlRequest<T>(options: GhlRequestOptions): Promise<T> {
  const config = getGhlRuntimeConfig();
  const baseUrl = config.apiBaseUrl || GHL_API_BASE_URL;
  const version = options.version ?? GHL_API_VERSION;
  const method = options.method ?? "GET";
  const fetchFn = options.fetchImpl ?? fetch;

  const provider = await resolveGhlCredentialProvider();
  const token = await provider.getAccessToken();

  const locationId = requireGhlLocationId();

  const url = new URL(options.path.startsWith("/") ? options.path : `/${options.path}`, baseUrl);

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  if (options.injectLocationId !== false) {
    const paramName = options.locationIdParam ?? "locationId";
    if (!url.searchParams.has(paramName) && !url.searchParams.has("location_id")) {
      url.searchParams.set(paramName, locationId);
    }
  }

  let body: string | undefined;
  if (options.body !== undefined) {
    const bodyObj = options.body as Record<string, unknown>;
    if (options.injectLocationId !== false) {
      const paramName = options.locationIdParam ?? "locationId";
      if (bodyObj && typeof bodyObj === "object" && !bodyObj[paramName] && !bodyObj.location_id) {
        (bodyObj as Record<string, unknown>)[paramName] = locationId;
      }
    }
    body = JSON.stringify(bodyObj);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Version: version,
    Accept: "application/json",
  };

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      const response = await fetchFn(url.toString(), {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          return (await response.json()) as T;
        }
        return (await response.text()) as unknown as T;
      }

      const responseText = await response.text().catch(() => "");
      const errorCode = classifyGhlApiError(response.status, responseText);

      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
        if (attempt < MAX_RETRIES) {
          const delayMs = retryAfter ?? RETRY_DELAY_BASE_MS * Math.pow(2, attempt);
          await sleep(Math.min(delayMs, 30000));
          continue;
        }
        throw new GhlRateLimitError(
          `Rate limited on ${method} ${options.path}: ${responseText.slice(0, 100)}`,
          retryAfter,
        );
      }

      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_BASE_MS * Math.pow(2, attempt));
        continue;
      }

      throw new GhlConnectorError(
        `GHL API ${method} ${options.path} failed (${response.status}): ${responseText.slice(0, 200)}`,
        {
          code: errorCode,
          statusCode: response.status,
          expose: true,
        },
      );
    } catch (error) {
      if (error instanceof GhlConnectorError || error instanceof GhlRateLimitError) {
        if (!isRetryableGhlError(error) || attempt >= MAX_RETRIES) {
          throw error;
        }
        lastError = error;
        await sleep(RETRY_DELAY_BASE_MS * Math.pow(2, attempt));
        continue;
      }

      if (error instanceof Error && error.name === "AbortError") {
        if (attempt < MAX_RETRIES) {
          lastError = error;
          await sleep(RETRY_DELAY_BASE_MS * Math.pow(2, attempt));
          continue;
        }
        throw new GhlConnectorError(
          `GHL API ${method} ${options.path} timed out after ${DEFAULT_TIMEOUT_MS}ms`,
          { code: "BAXTER_GHL_API_UNAVAILABLE", statusCode: 504, expose: true },
        );
      }

      throw new GhlConnectorError(
        `GHL API ${method} ${options.path} failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        { code: "BAXTER_GHL_API_UNAVAILABLE", statusCode: 502, expose: true, cause: error },
      );
    }
  }

  throw (
    lastError ??
    new GhlConnectorError(
      `GHL API ${method} ${options.path} failed after ${MAX_RETRIES + 1} attempts`,
      { code: "BAXTER_GHL_API_UNAVAILABLE", statusCode: 502, expose: true },
    )
  );
}

export async function ghlGet<T>(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
  options?: Partial<GhlRequestOptions>,
): Promise<T> {
  return ghlRequest<T>({ ...options, method: "GET", path, query });
}

export async function ghlPost<T>(
  path: string,
  body?: unknown,
  options?: Partial<GhlRequestOptions>,
): Promise<T> {
  return ghlRequest<T>({ ...options, method: "POST", path, body });
}

export async function ghlPut<T>(
  path: string,
  body?: unknown,
  options?: Partial<GhlRequestOptions>,
): Promise<T> {
  return ghlRequest<T>({ ...options, method: "PUT", path, body });
}

export async function ghlPatch<T>(
  path: string,
  body?: unknown,
  options?: Partial<GhlRequestOptions>,
): Promise<T> {
  return ghlRequest<T>({ ...options, method: "PATCH", path, body });
}

export async function ghlDelete<T>(path: string, options?: Partial<GhlRequestOptions>): Promise<T> {
  return ghlRequest<T>({ ...options, method: "DELETE", path });
}
