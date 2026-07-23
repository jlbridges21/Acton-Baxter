import "server-only";
import { getEnv } from "@/lib/env";
import { AttomError } from "./errors";
import { attomResponseSchema } from "./schemas";
import type { AttomRequestResult } from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeMessage(message: string) {
  return message.replace(/apikey[=:]\s*\S+/gi, "apikey=[redacted]");
}

export async function attomRequest(
  packagePath: string,
  query: Record<string, string | number | undefined>,
): Promise<AttomRequestResult<unknown>> {
  const env = getEnv();
  if (!env.ATTOM_API_KEY) {
    throw new AttomError("ATTOM_API_KEY is not configured", {
      statusCode: 500,
      packageName: packagePath,
    });
  }

  const base = env.ATTOM_BASE_URL.replace(/\/$/, "");
  const path = packagePath.replace(/^\//, "");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const url = `${base}/${path}?${params.toString()}`;

  let attempt = 0;
  while (attempt <= env.EXTERNAL_API_MAX_RETRIES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.EXTERNAL_API_TIMEOUT_MS);
    const started = Date.now();
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          APIKey: env.ATTOM_API_KEY,
        },
        signal: controller.signal,
      });
      const responseTimeMs = Date.now() - started;
      const text = await response.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { rawText: text.slice(0, 500) };
      }

      if (response.status === 401 || response.status === 403) {
        throw new AttomError(sanitizeMessage(`ATTOM authorization failed (${response.status})`), {
          statusCode: response.status,
          packageName: packagePath,
        });
      }

      if (response.status === 404) {
        return {
          data,
          responseTimeMs,
          httpStatus: 404,
          packagePath,
          unavailable: true,
          statusMessage: "ATTOM package or property not found for this account/query.",
        };
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt < env.EXTERNAL_API_MAX_RETRIES) {
          attempt += 1;
          await sleep(300 * 2 ** attempt);
          continue;
        }
        throw new AttomError(sanitizeMessage(`ATTOM temporary failure (${response.status})`), {
          statusCode: response.status,
          packageName: packagePath,
          retryable: true,
        });
      }

      if (!response.ok) {
        throw new AttomError(sanitizeMessage(`ATTOM request failed (${response.status})`), {
          statusCode: response.status,
          packageName: packagePath,
        });
      }

      const parsed = attomResponseSchema.safeParse(data);
      return {
        data: parsed.success ? parsed.data : data,
        responseTimeMs,
        httpStatus: response.status,
        packagePath,
      };
    } catch (error) {
      if (error instanceof AttomError) throw error;
      if (attempt < env.EXTERNAL_API_MAX_RETRIES) {
        attempt += 1;
        await sleep(300 * 2 ** attempt);
        continue;
      }
      throw new AttomError(
        sanitizeMessage(error instanceof Error ? error.message : "ATTOM request failed"),
        { packageName: packagePath, retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw new AttomError("ATTOM request failed after retries", { packageName: packagePath });
}

export function extractAttomProperties(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const root = data as Record<string, unknown>;
  if (Array.isArray(root.property)) {
    return root.property.filter(
      (item): item is Record<string, unknown> => !!item && typeof item === "object",
    );
  }
  const response = root.response as Record<string, unknown> | undefined;
  const result = response?.result as Record<string, unknown> | undefined;
  if (Array.isArray(result?.property)) {
    return result.property.filter(
      (item): item is Record<string, unknown> => !!item && typeof item === "object",
    );
  }
  return [];
}
