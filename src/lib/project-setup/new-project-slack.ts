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
  buildLoadingModal,
  buildPickModal,
  buildSearchModal,
  decodeModalMeta,
  NEW_PROJECT_CALLBACK_CONFIRM,
  NEW_PROJECT_CALLBACK_PICK,
  NEW_PROJECT_CALLBACK_SEARCH,
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

type SlackViewSubmission = {
  type?: string;
  user?: { id?: string };
  team?: { id?: string };
  view?: {
    id?: string;
    hash?: string;
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<
        string,
        Record<string, { value?: string; selected_option?: { value?: string } }>
      >;
    };
  };
};

function readInputValue(
  view: SlackViewSubmission["view"],
  blockId: string,
  actionId: string,
): string {
  const block = view?.state?.values?.[blockId];
  const action = block?.[actionId];
  if (action?.selected_option?.value) return action.selected_option.value;
  return action?.value?.trim() ?? "";
}

function summarizeViewState(view: SlackViewSubmission["view"]): string {
  const keys = Object.keys(view?.state?.values ?? {});
  return `blocks=[${keys.join(",")}]`;
}

/**
 * Valid Slack interaction error body. Prefer field errors that match current step inputs.
 * Confirm has no inputs — fall back to an update with a searchable error modal.
 */
export function buildViewSubmissionErrorResponse(input: {
  callbackId?: string;
  message: string;
  meta?: NewProjectModalMeta | null;
}): Record<string, unknown> {
  const callbackId = input.callbackId;
  if (callbackId === NEW_PROJECT_CALLBACK_PICK) {
    return {
      response_action: "errors",
      errors: { contact_pick: input.message },
    };
  }
  if (callbackId === NEW_PROJECT_CALLBACK_CONFIRM && input.meta) {
    return {
      response_action: "update",
      view: buildSearchModal({
        meta: input.meta,
        prefill: input.meta.query,
        errorText: input.message,
      }),
    };
  }
  return {
    response_action: "errors",
    errors: { customer_name: input.message },
  };
}

/**
 * Handle view_submission for the /new-project modal state machine.
 * Returns the immediate Slack response body (must finish within ~3s).
 * Slow work is scheduled via `schedule` (typically Next.js `after`).
 *
 * IMPORTANT: Follow-up `views.update` calls must NOT pass the original payload hash —
 * returning `response_action: "update"` (loading view) advances the view hash server-side,
 * so a stale hash causes Slack to reject the async update (and can surface as
 * "We had some trouble connecting").
 */
export async function handleNewProjectViewSubmission(
  payload: SlackViewSubmission,
  schedule: (work: () => Promise<void>) => void,
): Promise<Record<string, unknown>> {
  const callbackId = payload.view?.callback_id;
  const slackUserIdHint = payload.user?.id;

  try {
    const meta = decodeModalMeta(payload.view?.private_metadata);
    const slackUserId = payload.user?.id ?? meta?.slackUserId;
    const slackTeamId = payload.team?.id ?? meta?.slackTeamId;

    if (!slackUserId || !slackTeamId || !meta) {
      return buildViewSubmissionErrorResponse({
        callbackId,
        message: "Session expired — run /new-project again.",
        meta,
      });
    }

    if (!isSlackUserAllowed(slackUserId)) {
      return buildViewSubmissionErrorResponse({
        callbackId,
        message: "You are not authorized to run /new-project.",
        meta,
      });
    }

    if (callbackId === NEW_PROJECT_CALLBACK_SEARCH) {
      const query = readInputValue(payload.view, "customer_name", "customer_name_input");
      if (!query) {
        return buildViewSubmissionErrorResponse({
          callbackId,
          message: "Enter a customer name to search.",
          meta,
        });
      }

      const viewId = payload.view?.id;
      const nextMeta: NewProjectModalMeta = { ...meta, query };

      // Acknowledge with a loading view, then search async and views.update (no hash).
      schedule(async () => {
        console.info("[new-project] search.async.start", {
          viewId: viewId ?? null,
          slackUserId,
          callbackId,
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
              // Omit hash — loading-view ack already changed it.
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
      });

      return {
        response_action: "update",
        view: buildLoadingModal({
          meta: nextMeta,
          step: 1,
          message: `Searching GoHighLevel for “${query}”…`,
        }),
      };
    }

    if (callbackId === NEW_PROJECT_CALLBACK_PICK) {
      const contactId = readInputValue(payload.view, "contact_pick", "contact_pick_input");
      if (!contactId) {
        return buildViewSubmissionErrorResponse({
          callbackId,
          message: "Select a customer to continue.",
          meta,
        });
      }

      const viewId = payload.view?.id;
      const nextMeta: NewProjectModalMeta = { ...meta, contactId };

      schedule(async () => {
        console.info("[new-project] pick.async.start", {
          viewId: viewId ?? null,
          slackUserId,
          callbackId,
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
            // Omit hash — loading-view ack already changed it.
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
      });

      return {
        response_action: "update",
        view: buildLoadingModal({
          meta: nextMeta,
          step: 2,
          message: "Loading customer details…",
        }),
      };
    }

    if (callbackId === NEW_PROJECT_CALLBACK_CONFIRM) {
      const contactId = meta.contactId;
      if (!contactId) {
        return buildViewSubmissionErrorResponse({
          callbackId,
          message: "Session expired — run /new-project again.",
          meta,
        });
      }

      schedule(async () => {
        console.info("[new-project] confirm.async.start", { slackUserId, callbackId });
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
          await dmUser(slackUserId, `Could not start project setup: ${message}`).catch(
            () => undefined,
          );
        }
      });

      return { response_action: "clear" };
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    console.error("[new-project] view_submission.unhandled", {
      callbackId: callbackId ?? null,
      slackUserId: slackUserIdHint ?? null,
      viewState: summarizeViewState(payload.view),
      message,
    });
    return buildViewSubmissionErrorResponse({
      callbackId,
      message: "Something went wrong — try /new-project again.",
      meta: decodeModalMeta(payload.view?.private_metadata),
    });
  }
}

async function dmUser(slackUserId: string, text: string): Promise<void> {
  const dm = await openSlackDm(slackUserId);
  await postSlackMessage({ channel: dm.channelId, text });
}
