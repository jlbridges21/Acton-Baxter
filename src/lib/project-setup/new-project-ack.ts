/**
 * Fast-ack path for /new-project view_submission.
 *
 * CRITICAL: This module must NOT statically import GHL, Google, Supabase store,
 * job queue, or the project-setup runner. Those are dynamically imported inside
 * scheduled work AFTER the Slack ack returns (see new-project-async.ts).
 *
 * Cold-start evidence (local vitest, warm machine): importing the prior
 * new-project-slack barrel cost ~476ms vs ~21ms for views-only. On Vercel cold
 * starts that graph easily exceeds Slack's ~3s view_submission budget before
 * any handler code runs.
 */

import "server-only";

import { isSlackUserAllowed } from "@/lib/slack/config";
import {
  buildLoadingModal,
  decodeModalMeta,
  NEW_PROJECT_CALLBACK_CONFIRM,
  NEW_PROJECT_CALLBACK_PICK,
  NEW_PROJECT_CALLBACK_SEARCH,
  type NewProjectModalMeta,
  buildSearchModal,
} from "./new-project-views";

export type SlackViewSubmission = {
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
 * Immediate view_submission response. Zero network/Supabase awaits on this path.
 * Heavy work is scheduled; the schedule callback dynamically imports new-project-async.
 */
export async function handleNewProjectViewSubmission(
  payload: SlackViewSubmission,
  schedule: (work: () => Promise<void>) => void,
): Promise<Record<string, unknown>> {
  const handlerStartedAt = Date.now();
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

    // Sync allowlist check only (in-memory config) — no network I/O.
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

      schedule(async () => {
        const { runNewProjectSearchAsync } = await import("./new-project-async");
        await runNewProjectSearchAsync({ viewId, slackUserId, query, nextMeta });
      });

      // --- Immediate Slack ack constructed here (no awaits above for I/O) ---
      const response = {
        response_action: "update" as const,
        view: buildLoadingModal({
          meta: nextMeta,
          step: 1,
          message: `Searching GoHighLevel for “${query}”…`,
        }),
      };
      console.info("[new-project] search.ack", {
        elapsedMs: Date.now() - handlerStartedAt,
        viewId: viewId ?? null,
        slackUserId,
        responseBytes: JSON.stringify(response).length,
      });
      return response;
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
        const { runNewProjectPickAsync } = await import("./new-project-async");
        await runNewProjectPickAsync({ viewId, slackUserId, contactId, meta, nextMeta });
      });

      const response = {
        response_action: "update" as const,
        view: buildLoadingModal({
          meta: nextMeta,
          step: 2,
          message: "Loading customer details…",
        }),
      };
      console.info("[new-project] pick.ack", {
        elapsedMs: Date.now() - handlerStartedAt,
        viewId: viewId ?? null,
        slackUserId,
        responseBytes: JSON.stringify(response).length,
      });
      return response;
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
        const { runNewProjectConfirmAsync } = await import("./new-project-async");
        await runNewProjectConfirmAsync({ slackUserId, slackTeamId, contactId });
      });

      console.info("[new-project] confirm.ack", {
        elapsedMs: Date.now() - handlerStartedAt,
        slackUserId,
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
      elapsedMs: Date.now() - handlerStartedAt,
      message,
    });
    return buildViewSubmissionErrorResponse({
      callbackId,
      message: "Something went wrong — try /new-project again.",
      meta: decodeModalMeta(payload.view?.private_metadata),
    });
  }
}
