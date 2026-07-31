import "server-only";

import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { resolveBaxterUserForSlackIdentity } from "@/lib/slack/identity";
import { openSlackModal, openSlackDm } from "@/lib/slack/provisioning";
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
import { updateSlackModal } from "@/lib/slack/provisioning";

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

/**
 * Handle view_submission for the /new-project modal state machine.
 * Returns the immediate Slack response body (must finish within ~3s).
 * Slow work is scheduled via `schedule` (typically Next.js `after`).
 */
export async function handleNewProjectViewSubmission(
  payload: SlackViewSubmission,
  schedule: (work: () => Promise<void>) => void,
): Promise<Record<string, unknown>> {
  const callbackId = payload.view?.callback_id;
  const meta = decodeModalMeta(payload.view?.private_metadata);
  const slackUserId = payload.user?.id ?? meta?.slackUserId;
  const slackTeamId = payload.team?.id ?? meta?.slackTeamId;

  if (!slackUserId || !slackTeamId || !meta) {
    return {
      response_action: "errors",
      errors: { customer_name: "Session expired — run /new-project again." },
    };
  }

  if (!isSlackUserAllowed(slackUserId)) {
    return {
      response_action: "errors",
      errors: { customer_name: "You are not authorized to run /new-project." },
    };
  }

  if (callbackId === NEW_PROJECT_CALLBACK_SEARCH) {
    const query = readInputValue(payload.view, "customer_name", "customer_name_input");
    if (!query) {
      return {
        response_action: "errors",
        errors: { customer_name: "Enter a customer name to search." },
      };
    }

    const viewId = payload.view?.id;
    const hash = payload.view?.hash;
    const nextMeta: NewProjectModalMeta = { ...meta, query };

    // Acknowledge with a loading view, then search async and views.update.
    schedule(async () => {
      if (!viewId) return;
      try {
        const hits = await searchProjectSetupContacts(query);
        if (hits.length === 0) {
          await updateSlackModal({
            viewId,
            hash,
            view: buildSearchModal({
              prefill: query,
              meta: nextMeta,
              errorText: `No GoHighLevel contacts matched “${query}”. Try another name.`,
            }),
          });
          return;
        }
        await updateSlackModal({
          viewId,
          hash,
          view: buildPickModal({ meta: nextMeta, hits }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Search failed";
        await updateSlackModal({
          viewId,
          hash,
          view: buildSearchModal({
            prefill: query,
            meta: nextMeta,
            errorText: message,
          }),
        }).catch(() => undefined);
      }
    });

    return {
      response_action: "update",
      view: buildLoadingModal({
        meta: nextMeta,
        message: `Searching GoHighLevel for “${query}”…`,
      }),
    };
  }

  if (callbackId === NEW_PROJECT_CALLBACK_PICK) {
    const contactId = readInputValue(payload.view, "contact_pick", "contact_pick_input");
    if (!contactId) {
      return {
        response_action: "errors",
        errors: { contact_pick: "Select a customer to continue." },
      };
    }

    const viewId = payload.view?.id;
    const hash = payload.view?.hash;
    const nextMeta: NewProjectModalMeta = { ...meta, contactId };

    schedule(async () => {
      if (!viewId) return;
      try {
        const contact = await loadProjectSetupContactSnapshot(contactId);
        const preview = await buildProjectSetupPreview({ contact });
        await updateSlackModal({
          viewId,
          hash,
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
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load contact";
        await updateSlackModal({
          viewId,
          hash,
          view: buildSearchModal({
            prefill: meta.query,
            meta,
            errorText: message,
          }),
        }).catch(() => undefined);
      }
    });

    return {
      response_action: "update",
      view: buildLoadingModal({
        meta: nextMeta,
        message: "Loading customer details…",
      }),
    };
  }

  if (callbackId === NEW_PROJECT_CALLBACK_CONFIRM) {
    const contactId = meta.contactId;
    if (!contactId) {
      return {
        response_action: "errors",
        errors: {},
      };
    }

    schedule(async () => {
      try {
        const writesEnabled = await googleWritesEnabled();
        if (!writesEnabled) {
          await dmUser(
            slackUserId,
            "Google write scopes are not connected yet. Reconnect Google at /admin/connectors/google, then try again.",
          );
          return;
        }
        if (!slackProvisioningEnabled()) {
          await dmUser(
            slackUserId,
            "Slack provisioning is not configured (ENABLE_SLACK_INTEGRATION / bot token). Ask an admin to check Slack setup.",
          );
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
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to start project setup";
        await dmUser(slackUserId, `Could not start project setup: ${message}`).catch(
          () => undefined,
        );
      }
    });

    return { response_action: "clear" };
  }

  return { ok: true };
}

async function dmUser(slackUserId: string, text: string): Promise<void> {
  const dm = await openSlackDm(slackUserId);
  await postSlackMessage({ channel: dm.channelId, text });
}
