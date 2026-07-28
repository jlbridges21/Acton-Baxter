import "server-only";

import { getEnv } from "@/lib/env";
import { getOpenAiModelCapabilities, parseReasoningEffort } from "@/lib/openai/capabilities";
import { resolvePemNeatFallbackModel, resolvePemNeatModelName } from "@/lib/pem-neat/openai-client";
import { createServiceClient } from "@/lib/supabase/admin";

export type PemNeatHealthSnapshot = {
  databaseReady: boolean;
  aiProviderReady: boolean;
  provider: string;
  configuredModel: string;
  api: "responses" | "chat_completions";
  reasoningEffort: string | null;
  fallbackModel: string | null;
  status: "Ready" | "Error" | "Not configured";
  lastGenerationStatus: string | null;
  lastErrorCode: string | null;
  activeCount: number | null;
};

/** Compact PEM NEAT health for Baxter diagnostics (no transcript content). */
export async function getPemNeatHealthSnapshot(): Promise<PemNeatHealthSnapshot> {
  const env = getEnv();
  const keyPresent = Boolean((env.OPENAI_API_KEY ?? "").trim());
  const aiProviderReady = keyPresent || Boolean(env.ENABLE_MOCK_RESEARCH);
  const configuredModel = resolvePemNeatModelName();
  const caps = getOpenAiModelCapabilities(configuredModel);
  const reasoningEffort = caps.supportsReasoningEffort
    ? parseReasoningEffort(process.env.PEM_NEAT_REASONING_EFFORT, "medium")
    : null;
  const fallbackModel = resolvePemNeatFallbackModel();

  const status: PemNeatHealthSnapshot["status"] = !aiProviderReady ? "Not configured" : "Ready";

  try {
    const supabase = createServiceClient();
    const { count, error: countError } = await supabase
      .from("pem_neats")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null);
    if (countError) {
      return {
        databaseReady: false,
        aiProviderReady,
        provider: "OpenAI",
        configuredModel,
        api: caps.api,
        reasoningEffort,
        fallbackModel,
        status: keyPresent ? "Error" : status,
        lastGenerationStatus: null,
        lastErrorCode: null,
        activeCount: null,
      };
    }

    const { data: latest } = await supabase
      .from("pem_neats")
      .select("status, last_error_code, updated_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      databaseReady: true,
      aiProviderReady,
      provider: "OpenAI",
      configuredModel,
      api: caps.api,
      reasoningEffort,
      fallbackModel,
      status,
      lastGenerationStatus: latest?.status ? String(latest.status) : null,
      lastErrorCode: latest?.last_error_code ? String(latest.last_error_code) : null,
      activeCount: count ?? 0,
    };
  } catch {
    // Memory/E2E or missing migration — treat DB as not ready in live mode only.
    const useMemory =
      env.E2E_TEST_AUTH_BYPASS ||
      env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-");
    return {
      databaseReady: useMemory,
      aiProviderReady,
      provider: "OpenAI",
      configuredModel,
      api: caps.api,
      reasoningEffort,
      fallbackModel,
      status,
      lastGenerationStatus: useMemory ? "memory" : null,
      lastErrorCode: null,
      activeCount: useMemory ? 0 : null,
    };
  }
}
