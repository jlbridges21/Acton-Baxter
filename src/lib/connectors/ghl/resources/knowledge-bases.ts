import "server-only";

import type { GhlKnowledgeBaseAsset } from "../types";

/**
 * Knowledge Bases resource module.
 *
 * Note: GHL Knowledge Base endpoints may be part of the Conversation AI API.
 * This module provides soft-fail behavior if the endpoints are unavailable.
 *
 * Prompt 2 may expand this module once API endpoints are confirmed.
 */

export async function listKnowledgeBaseAssets(): Promise<GhlKnowledgeBaseAsset[]> {
  console.warn(
    "[GHL Knowledge Bases] Knowledge Bases API endpoint not yet confirmed. Returning empty.",
  );
  return [];
}

export async function getKnowledgeBaseAssetById(
  _assetId: string,
): Promise<GhlKnowledgeBaseAsset | null> {
  console.warn(
    "[GHL Knowledge Bases] Knowledge Bases API endpoint not yet confirmed. Returning null.",
  );
  return null;
}

export async function getKnowledgeBaseStatus(): Promise<{
  available: boolean;
  message: string;
}> {
  return {
    available: false,
    message: "Knowledge Bases API endpoint not yet confirmed for this integration.",
  };
}
