/**
 * Publish Baxter's App Home tab on `app_home_opened`.
 * Heavy modules (capability registry, Slack Search connections) are loaded here —
 * not from the events route top level — to keep cold-start imports light.
 */

import "server-only";

import { isSlackUserAllowed, getPublicAppBaseUrl } from "@/lib/slack/config";
import { publishSlackHomeView } from "@/lib/slack/client";
import {
  buildAppHomeView,
  isAppHomeOpenedEvent,
  type AppHomeOpenedLike,
  type HomeCapabilityGroup,
  type SlackSearchHomeStatus,
} from "@/lib/slack/app-home-view";
import { BAXTER_SLACK_SLASH_COMMANDS } from "@/lib/slack/slash-command-catalog";
import type { SlackSearchConnectionMetadata } from "@/lib/baxter-data/slack/connections";
import type { BaxterCapability } from "@/lib/baxter/capability-registry";

export type AppHomePublishDeps = {
  loadCatalog?: () => Promise<BaxterCapability[]>;
  loadConnection?: (input: {
    slackUserId: string;
    slackTeamId: string | null;
  }) => Promise<SlackSearchConnectionMetadata | null>;
  publishView?: typeof publishSlackHomeView;
  getBaseUrl?: () => string;
};

export type AppHomePublishResult = {
  published: boolean;
  skipped?: string;
  omitted: string[];
  slackSearch?: SlackSearchHomeStatus | null;
};

async function defaultLoadCatalog(): Promise<BaxterCapability[]> {
  const { getCapabilityRuntimeHealth, buildBaxterCapabilityCatalog } =
    await import("@/lib/baxter/capability-registry");
  const { isMonitoringCapabilityKnown } = await import("@/lib/baxter-ai/governance/capabilities");
  return buildBaxterCapabilityCatalog(
    getCapabilityRuntimeHealth({ monitoringKnown: isMonitoringCapabilityKnown() }),
  );
}

async function defaultLoadConnection(input: {
  slackUserId: string;
  slackTeamId: string | null;
}): Promise<SlackSearchConnectionMetadata | null> {
  const { getSlackSearchConnectionMetadataForRequester } =
    await import("@/lib/baxter-data/slack/connections");
  return getSlackSearchConnectionMetadataForRequester({
    baxterUserId: null,
    slackUserId: input.slackUserId,
    slackTeamId: input.slackTeamId,
  });
}

function connectionStatusFromMetadata(
  meta: SlackSearchConnectionMetadata | null,
): SlackSearchHomeStatus | null {
  if (!meta) return null;
  return meta.linked && meta.status === "connected" ? "connected" : "disconnected";
}

/**
 * Build and publish the Home view for one Slack user.
 * Failures in capability or connection lookup omit those sections; publish still proceeds.
 */
export async function handleAppHomeOpened(
  event: AppHomeOpenedLike,
  teamId: string | null,
  deps: AppHomePublishDeps = {},
): Promise<AppHomePublishResult> {
  if (!isAppHomeOpenedEvent(event)) {
    return { published: false, skipped: "not_home_tab", omitted: [] };
  }

  const slackUserId = event.user!;
  if (!isSlackUserAllowed(slackUserId)) {
    console.error("[slack.app_home.ignored]", {
      reason: "user_not_allowed",
      slackUserId,
      teamId,
    });
    return { published: false, skipped: "user_not_allowed", omitted: [] };
  }

  const omitted: string[] = [];
  let capabilityGroups: HomeCapabilityGroup[] | null = [];
  try {
    const catalog = await (deps.loadCatalog ?? defaultLoadCatalog)();
    const { groupHomeCapabilities } = await import("@/lib/slack/app-home-capabilities");
    capabilityGroups = groupHomeCapabilities(catalog);
    if (capabilityGroups.length === 0) {
      omitted.push("capabilities");
      capabilityGroups = null;
    }
  } catch (error) {
    omitted.push("capabilities");
    capabilityGroups = null;
    console.error("[slack.app_home.capabilities_failed]", {
      slackUserId,
      teamId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }

  let slackSearch: SlackSearchHomeStatus | null = null;
  try {
    const loadConnection = deps.loadConnection ?? defaultLoadConnection;
    const meta = await loadConnection({ slackUserId, slackTeamId: teamId });
    slackSearch = connectionStatusFromMetadata(meta);
    if (!slackSearch) {
      omitted.push("slack_search");
    }
  } catch (error) {
    omitted.push("slack_search");
    slackSearch = null;
    console.error("[slack.app_home.connection_failed]", {
      slackUserId,
      teamId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }

  const base = (deps.getBaseUrl ?? getPublicAppBaseUrl)().replace(/\/$/, "");
  const view = buildAppHomeView({
    webAppUrl: `${base}/`,
    integrationsUrl: `${base}/settings/integrations`,
    capabilityGroups,
    slackSearch,
    slashCommands: BAXTER_SLACK_SLASH_COMMANDS,
  });

  const publish = deps.publishView ?? publishSlackHomeView;
  const result = await publish({ userId: slackUserId, view });
  if (!result.ok) {
    console.error("[slack.app_home.publish_failed]", {
      slackUserId,
      teamId,
      error: result.error ?? null,
    });
    return { published: false, skipped: "publish_failed", omitted, slackSearch };
  }

  return { published: true, omitted, slackSearch };
}
