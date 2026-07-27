import "server-only";

import { GHL_API_BASE_URL } from "./types";
import { getGhlRuntimeConfig, requireGhlLocationId } from "./config";
import { resolveGhlCredentialProvider } from "./auth";
import {
  GhlConnectorError,
  GhlRateLimitError,
  classifyGhlApiError,
  isRetryableGhlError,
} from "./errors";
import {
  type GhlApiResource,
  inferGhlResourceFromPath,
  resolveGhlApiVersion,
} from "./api-versions";
import { recordGhlRequestDiagnostic } from "./request-diagnostics";

export type GhlRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Explicit Version header override. Prefer `resource`. */
  version?: string;
  /** Resource family for Version header resolution. */
  resource?: GhlApiResource;
  /**
   * When true (default), inject locationId into query/body if missing.
   * Opportunity search and most list endpoints need this.
   * Set false when location is already in the path.
   */
  injectLocationId?: boolean;
  /** Param name for location injection. Default locationId (v3 camelCase). */
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

/** Strip undefined/null/empty-string query values so we never send locationId= */
export function sanitizeGhlQuery(
  query?: Record<string, string | number | boolean | undefined | null>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!query) return out;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    out[key] = value;
  }
  return out;
}

export async function ghlRequest<T>(options: GhlRequestOptions): Promise<T> {
  const config = getGhlRuntimeConfig();
  const baseUrl = config.apiBaseUrl || GHL_API_BASE_URL;
  const resource = options.resource ?? inferGhlResourceFromPath(options.path);
  const version = options.version ?? resolveGhlApiVersion(resource);
  const method = options.method ?? "GET";
  const fetchFn = options.fetchImpl ?? fetch;

  const provider = await resolveGhlCredentialProvider();
  const token = await provider.getAccessToken();

  const locationId = requireGhlLocationId();
  const locationParam = options.locationIdParam ?? "locationId";

  const url = new URL(options.path.startsWith("/") ? options.path : `/${options.path}`, baseUrl);

  const sanitizedQuery = sanitizeGhlQuery(options.query);
  for (const [key, value] of Object.entries(sanitizedQuery)) {
    url.searchParams.set(key, String(value));
  }

  if (options.injectLocationId !== false) {
    const hasLocation = url.searchParams.has("locationId") || url.searchParams.has("location_id");
    if (!hasLocation) {
      url.searchParams.set(locationParam, locationId);
    }
  }

  // Never send both locationId and location_id
  if (url.searchParams.has("locationId") && url.searchParams.has("location_id")) {
    url.searchParams.delete("location_id");
  }

  let body: string | undefined;
  let bodyObj: Record<string, unknown> | undefined;
  if (options.body !== undefined) {
    bodyObj =
      options.body && typeof options.body === "object"
        ? { ...(options.body as Record<string, unknown>) }
        : undefined;
    if (bodyObj && options.injectLocationId !== false) {
      if (!bodyObj.locationId && !bodyObj.location_id) {
        bodyObj[locationParam] = locationId;
      }
      if (bodyObj.locationId && bodyObj.location_id) {
        delete bodyObj.location_id;
      }
      // Strip empty string fields from body
      for (const [k, v] of Object.entries(bodyObj)) {
        if (v === undefined || v === null || v === "") {
          delete bodyObj[k];
        }
      }
    }
    body = JSON.stringify(bodyObj ?? options.body);
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
  const started = Date.now();

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
      const latencyMs = Date.now() - started;

      if (response.ok) {
        recordGhlRequestDiagnostic({
          resource,
          method,
          path: options.path,
          apiVersion: version,
          statusCode: response.status,
          latencyMs,
          errorCode: null,
          errorSummary: null,
          ok: true,
        });
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          return (await response.json()) as T;
        }
        return (await response.text()) as unknown as T;
      }

      const responseText = await response.text().catch(() => "");
      const errorCode = classifyGhlApiError(response.status, responseText);

      recordGhlRequestDiagnostic({
        resource,
        method,
        path: options.path,
        apiVersion: version,
        statusCode: response.status,
        latencyMs,
        errorCode,
        errorSummary: responseText.slice(0, 200),
        ok: false,
      });

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
        recordGhlRequestDiagnostic({
          resource,
          method,
          path: options.path,
          apiVersion: version,
          statusCode: 504,
          latencyMs: Date.now() - started,
          errorCode: "BAXTER_GHL_API_UNAVAILABLE",
          errorSummary: "timeout",
          ok: false,
        });
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
  query?: Record<string, string | number | boolean | undefined | null>,
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
