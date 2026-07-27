import "server-only";

import { getGhlRuntimeConfig, getGhlAuthMode } from "./config";
import { resolveGhlCredentialProvider } from "./auth";
import { GHL_API_BASE_URL } from "./types";
import type { GhlErrorCode } from "./errors";
import { classifyGhlApiError } from "./errors";

export type GhlCapabilityStatus =
  | "available"
  | "missing_scope"
  | "unsupported_for_pit"
  | "unsupported_for_auth_mode"
  | "deprecated_endpoint"
  | "integration_error"
  | "not_tested"
  | "error"
  | "disabled";

export type GhlCapabilityName =
  | "contacts.read"
  | "contacts.write"
  | "opportunities.read"
  | "opportunities.write"
  | "pipelines.read"
  | "calendars.read"
  | "calendarEvents.read"
  | "conversations.read"
  | "messages.read"
  | "users.read"
  | "customFields.read"
  | "customFields.write"
  | "tags.read"
  | "phoneNumbers.read"
  | "documents.read"
  | "voiceAi.dashboard.read"
  | "voiceAi.agents.read"
  | "knowledgeBases.read"
  | "location.read";

export type GhlCapabilityProbeResult = {
  capability: GhlCapabilityName;
  status: GhlCapabilityStatus;
  errorCode?: GhlErrorCode | null;
  message?: string;
  testedAt: string;
};

export type GhlCapabilityMatrix = {
  capabilities: GhlCapabilityProbeResult[];
  coreAvailable: boolean;
  coreCapabilities: GhlCapabilityName[];
  optionalAvailable: GhlCapabilityName[];
  optionalMissing: GhlCapabilityName[];
  overallStatus:
    "connected" | "connected_limited" | "needs_attention" | "offline" | "not_configured";
  testedAt: string;
  authMode: string;
  locationId: string | null;
};

export const CORE_CAPABILITIES: GhlCapabilityName[] = [
  "contacts.read",
  "pipelines.read",
  "opportunities.read",
];

export const OPTIONAL_READ_CAPABILITIES: GhlCapabilityName[] = [
  "calendars.read",
  "calendarEvents.read",
  "conversations.read",
  "messages.read",
  "users.read",
  "customFields.read",
  "tags.read",
  "phoneNumbers.read",
  "documents.read",
  "voiceAi.dashboard.read",
  "voiceAi.agents.read",
  "knowledgeBases.read",
  "location.read",
];

export const WRITE_CAPABILITIES: GhlCapabilityName[] = [
  "contacts.write",
  "opportunities.write",
  "customFields.write",
];

type ProbeConfig = {
  capability: GhlCapabilityName;
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  /** How to attach location — v3 uses locationId camelCase */
  locationMode: "query_locationId" | "body_locationId" | "path" | "none";
  optional?: boolean;
  apiVersion?: string;
};

const PROBE_CONFIGS: ProbeConfig[] = [
  {
    capability: "contacts.read",
    method: "POST",
    path: "/contacts/search",
    body: { pageLimit: 1 },
    locationMode: "body_locationId",
    apiVersion: "v3",
  },
  {
    capability: "opportunities.read",
    method: "GET",
    path: "/opportunities/search",
    query: { limit: "1" },
    locationMode: "query_locationId",
    apiVersion: "v3",
  },
  {
    capability: "pipelines.read",
    method: "GET",
    path: "/opportunities/pipelines",
    locationMode: "query_locationId",
    apiVersion: "v3",
  },
  {
    capability: "calendars.read",
    method: "GET",
    path: "/calendars/",
    locationMode: "query_locationId",
    optional: true,
    apiVersion: "v3",
  },
  {
    capability: "conversations.read",
    method: "GET",
    path: "/conversations/search",
    query: { limit: "1" },
    locationMode: "query_locationId",
    optional: true,
    apiVersion: "v3",
  },
  {
    capability: "users.read",
    method: "GET",
    path: "/users/",
    locationMode: "query_locationId",
    optional: true,
    apiVersion: "v3",
  },
  {
    capability: "customFields.read",
    method: "GET",
    path: "/locations/{locationId}/customFields",
    locationMode: "path",
    optional: true,
    apiVersion: "v3",
  },
  {
    capability: "tags.read",
    method: "GET",
    path: "/locations/{locationId}/tags",
    locationMode: "path",
    optional: true,
    apiVersion: "v3",
  },
  {
    capability: "phoneNumbers.read",
    method: "GET",
    path: "/phone-system/numbers/location/{locationId}",
    locationMode: "path",
    optional: true,
    apiVersion: "v3",
  },
  {
    capability: "location.read",
    method: "GET",
    path: "/locations/{locationId}",
    locationMode: "path",
    optional: true,
    apiVersion: "v3",
  },
];

async function probeCapability(
  config: ProbeConfig,
  token: string,
  locationId: string,
  apiBaseUrl: string,
): Promise<GhlCapabilityProbeResult> {
  const testedAt = new Date().toISOString();

  try {
    const path = config.path.replace("{locationId}", locationId);
    const url = new URL(path, apiBaseUrl);

    if (config.query) {
      for (const [key, value] of Object.entries(config.query)) {
        if (value !== undefined && value !== "") {
          url.searchParams.set(key, value);
        }
      }
    }

    if (config.locationMode === "query_locationId") {
      url.searchParams.set("locationId", locationId);
      url.searchParams.delete("location_id");
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Version: config.apiVersion ?? "v3",
      Accept: "application/json",
    };

    let body: string | undefined;
    if (config.body) {
      headers["Content-Type"] = "application/json";
      const bodyObj: Record<string, unknown> = { ...config.body };
      if (config.locationMode === "body_locationId") {
        bodyObj.locationId = locationId;
        delete bodyObj.location_id;
      }
      body = JSON.stringify(bodyObj);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url.toString(), {
      method: config.method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return {
        capability: config.capability,
        status: "available",
        testedAt,
      };
    }

    const text = await response.text().catch(() => "");
    const errorCode = classifyGhlApiError(response.status, text);

    if (
      errorCode === "BAXTER_GHL_SCOPE_MISSING" ||
      errorCode === "BAXTER_GHL_LOCATION_ACCESS_DENIED" ||
      errorCode === "BAXTER_GHL_PERMISSION_DENIED"
    ) {
      return {
        capability: config.capability,
        status: "missing_scope",
        errorCode,
        message: `Missing scope for ${config.capability}`,
        testedAt,
      };
    }

    if (errorCode === "BAXTER_GHL_CONTRACT_ERROR" || response.status === 422) {
      return {
        capability: config.capability,
        status: "integration_error",
        errorCode: "BAXTER_GHL_CONTRACT_ERROR",
        message: `Contract/validation error (${response.status}): ${text.slice(0, 120)}`,
        testedAt,
      };
    }

    return {
      capability: config.capability,
      status: "error",
      errorCode,
      message: `API error (${response.status}): ${text.slice(0, 100)}`,
      testedAt,
    };
  } catch (error) {
    return {
      capability: config.capability,
      status: "error",
      errorCode: "BAXTER_GHL_API_UNAVAILABLE",
      message: error instanceof Error ? error.message.slice(0, 100) : "Probe failed",
      testedAt,
    };
  }
}

/**
 * Probe all capabilities and return a capability matrix.
 * Core capabilities: contacts.read, pipelines.read, opportunities.read
 * Optional capabilities: calendars, conversations, users, customFields, tags, etc.
 */
export async function probeGhlCapabilities(): Promise<GhlCapabilityMatrix> {
  const config = getGhlRuntimeConfig();
  const testedAt = new Date().toISOString();
  const authMode = getGhlAuthMode();

  if (!config.enabled) {
    return {
      capabilities: [],
      coreAvailable: false,
      coreCapabilities: [],
      optionalAvailable: [],
      optionalMissing: [],
      overallStatus: "not_configured",
      testedAt,
      authMode,
      locationId: config.locationId,
    };
  }

  if (!config.locationId) {
    return {
      capabilities: [],
      coreAvailable: false,
      coreCapabilities: [],
      optionalAvailable: [],
      optionalMissing: [],
      overallStatus: "not_configured",
      testedAt,
      authMode,
      locationId: null,
    };
  }

  let token: string;
  try {
    const provider = await resolveGhlCredentialProvider();
    token = await provider.getAccessToken();
  } catch {
    return {
      capabilities: [],
      coreAvailable: false,
      coreCapabilities: [],
      optionalAvailable: [],
      optionalMissing: [],
      overallStatus: "offline",
      testedAt,
      authMode,
      locationId: config.locationId,
    };
  }

  const apiBaseUrl = config.apiBaseUrl || GHL_API_BASE_URL;

  // Probe all capabilities in parallel
  const probeResults = await Promise.all(
    PROBE_CONFIGS.map((pc) => probeCapability(pc, token, config.locationId!, apiBaseUrl)),
  );

  // Add write capabilities as not_tested (we don't probe writes)
  const writeResults: GhlCapabilityProbeResult[] = WRITE_CAPABILITIES.map((cap) => ({
    capability: cap,
    status: "not_tested" as const,
    testedAt,
  }));

  const allCapabilities = [...probeResults, ...writeResults];

  // Determine core availability
  const coreResults = probeResults.filter((r) => CORE_CAPABILITIES.includes(r.capability));
  const coreAvailable = coreResults.every((r) => r.status === "available");
  const coreCapabilities = coreResults
    .filter((r) => r.status === "available")
    .map((r) => r.capability);

  // Determine optional availability
  const optionalResults = probeResults.filter((r) =>
    OPTIONAL_READ_CAPABILITIES.includes(r.capability),
  );
  const optionalAvailable = optionalResults
    .filter((r) => r.status === "available")
    .map((r) => r.capability);
  const optionalMissing = optionalResults
    .filter((r) => r.status !== "available")
    .map((r) => r.capability);

  // Determine overall status
  let overallStatus: GhlCapabilityMatrix["overallStatus"];
  if (!coreAvailable) {
    const anyCoreError = coreResults.some(
      (r) => r.status === "error" && r.errorCode !== "BAXTER_GHL_SCOPE_MISSING",
    );
    overallStatus = anyCoreError ? "offline" : "needs_attention";
  } else if (optionalMissing.length > 0) {
    overallStatus = "connected_limited";
  } else {
    overallStatus = "connected";
  }

  return {
    capabilities: allCapabilities,
    coreAvailable,
    coreCapabilities,
    optionalAvailable,
    optionalMissing,
    overallStatus,
    testedAt,
    authMode,
    locationId: config.locationId,
  };
}

/**
 * Quick check if core CRM capabilities are available without full probe.
 * Uses cached provider health for speed.
 */
export async function hasCoreCrmCapabilities(): Promise<boolean> {
  try {
    const provider = await resolveGhlCredentialProvider();
    const health = await provider.health();
    return health.ok;
  } catch {
    return false;
  }
}

/**
 * Format capability status for display.
 */
export function formatCapabilityStatus(status: GhlCapabilityStatus): string {
  switch (status) {
    case "available":
      return "Available";
    case "missing_scope":
      return "Missing Scope";
    case "unsupported_for_auth_mode":
      return "Unsupported";
    case "not_tested":
      return "Not Tested";
    case "error":
      return "Error";
    case "disabled":
      return "Disabled";
    default:
      return "Unknown";
  }
}

/**
 * Get guidance message for missing capabilities.
 */
export function getCapabilityGuidance(capability: GhlCapabilityName): string {
  const scopeMap: Record<GhlCapabilityName, string> = {
    "contacts.read": "contacts.readonly",
    "contacts.write": "contacts.write",
    "opportunities.read": "opportunities.readonly",
    "opportunities.write": "opportunities.write",
    "pipelines.read": "pipelines.readonly",
    "calendars.read": "calendars.readonly",
    "calendarEvents.read": "calendars/events.readonly",
    "conversations.read": "conversations.readonly",
    "messages.read": "conversations/message.readonly",
    "users.read": "users.readonly",
    "customFields.read": "locations/customFields.readonly",
    "customFields.write": "locations/customFields.write",
    "tags.read": "locations/tags.readonly",
    "phoneNumbers.read": "phonenumbers.read",
    "documents.read": "documents_contracts/list.readonly",
    "voiceAi.dashboard.read": "voice-ai-dashboard.readonly",
    "voiceAi.agents.read": "voice-ai-agents.readonly",
    "knowledgeBases.read": "knowledge-bases.readonly",
    "location.read": "locations.readonly",
  };

  const scope = scopeMap[capability];
  return `Add the '${scope}' scope to your Private Integration in GHL → Settings → Integrations → Private Integrations.`;
}
