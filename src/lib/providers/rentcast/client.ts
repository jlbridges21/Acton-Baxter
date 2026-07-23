import "server-only";
import { getEnv } from "@/lib/env";
import { RentCastError } from "./errors";
import { rentCastResponseSchema } from "./schemas";
import type { RentCastRequestResult } from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function rentCastRequest(
  path: string,
  query: Record<string, string | number | undefined>,
): Promise<RentCastRequestResult<unknown>> {
  const env = getEnv();
  if (!env.RENTCAST_API_KEY) {
    throw new RentCastError("RENTCAST_API_KEY is not configured", { statusCode: 500 });
  }

  const base = env.RENTCAST_BASE_URL.replace(/\/$/, "");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const url = `${base}/${path.replace(/^\//, "")}?${params.toString()}`;

  let attempt = 0;
  while (attempt <= env.EXTERNAL_API_MAX_RETRIES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.EXTERNAL_API_TIMEOUT_MS);
    const started = Date.now();
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Api-Key": env.RENTCAST_API_KEY,
        },
        signal: controller.signal,
      });
      const responseTimeMs = Date.now() - started;
      const text = await response.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      if (response.status === 401 || response.status === 403) {
        throw new RentCastError(`RentCast authorization failed (${response.status})`, {
          statusCode: response.status,
        });
      }

      if (response.status === 404) {
        return {
          data: [],
          responseTimeMs,
          httpStatus: 404,
          endpoint: path,
          unavailable: true,
          statusMessage: "RentCast returned no property for this address.",
        };
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt < env.EXTERNAL_API_MAX_RETRIES) {
          attempt += 1;
          await sleep(300 * 2 ** attempt);
          continue;
        }
        throw new RentCastError(`RentCast temporary failure (${response.status})`, {
          statusCode: response.status,
          retryable: true,
        });
      }

      if (!response.ok) {
        throw new RentCastError(`RentCast request failed (${response.status})`, {
          statusCode: response.status,
        });
      }

      const parsed = rentCastResponseSchema.safeParse(data);
      return {
        data: parsed.success ? parsed.data : data,
        responseTimeMs,
        httpStatus: response.status,
        endpoint: path,
      };
    } catch (error) {
      if (error instanceof RentCastError) throw error;
      if (attempt < env.EXTERNAL_API_MAX_RETRIES) {
        attempt += 1;
        await sleep(300 * 2 ** attempt);
        continue;
      }
      throw new RentCastError(error instanceof Error ? error.message : "RentCast request failed", {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  throw new RentCastError("RentCast request failed after retries");
}

export function extractRentCastProperties(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter(
      (item): item is Record<string, unknown> => !!item && typeof item === "object",
    );
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.properties)) {
      return record.properties.filter(
        (item): item is Record<string, unknown> => !!item && typeof item === "object",
      );
    }
    if (Array.isArray(record.data)) {
      return record.data.filter(
        (item): item is Record<string, unknown> => !!item && typeof item === "object",
      );
    }
  }
  return [];
}
