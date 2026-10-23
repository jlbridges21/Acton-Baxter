/**
 * Request helpers for /api/reports/* route handlers. Every handler authorizes on the
 * server: session → requester → Reports access (from Dexter's access policies).
 */

import "server-only";

import { z } from "zod";
import { requireAiContext, type AiContext } from "@/lib/agents/http";
import { AuthorizationError } from "@/lib/errors";
import { requireReportsAccess, type ReportsAccess } from "./access";

export type ReportsContext = AiContext & { access: ReportsAccess };

export async function requireReportsContext(): Promise<ReportsContext> {
  const ctx = await requireAiContext();
  const access = await requireReportsAccess(ctx.requester);
  return { ...ctx, access };
}

/** JobTread connection settings, sync, and field governance: admins only. */
export async function requireReportsAdmin(): Promise<ReportsContext> {
  const ctx = await requireReportsContext();
  if (!ctx.access.isAdmin)
    throw new AuthorizationError("Only administrators can manage JobTread data settings.");
  return ctx;
}

/** Filter selections sent by the browser. Values are plain data, never expressions. */
export const controlStateSchema = z
  .record(
    z.string().max(40),
    z.union([
      z.string().max(200),
      z.array(z.string().max(200)).max(200),
      z.tuple([z.number().nullable(), z.number().nullable()]),
      z.tuple([z.string().max(40).nullable(), z.string().max(40).nullable()]),
      z.null(),
    ]),
  )
  .default({});
