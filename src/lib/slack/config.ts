import "server-only";

import { getEnv } from "@/lib/env";

export type SlackHealthStatus = "disabled" | "misconfigured" | "ready" | "warning" | "offline";

export type SlackRuntimeConfig = {
  enabled: boolean;
  signingSecretPresent: boolean;
  botTokenPresent: boolean;
  appTokenPresent: boolean;
  allowedTeamIds: string[];
  allowedChannelIds: string[];
  allowedUserIds: string[];
  enableDms: boolean;
  enableChannelMentions: boolean;
  reportUserId: string | null;
  eventsEndpointUrl: string;
  propertyCommandEndpointUrl: string;
  missingRequired: string[];
  readyForEvents: boolean;
};

function parseIdList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function parseBool(raw: string | boolean | undefined, defaultValue: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === undefined || raw === "") return defaultValue;
  const value = String(raw).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;
  return defaultValue;
}

export function getPublicAppBaseUrl(): string {
  try {
    const env = getEnv();
    const fromNext = process.env.NEXT_PUBLIC_APP_URL?.trim();
    const base = (fromNext || env.APP_BASE_URL || "").replace(/\/$/, "");
    return base || "http://localhost:3000";
  } catch {
    return (
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_BASE_URL ||
      "http://localhost:3000"
    ).replace(/\/$/, "");
  }
}

export function getSlackRuntimeConfig(): SlackRuntimeConfig {
  let enabled = false;
  let signingSecret = "";
  let botToken = "";
  let appToken = "";
  let allowedTeamIdsRaw = "";
  let allowedChannelIdsRaw = "";
  let allowedUserIdsRaw = "";
  let enableDmsRaw: string | boolean = true;
  let enableMentionsRaw: string | boolean = true;
  let reportUserId = "";

  try {
    const env = getEnv();
    enabled = env.ENABLE_SLACK_INTEGRATION;
    signingSecret = env.SLACK_SIGNING_SECRET;
    botToken = env.SLACK_BOT_TOKEN;
    appToken = env.SLACK_APP_TOKEN;
    allowedTeamIdsRaw = env.SLACK_ALLOWED_TEAM_IDS;
    allowedChannelIdsRaw = env.SLACK_ALLOWED_CHANNEL_IDS;
    allowedUserIdsRaw = env.SLACK_ALLOWED_USER_IDS;
    enableDmsRaw = env.SLACK_ENABLE_DMS;
    enableMentionsRaw = env.SLACK_ENABLE_CHANNEL_MENTIONS;
    reportUserId = env.SLACK_REPORT_USER_ID;
  } catch {
    enabled = parseBool(process.env.ENABLE_SLACK_INTEGRATION, false);
    signingSecret = process.env.SLACK_SIGNING_SECRET ?? "";
    botToken = process.env.SLACK_BOT_TOKEN ?? "";
    appToken = process.env.SLACK_APP_TOKEN ?? "";
    allowedTeamIdsRaw = process.env.SLACK_ALLOWED_TEAM_IDS ?? "";
    allowedChannelIdsRaw = process.env.SLACK_ALLOWED_CHANNEL_IDS ?? "";
    allowedUserIdsRaw = process.env.SLACK_ALLOWED_USER_IDS ?? "";
    enableDmsRaw = process.env.SLACK_ENABLE_DMS ?? "true";
    enableMentionsRaw = process.env.SLACK_ENABLE_CHANNEL_MENTIONS ?? "true";
    reportUserId = process.env.SLACK_REPORT_USER_ID ?? "";
  }

  const allowedTeamIds = parseIdList(allowedTeamIdsRaw);
  const allowedChannelIds = parseIdList(allowedChannelIdsRaw);
  const allowedUserIds = parseIdList(allowedUserIdsRaw);
  const base = getPublicAppBaseUrl();

  const missingRequired: string[] = [];
  if (enabled) {
    if (!signingSecret) missingRequired.push("SLACK_SIGNING_SECRET");
    if (!botToken) missingRequired.push("SLACK_BOT_TOKEN");
    if (allowedTeamIds.length === 0) missingRequired.push("SLACK_ALLOWED_TEAM_IDS");
  }

  return {
    enabled,
    signingSecretPresent: Boolean(signingSecret),
    botTokenPresent: Boolean(botToken),
    appTokenPresent: Boolean(appToken),
    allowedTeamIds,
    allowedChannelIds,
    allowedUserIds,
    enableDms: parseBool(enableDmsRaw, true),
    enableChannelMentions: parseBool(enableMentionsRaw, true),
    reportUserId: reportUserId || null,
    eventsEndpointUrl: `${base}/api/slack/events`,
    propertyCommandEndpointUrl: `${base}/api/slack/commands/property`,
    missingRequired,
    readyForEvents: enabled && missingRequired.length === 0,
  };
}

export function isSlackTeamAllowed(teamId: string | null | undefined): boolean {
  const config = getSlackRuntimeConfig();
  if (!teamId) return false;
  if (config.allowedTeamIds.length === 0) return false;
  return config.allowedTeamIds.includes(teamId);
}

/**
 * Channel allowlist for app_mention / channel replies.
 * - Missing, undefined, empty, or whitespace-only SLACK_ALLOWED_CHANNEL_IDS → all channels allowed
 * - One or more comma-separated IDs → only those channels allowed
 * Channel mentions can still be fully disabled via SLACK_ENABLE_CHANNEL_MENTIONS=false.
 */
export function isSlackChannelAllowed(channelId: string | null | undefined): boolean {
  const config = getSlackRuntimeConfig();
  if (!channelId) return false;
  if (config.allowedChannelIds.length === 0) return true;
  return config.allowedChannelIds.includes(channelId);
}

export function isSlackUserAllowed(userId: string | null | undefined): boolean {
  const config = getSlackRuntimeConfig();
  if (!userId) return false;
  if (config.allowedUserIds.length === 0) return true;
  return config.allowedUserIds.includes(userId);
}

export type SlackHealthSnapshot = {
  status: SlackHealthStatus;
  label: string;
  details: string;
  config: SlackRuntimeConfig;
  authOk: boolean | null;
  authError: string | null;
};

export async function evaluateSlackHealth(options?: {
  authTest?: () => Promise<{ ok: boolean; error?: string }>;
  recentErrors?: boolean;
}): Promise<SlackHealthSnapshot> {
  const config = getSlackRuntimeConfig();

  if (!config.enabled) {
    return {
      status: "disabled",
      label: "Disabled",
      details: "ENABLE_SLACK_INTEGRATION is false. Web Baxter continues to work.",
      config,
      authOk: null,
      authError: null,
    };
  }

  if (!config.readyForEvents) {
    return {
      status: "misconfigured",
      label: "Misconfigured",
      details: `Missing required settings: ${config.missingRequired.join(", ")}`,
      config,
      authOk: null,
      authError: null,
    };
  }

  let authOk: boolean | null = null;
  let authError: string | null = null;
  if (options?.authTest) {
    try {
      const result = await options.authTest();
      authOk = result.ok;
      authError = result.error ?? null;
    } catch (error) {
      authOk = false;
      authError = error instanceof Error ? error.message : "auth_test_failed";
    }
  }

  if (authOk === false) {
    return {
      status: "offline",
      label: "Offline",
      details: authError ?? "Slack authentication failed.",
      config,
      authOk,
      authError,
    };
  }

  if (options?.recentErrors) {
    return {
      status: "warning",
      label: "Warning",
      details: "Configured, but recent Slack event or posting errors were recorded.",
      config,
      authOk,
      authError,
    };
  }

  if (authOk === true) {
    return {
      status: "ready",
      label: "Ready",
      details: "Credentials present and Slack auth.test succeeded.",
      config,
      authOk,
      authError,
    };
  }

  return {
    status: "ready",
    label: "Ready",
    details:
      "Credentials and team allowlist present. Run Test Slack authentication to confirm live auth.",
    config,
    authOk,
    authError,
  };
}
