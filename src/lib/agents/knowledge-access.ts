/**
 * Authorization for Knowledge Hub documents.
 *   - manage:  any person who manages at least one agent the document is assigned to
 *   - read:    managers, or people who may use an assigned agent (via Baxter or directly)
 *              when the document's sensitivity is within their access
 */

import "server-only";

import {
  allowedSensitivities,
  getDocument,
  getDocumentAgentIds,
  type KnowledgeDocumentRow,
} from "./knowledge";
import { accessByAgent } from "./views";
import type { Requester } from "./types";

export async function documentAccess(
  requester: Requester,
  documentId: string,
): Promise<{
  doc: KnowledgeDocumentRow | null;
  agentIds: string[];
  canRead: boolean;
  canManage: boolean;
}> {
  const doc = await getDocument(documentId);
  if (!doc) return { doc: null, agentIds: [], canRead: false, canManage: false };
  const agentIds = await getDocumentAgentIds(documentId);
  const access = await accessByAgent(requester);
  let canManage = false;
  let canRead = false;
  for (const id of agentIds) {
    const levels = access.get(id);
    if (!levels) continue;
    if (levels.has("manage")) canManage = true;
    if (
      (levels.has("use_via_baxter") || levels.has("direct_chat") || levels.has("view_activity")) &&
      allowedSensitivities(levels).includes(doc.sensitivity)
    ) {
      canRead = true;
    }
  }
  return { doc, agentIds, canRead: canRead || canManage, canManage };
}
