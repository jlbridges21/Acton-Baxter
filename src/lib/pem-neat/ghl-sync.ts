/**
 * Push a PEM NEAT's BuilderTrend handoff fields to GoHighLevel via the inbound-webhook
 * workflow. The GHL workflow owns the contact lookup and the field writes; Baxter only
 * posts the payload built in `ghl-sync-payload.ts`.
 *
 * Config:
 * - PEM_NEAT_GHL_WEBHOOK_URL overrides the default workflow URL.
 * - PEM_NEAT_GHL_SYNC=false turns the push off (E2E sets this so tests never hit GHL).
 */

import "server-only";

import { AppError } from "@/lib/errors";
import type { PemNeatGhlPayload } from "./ghl-sync-payload";

const DEFAULT_WEBHOOK_URL =
  "https://services.leadconnectorhq.com/hooks/qNX7FpOJSulgRgBJC5cE/webhook-trigger/dac38be1-bd1e-4c55-af78-b0cbcd9eb3b8";

const TIMEOUT_MS = 15_000;

export function getPemNeatGhlWebhookUrl(): string | null {
  if (process.env.PEM_NEAT_GHL_SYNC === "false") return null;
  const url = process.env.PEM_NEAT_GHL_WEBHOOK_URL?.trim() || DEFAULT_WEBHOOK_URL;
  return url.startsWith("https://") ? url : null;
}

export function isPemNeatGhlSyncEnabled(): boolean {
  return getPemNeatGhlWebhookUrl() !== null;
}

export async function postPemNeatToGhlWebhook(
  payload: PemNeatGhlPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number }> {
  const url = getPemNeatGhlWebhookUrl();
  if (!url) {
    throw new AppError("Sync to GoHighLevel is turned off in this environment.", {
      code: "GHL_SYNC_DISABLED",
      statusCode: 503,
    });
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    console.error("[pem-neat] GHL webhook request failed", {
      pemNeatId: payload.pem_neat_id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError("Could not reach GoHighLevel. Try again in a moment.", {
      code: "GHL_SYNC_UNREACHABLE",
      statusCode: 502,
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[pem-neat] GHL webhook rejected payload", {
      pemNeatId: payload.pem_neat_id,
      status: response.status,
      body: body.slice(0, 500),
    });
    throw new AppError(`GoHighLevel rejected the sync (HTTP ${response.status}).`, {
      code: "GHL_SYNC_REJECTED",
      statusCode: 502,
    });
  }

  return { status: response.status };
}
