import "server-only";

import type { GhlVoiceAgent } from "../types";

/**
 * Voice AI resource module.
 *
 * Note: GHL Voice AI endpoints may be part of the Conversation AI or a separate API.
 * This module provides soft-fail behavior if the endpoints are unavailable.
 *
 * Prompt 2 may expand this module once API endpoints are confirmed.
 */

export async function listVoiceAgents(): Promise<GhlVoiceAgent[]> {
  console.warn("[GHL Voice AI] Voice AI API endpoint not yet confirmed. Returning empty.");
  return [];
}

export async function getVoiceAgentById(_agentId: string): Promise<GhlVoiceAgent | null> {
  console.warn("[GHL Voice AI] Voice AI API endpoint not yet confirmed. Returning null.");
  return null;
}

export async function getVoiceAgentStatus(): Promise<{
  available: boolean;
  message: string;
}> {
  return {
    available: false,
    message: "Voice AI API endpoint not yet confirmed for this integration.",
  };
}
