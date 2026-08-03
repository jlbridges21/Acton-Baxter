/**
 * Client-safe field metadata for admin manual step resolution.
 * Keep in sync with `manual-resolve.ts` (server).
 */

import type { ProjectSetupStepKey } from "./types";

export type ManualResolveField = {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
};

export const MANUAL_RESOLVE_FIELDS: Record<ProjectSetupStepKey, ManualResolveField[]> = {
  allocate_project_number: [
    {
      key: "projectNumber",
      label: "Project number",
      required: true,
      hint: "e.g. L01-26019",
    },
  ],
  append_master_log_row: [],
  copy_template_folder: [
    {
      key: "destinationFolderId",
      label: "Destination folder ID",
      required: true,
      hint: "Google Drive folder id of the project folder that should be kept",
    },
    {
      key: "webViewLink",
      label: "Folder link",
      required: false,
      hint: "Optional https://drive.google.com/... link",
    },
  ],
  copy_charter_spreadsheet: [
    {
      key: "fileId",
      label: "Charter spreadsheet ID",
      required: true,
    },
    {
      key: "webViewLink",
      label: "Charter link",
      required: true,
      hint: "Required for Project Charter List append",
    },
  ],
  append_charter_list_row: [],
  create_slack_channel: [
    {
      key: "channelId",
      label: "Slack channel ID",
      required: true,
      hint: "e.g. C0123456789",
    },
  ],
  post_kickoff_message: [],
};
