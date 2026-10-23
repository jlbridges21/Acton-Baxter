/**
 * Request helpers for /api/search/* and /api/admin/search. Every handler authorizes on the
 * server (approved Baxter session) before any provider runs.
 */

import "server-only";

import { z } from "zod";
import { requireActiveUser, requireAdmin } from "@/lib/auth/session";
import { RateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSearchContext, type SearchContext } from "./context";
import { runSearch } from "./engine";
import {
  CATEGORY_IDS,
  DEFAULT_SECTION_LIMIT,
  MAX_QUERY_LENGTH,
  type SearchCategoryId,
} from "./types";

/** Debounced typing stays far below this; it only stops runaway clients. */
export const SEARCH_RATE_LIMIT = { limit: 120, windowMs: 60_000 };

export async function requireSearchContext(): Promise<SearchContext> {
  return createSearchContext(await requireActiveUser());
}

export async function requireSearchAdminContext(): Promise<SearchContext> {
  return createSearchContext(await requireAdmin());
}

export function enforceSearchRateLimit(ctx: SearchContext, bucket = "search") {
  const rl = checkRateLimit(`${bucket}:${ctx.user.id}`, SEARCH_RATE_LIMIT);
  if (!rl.allowed) throw new RateLimitError("Too many searches in a minute. Try again shortly.");
}

export const searchParamsSchema = z.object({
  q: z
    .string()
    .max(MAX_QUERY_LENGTH, `Search is limited to ${MAX_QUERY_LENGTH} characters.`)
    .default(""),
  category: z
    .string()
    .optional()
    .transform((v) =>
      v && (CATEGORY_IDS as string[]).includes(v) ? (v as SearchCategoryId) : null,
    ),
  limit: z.coerce.number().int().min(1).max(50).default(DEFAULT_SECTION_LIMIT),
  offset: z.coerce.number().int().min(0).max(500).default(0),
});

/** NDJSON stream of search events; closes early if the client aborts (stale request). */
export function searchStream(
  ctx: SearchContext,
  params: z.infer<typeof searchParamsSchema>,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runSearch(
          ctx,
          {
            query: params.q,
            category: params.category,
            limit: params.limit,
            offset: params.offset,
          },
          signal,
        )) {
          if (signal.aborted) break;
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (error) {
        const message =
          error instanceof Error && error.name === "ValidationError"
            ? error.message
            : "Search failed. Try again.";
        if (!(error instanceof Error && error.name === "ValidationError")) {
          console.error("[search.stream.failed]", error instanceof Error ? error.message : error);
        }
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ type: "error", code: "SEARCH_FAILED", message })}\n`),
        );
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by an aborted client
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
