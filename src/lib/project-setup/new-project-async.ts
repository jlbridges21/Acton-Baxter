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

/**
 * Bound GoHighLevel search independently of the connector's per-request timeout/retries.
 * Leaves headroom under the overall search deadline for a Slack views.update.
 */
export const NEW_PROJECT_GHL_SEARCH_TIMEOUT_MS = 8_000;

/**
 * Hard wall-clock for GHL + success views.update. Must stay well under interactions
 * maxDuration (60s) so a timeout still has time to push an error/retry modal.
 */
export const NEW_PROJECT_SEARCH_OVERALL_DEADLINE_MS = 12_000;

/** Slack views.update should not hang the safety-net path. */
export const NEW_PROJECT_SLACK_UPDATE_TIMEOUT_MS = 5_000;

class NewProjectDeadlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewProjectDeadlineError";
  }
}

function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NewProjectDeadlineError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function friendlySearchErrorText(error: unknown): string {
  if (
    error instanceof NewProjectDeadlineError ||
    (error instanceof Error && /timed out|deadline/i.test(error.message))
  ) {
    return "Search timed out. Enter the name again and tap Search to retry.";
  }
  const message = error instanceof Error ? error.message : "Search failed";
  return `${message} Enter the name again and tap Search to retry.`;
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
  /** Test overrides — production uses module defaults. */
  ghlTimeoutMs?: number;
  overallDeadlineMs?: number;
  slackUpdateTimeoutMs?: number;
  searchContacts?: typeof searchProjectSetupContacts;
}): Promise<void> {
  const {
    viewId,
    slackUserId,
    query,
    nextMeta,
    ghlTimeoutMs = NEW_PROJECT_GHL_SEARCH_TIMEOUT_MS,
    overallDeadlineMs = NEW_PROJECT_SEARCH_OVERALL_DEADLINE_MS,
    slackUpdateTimeoutMs = NEW_PROJECT_SLACK_UPDATE_TIMEOUT_MS,
    searchContacts = searchProjectSetupContacts,
  } = input;
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  console.info("[new-project] search.async.start", {
    viewId: viewId ?? null,
    slackUserId,
    elapsedMs: 0,
    ghlTimeoutMs,
    overallDeadlineMs,
  });
  if (!viewId) {
    console.warn("[new-project] search.async.skip_no_view_id", {
      slackUserId,
      elapsedMs: elapsed(),
    });
    return;
  }

  const pushRetryErrorView = async (error: unknown): Promise<void> => {
    const errorText = friendlySearchErrorText(error);
    console.error("[new-project] search.async.error", {
      viewId,
      slackUserId,
      message: error instanceof Error ? error.message : String(error),
      elapsedMs: elapsed(),
    });
    try {
      console.info("[new-project] search.async.views_update.start", {
        viewId,
        purpose: "error_retry",
        elapsedMs: elapsed(),
      });
      await withDeadline(
        updateSlackModal({
          viewId,
          view: buildSearchModal({
            prefill: query,
            meta: nextMeta,
            errorText,
          }),
        }),
        slackUpdateTimeoutMs,
        "Slack error modal update timed out",
      );
      console.info("[new-project] search.async.views_update.done", {
        viewId,
        purpose: "error_retry",
        elapsedMs: elapsed(),
      });
    } catch (updateError) {
      console.error("[new-project] search.async.update_failed", {
        viewId,
        slackUserId,
        message: updateError instanceof Error ? updateError.message : String(updateError),
        elapsedMs: elapsed(),
      });
    }
  };

  try {
    await withDeadline(
      (async () => {
        console.info("[new-project] search.async.ghl.start", {
          viewId,
          slackUserId,
          elapsedMs: elapsed(),
        });
        let hits: Awaited<ReturnType<typeof searchProjectSetupContacts>>;
        try {
          hits = await withDeadline(
            searchContacts(query),
            ghlTimeoutMs,
            "GoHighLevel search timed out",
          );
          console.info("[new-project] search.async.ghl.done", {
            viewId,
            slackUserId,
            hitCount: hits.length,
            elapsedMs: elapsed(),
          });
        } catch (ghlError) {
          console.error("[new-project] search.async.ghl.failed", {
            viewId,
            slackUserId,
            message: ghlError instanceof Error ? ghlError.message : String(ghlError),
            elapsedMs: elapsed(),
          });
          throw ghlError;
        }

        const view =
          hits.length === 0
            ? buildSearchModal({
                prefill: query,
                meta: nextMeta,
                errorText: `No GoHighLevel contacts matched “${query}”. Try another name.`,
              })
            : buildPickModal({ meta: nextMeta, hits });

        console.info("[new-project] search.async.views_update.start", {
          viewId,
          purpose: hits.length === 0 ? "empty" : "pick",
          elapsedMs: elapsed(),
        });
        await withDeadline(
          updateSlackModal({ viewId, view }),
          slackUpdateTimeoutMs,
          "Slack modal update timed out",
        );
        console.info("[new-project] search.async.views_update.done", {
          viewId,
          purpose: hits.length === 0 ? "empty" : "pick",
          elapsedMs: elapsed(),
        });
        console.info("[new-project] search.async.done", {
          viewId,
          slackUserId,
          hitCount: hits.length,
          elapsedMs: elapsed(),
        });
      })(),
      overallDeadlineMs,
      "Search overall deadline exceeded",
    );
  } catch (error) {
    // Outside the overall race so a GHL/deadline failure can still update the modal.
    await pushRetryErrorView(error);
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
