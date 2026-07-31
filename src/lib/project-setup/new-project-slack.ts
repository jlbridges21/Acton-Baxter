/**
 * Compatibility re-exports for the /new-project Slack ack path.
 * Prefer importing from new-project-ack (interactions) or new-project-async (slash command).
 * This barrel must NOT re-export new-project-async — that would pull GHL/Google into
 * any consumer of handleNewProjectViewSubmission.
 */

export {
  buildViewSubmissionErrorResponse,
  handleNewProjectViewSubmission,
} from "./new-project-ack";
