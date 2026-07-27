import "server-only";

/**
 * Rulebook admin audit logging.
 */

import { createServiceClient } from "@/lib/supabase/admin";

export type RulebookAuditParams = {
  actorUserId: string;
  action: string;
  versionId?: string;
  resourceType?: string;
  resourceId?: string;
  summary?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

/**
 * Record a rulebook admin audit entry.
 */
export async function recordRulebookAudit(params: RulebookAuditParams): Promise<void> {
  const supabase = createServiceClient();

  try {
    await supabase.from("rulebook_admin_audit").insert({
      actor_user_id: params.actorUserId,
      action: params.action,
      version_id: params.versionId || null,
      resource_type: params.resourceType || null,
      resource_id: params.resourceId || null,
      summary: params.summary || null,
      before_json: params.before || {},
      after_json: params.after || {},
    });
  } catch (error) {
    console.error("[Rulebook Audit] Failed to record audit entry:", error);
  }
}
