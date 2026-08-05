import { getEnv } from "@/lib/env";
import { getLayerMetadata } from "@/lib/arcgis/query";
import { SAN_JOSE_CONFIG } from "@/lib/connectors/california/san-jose/config";
import { SANTA_CLARA_COUNTY_CONFIG } from "@/lib/connectors/california/santa-clara-county/config";
import { resolvePropertyProfileAccess } from "@/lib/connectors/california/santa-clara-county/property-profile";
import type { ConnectorHealthCheckRow } from "./db-types";
import type { SourceStatus } from "./types";

export type SourceHealthView = {
  sourceName: string;
  provider: string;
  status: SourceStatus;
  lastChecked: string;
  responseTimeMs: number | null;
  schemaValid: boolean | null;
  message: string | null;
  endpointUrl: string | null;
};

type HealthCache = {
  checkedAt: number;
  rows: SourceHealthView[];
};

const globalHealth = globalThis as typeof globalThis & {
  __actonSourceHealthCache?: HealthCache;
};

export function mapHealthChecks(rows: ConnectorHealthCheckRow[]): SourceHealthView[] {
  return rows.map((row) => ({
    sourceName: row.source_name,
    provider: row.connector_key,
    status: row.status,
    lastChecked: row.checked_at,
    responseTimeMs: row.response_time_ms,
    schemaValid: row.expected_schema_valid,
    message: row.message,
    endpointUrl: row.endpoint_url,
  }));
}

export function getConfiguredProviderHealth(): SourceHealthView[] {
  const env = getEnv();
  const now = new Date().toISOString();
  return [
    {
      sourceName: "ATTOM Property API",
      provider: "attom",
      status: env.ATTOM_API_KEY ? "manual_review" : "unavailable",
      lastChecked: now,
      responseTimeMs: null,
      schemaValid: Boolean(env.ATTOM_API_KEY),
      message: env.ATTOM_API_KEY
        ? "API key configured (optional; sunset after trial). Admin report diagnostics compare ATTOM vs RentCast when both run."
        : "ATTOM_API_KEY unset — RentCast-only mode (expected after cutover).",
      endpointUrl: env.ATTOM_BASE_URL,
    },
    {
      sourceName: "RentCast Property API",
      provider: "rentcast",
      status: env.RENTCAST_API_KEY ? "manual_review" : "unavailable",
      lastChecked: now,
      responseTimeMs: null,
      schemaValid: Boolean(env.RENTCAST_API_KEY),
      message: env.RENTCAST_API_KEY
        ? "API key configured. Use /admin/provider-test for a manual live call (may use credits)."
        : "RENTCAST_API_KEY is missing.",
      endpointUrl: env.RENTCAST_BASE_URL,
    },
  ];
}

export async function checkPublicGisHealth(force = false): Promise<SourceHealthView[]> {
  const cache = globalHealth.__actonSourceHealthCache;
  const oneHour = 60 * 60 * 1000;
  if (!force && cache && Date.now() - cache.checkedAt < oneHour) {
    return cache.rows;
  }

  const now = new Date().toISOString();
  const checks: SourceHealthView[] = [];

  for (const layer of [
    {
      name: "San Jose ArcGIS Parcels",
      provider: "ca-san-jose",
      url: SAN_JOSE_CONFIG.layers.parcels.url,
    },
    {
      name: "San Jose ArcGIS Zoning",
      provider: "ca-san-jose",
      url: SAN_JOSE_CONFIG.layers.zoning.url,
    },
    {
      name: "Santa Clara County Parcels",
      provider: "ca-santa-clara-county",
      url: SANTA_CLARA_COUNTY_CONFIG.parcels.url,
    },
  ]) {
    try {
      const result = await getLayerMetadata(layer.url);
      checks.push({
        sourceName: layer.name,
        provider: layer.provider,
        status: "active",
        lastChecked: now,
        responseTimeMs: result.responseTimeMs,
        schemaValid: Boolean(result.data.name || result.data.fields),
        message: "Service metadata reachable.",
        endpointUrl: layer.url,
      });
    } catch (error) {
      checks.push({
        sourceName: layer.name,
        provider: layer.provider,
        status: "error",
        lastChecked: now,
        responseTimeMs: null,
        schemaValid: false,
        message: error instanceof Error ? error.message : "Metadata check failed",
        endpointUrl: layer.url,
      });
    }
  }

  const profile = resolvePropertyProfileAccess({
    address: "655 13th St, San Jose, CA",
    apn: "47222019",
  });
  checks.push({
    sourceName: "Santa Clara County Property Profile",
    provider: "ca-santa-clara-county",
    status: profile.available ? "manual_review" : "unavailable",
    lastChecked: now,
    responseTimeMs: null,
    schemaValid: true,
    message: `${profile.accessType}: ${profile.statusMessage}`,
    endpointUrl: profile.url,
  });

  globalHealth.__actonSourceHealthCache = { checkedAt: Date.now(), rows: checks };
  return checks;
}

export async function getLiveSourceHealth(): Promise<SourceHealthView[]> {
  const configured = getConfiguredProviderHealth();
  const gis = await checkPublicGisHealth(false);
  return [...configured, ...gis];
}

export function getMockSourceHealth(): SourceHealthView[] {
  const now = new Date().toISOString();
  return [
    ...getConfiguredProviderHealth(),
    {
      sourceName: "San Jose ArcGIS Parcel Layer",
      provider: "ca-san-jose",
      status: "stale",
      lastChecked: now,
      responseTimeMs: 420,
      schemaValid: true,
      message: "Mock health sample when live checks are not run.",
      endpointUrl: SAN_JOSE_CONFIG.layers.parcels.url,
    },
    {
      sourceName: "Santa Clara County Property Profile",
      provider: "ca-santa-clara-county",
      status: "manual_review",
      lastChecked: now,
      responseTimeMs: null,
      schemaValid: true,
      message:
        "Generic search / Experience link. Direct printable report URL not stably available.",
      endpointUrl: SANTA_CLARA_COUNTY_CONFIG.propertyProfile.experienceUrl,
    },
  ];
}
