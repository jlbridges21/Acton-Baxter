/**
 * Company-wide relationships: report-specific relationships that an administrator promoted
 * so every report (and Dexter) can use them. Same shape and validation as a report's own
 * relationships; joins are always on stable-id key fields.
 */

import "server-only";

import { agentDb, eq, selectOne } from "@/lib/agents/store";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import type { ReportsAccess } from "./access";
import { getFieldCatalog } from "./fields";
import { extendCatalogWithRelationships } from "./report-relationships";
import { relationshipSchema, type RelationshipSpec } from "./spec";

export type CompanyRelationshipRow = {
  id: string;
  key: string;
  definition: RelationshipSpec;
  promoted_from_report: string | null;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

let cache: { at: number; rows: CompanyRelationshipRow[] } | null = null;

export function invalidateCompanyRelationships() {
  cache = null;
}

/** Active company relationships (empty before migration 079). */
export async function listCompanyRelationships(): Promise<CompanyRelationshipRow[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.rows;
  const rows = await agentDb()
    .select<CompanyRelationshipRow>("bi_report_relationships", {
      order: { col: "key" },
      limit: 500,
    })
    .catch(() => [] as CompanyRelationshipRow[]);
  const active = rows.flatMap((r) => {
    if (r.archived_at) return [];
    const d = relationshipSchema.safeParse(r.definition);
    return d.success ? [{ ...r, definition: d.data }] : [];
  });
  cache = { at: Date.now(), rows: active };
  return active;
}

/** Promote (or update) a validated relationship to company-wide. Administrators only. */
export async function promoteRelationship(input: {
  definition: unknown;
  access: ReportsAccess;
  userId: string | null;
  reportId?: string | null;
}): Promise<CompanyRelationshipRow> {
  if (!(input.access.isAdmin || input.access.canManage))
    throw new AuthorizationError(
      "Only Reports administrators can make a relationship company-wide. It keeps working in this report.",
    );
  const parsed = relationshipSchema.safeParse(input.definition);
  if (!parsed.success)
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const def = parsed.data;
  const others = (await listCompanyRelationships()).filter((r) => r.key !== def.id);
  const check = extendCatalogWithRelationships(await getFieldCatalog(), [
    ...others.map((r) => ({ spec: r.definition, origin: "company" as const })),
    { spec: def, origin: "company" },
  ]);
  const problem = check.relationshipErrors.get(def.id);
  if (problem) throw new ValidationError(problem);
  const existing = await selectOne<CompanyRelationshipRow>("bi_report_relationships", {
    filters: [eq("key", def.id)],
  });
  const [row] = existing
    ? await agentDb().update<CompanyRelationshipRow>(
        "bi_report_relationships",
        [eq("id", existing.id)],
        { definition: def, archived_at: null, updated_at: new Date().toISOString() },
      )
    : await agentDb().insert<CompanyRelationshipRow>("bi_report_relationships", {
        key: def.id,
        definition: def,
        promoted_from_report: input.reportId ?? null,
        created_by: input.userId,
      });
  invalidateCompanyRelationships();
  return row!;
}

export async function archiveCompanyRelationship(key: string, access: ReportsAccess) {
  if (!(access.isAdmin || access.canManage))
    throw new AuthorizationError("Only Reports administrators can change company relationships.");
  await agentDb().update("bi_report_relationships", [eq("key", key)], {
    archived_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  invalidateCompanyRelationships();
}
