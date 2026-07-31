/**
 * Heavy /new-project work — dynamically imported AFTER Slack view_submission ack.
 * Safe to pull GHL, Google, Supabase, and job queue here.
 */

import "server-only";

import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { resolveBaxterUserForSlackIdentity } from "@/lib/slack/identity";
import { openSlackModal, openSlackDm, updateSlackModal } from "@/lib/slack/provisioning";
import { postSlackMessage } from "@/lib/slack/client";
import { getPublicAppBaseUrl, isSlackUserAllowed } from "@/lib/slack/config";
import type { SlackCommandPayload } from "@/lib/slack/commands";
import {
  buildProjectSetupPreview,
  loadProjectSetupContactSnapshot,
  searchProjectSetupContacts,
} from "./service";
import { createProjectSetupRun } from "./store";
import { enqueueProjectSetupRun } from "./enqueue";
import { googleWritesEnabled, slackProvisioningEnabled } from "./capabilities";
import {
  buildConfirmModal,
  buildPickModal,
  buildSearchModal,
  type NewProjectModalMeta,
} from "./new-project-views";

async function resolveInitiatorUserId(slackUserId: string, slackTeamId: string): Promise<string> {
  const matched = await resolveBaxterUserForSlackIdentity({
    slackUserId,
    slackTeamId,
  });
  if (matched?.userId) return matched.userId;

  const env = getEnv();
  if (env.SLACK_REPORT_USER_ID) return env.SLACK_REPORT_USER_ID;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data?.id) {
    throw new Error("Unable to map your Slack user to a Baxter profile. Ask an admin to help.");
  }
  return data.id;
}

async function dmUser(slackUserId: string, text: string): Promise<void> {
  const dm = await openSlackDm(slackUserId);
  await postSlackMessage({ channel: dm.channelId, text });
}

/** Open the initial search modal from the slash command (not on the interactions hot path). */
export async function openNewProjectModal(payload: SlackCommandPayload): Promise<void> {
  if (!payload.trigger_id) {
    throw new Error("Missing Slack trigger_id — cannot open modal.");
  }
  if (!payload.user_id || !payload.team_id) {
    throw new Error("Missing Slack user or team.");
  }
  if (!isSlackUserAllowed(payload.user_id)) {
    throw new Error("You are not authorized to run /new-project.");
  }

  const meta: NewProjectModalMeta = {
    slackUserId: payload.user_id,
    slackTeamId: payload.team_id,
  };
  const prefill = (payload.text ?? "").trim();
  await openSlackModal({
    triggerId: payload.trigger_id,
    view: buildSearchModal({ prefill, meta }),
  });
}

export async function runNewProjectSearchAsync(input: {
  viewId: string | undefined;
  slackUserId: string;
  query: string;
  nextMeta: NewProjectModalMeta;
}): Promise<void> {
  const { viewId, slackUserId, query, nextMeta } = input;
  console.info("[new-project] search.async.start", {
    viewId: viewId ?? null,
    slackUserId,
  });
  if (!viewId) {
    console.warn("[new-project] search.async.skip_no_view_id", { slackUserId });
    return;
  }
  try {
    const hits = await searchProjectSetupContacts(query);
    if (hits.length === 0) {
      await updateSlackModal({
        viewId,
        view: buildSearchModal({
          prefill: query,
          meta: nextMeta,
          errorText: `No GoHighLevel contacts matched “${query}”. Try another name.`,
        }),
      });
      console.info("[new-project] search.async.done", {
        viewId,
        slackUserId,
        hitCount: 0,
      });
      return;
    }
    await updateSlackModal({
      viewId,
      view: buildPickModal({ meta: nextMeta, hits }),
    });
    console.info("[new-project] search.async.done", {
      viewId,
      slackUserId,
      hitCount: hits.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    console.error("[new-project] search.async.error", {
      viewId,
      slackUserId,
      message,
    });
    try {
      await updateSlackModal({
        viewId,
        view: buildSearchModal({
          prefill: query,
          meta: nextMeta,
          errorText: message,
        }),
      });
    } catch (updateError) {
      console.error("[new-project] search.async.update_failed", updateError);
    }
  }
}

export async function runNewProjectPickAsync(input: {
  viewId: string | undefined;
  slackUserId: string;
  contactId: string;
  meta: NewProjectModalMeta;
  nextMeta: NewProjectModalMeta;
}): Promise<void> {
  const { viewId, slackUserId, contactId, meta, nextMeta } = input;
  console.info("[new-project] pick.async.start", {
    viewId: viewId ?? null,
    slackUserId,
  });
  if (!viewId) {
    console.warn("[new-project] pick.async.skip_no_view_id", { slackUserId });
    return;
  }
  try {
    const contact = await loadProjectSetupContactSnapshot(contactId);
    const preview = await buildProjectSetupPreview({ contact });
    await updateSlackModal({
      viewId,
      view: buildConfirmModal({
        meta: nextMeta,
        contactName: contact.name ?? "Customer",
        email: contact.email,
        phone: contact.phone,
        address: contact.address,
        salesRep: preview.salesRep,
        projectNumber: preview.projectNumber!,
        folderName: preview.folderName,
        charterName: preview.charterName,
        slackChannelName: preview.slackChannelName,
        inviteLabel: preview.inviteLabel,
        fpPaidDate: preview.fpPaidDate,
      }),
    });
    console.info("[new-project] pick.async.done", { viewId, slackUserId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load contact";
    console.error("[new-project] pick.async.error", {
      viewId,
      slackUserId,
      message,
    });
    try {
      await updateSlackModal({
        viewId,
        view: buildSearchModal({
          prefill: meta.query,
          meta,
          errorText: message,
        }),
      });
    } catch (updateError) {
      console.error("[new-project] pick.async.update_failed", updateError);
    }
  }
}

export async function runNewProjectConfirmAsync(input: {
  slackUserId: string;
  slackTeamId: string;
  contactId: string;
}): Promise<void> {
  const { slackUserId, slackTeamId, contactId } = input;
  console.info("[new-project] confirm.async.start", { slackUserId });
  try {
    const writesEnabled = await googleWritesEnabled();
    if (!writesEnabled) {
      await dmUser(
        slackUserId,
        "Google write scopes are not connected yet. Reconnect Google at /admin/connectors/google, then try again.",
      );
      console.info("[new-project] confirm.async.done", {
        slackUserId,
        outcome: "writes_disabled",
      });
      return;
    }
    if (!slackProvisioningEnabled()) {
      await dmUser(
        slackUserId,
        "Slack provisioning is not configured (ENABLE_SLACK_INTEGRATION / bot token). Ask an admin to check Slack setup.",
      );
      console.info("[new-project] confirm.async.done", {
        slackUserId,
        outcome: "slack_disabled",
      });
      return;
    }

    const contact = await loadProjectSetupContactSnapshot(contactId);
    const preview = await buildProjectSetupPreview({ contact });
    const initiatedBy = await resolveInitiatorUserId(slackUserId, slackTeamId);

    const { run } = await createProjectSetupRun({
      initiatedBy,
      triggerChannel: "slack",
      slackInitiatorId: slackUserId,
      dryRun: false,
      ghlContactId: contact.id,
      contactSnapshot: contact,
      salesRep: preview.salesRep || "Unknown",
      projectNumber: preview.projectNumber!,
      projectLastName: preview.projectLastName,
      folderName: preview.folderName,
      charterName: preview.charterName,
      slackChannelName: preview.slackChannelName,
      fpPaidDate: preview.fpPaidDate,
    });

    await enqueueProjectSetupRun(run.id);

    const runUrl = `${getPublicAppBaseUrl()}/projects/setup/${run.id}`;
    await dmUser(
      slackUserId,
      `Started live project setup for *${contact.name ?? preview.projectLastName}* (${preview.projectNumber}).\nTrack progress: ${runUrl}`,
    );
    console.info("[new-project] confirm.async.done", {
      slackUserId,
      runId: run.id,
      outcome: "enqueued",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start project setup";
    console.error("[new-project] confirm.async.error", { slackUserId, message });
    await dmUser(slackUserId, `Could not start project setup: ${message}`).catch(() => undefined);
  }
}
