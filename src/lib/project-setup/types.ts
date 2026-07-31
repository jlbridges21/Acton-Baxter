/**
 * Project setup domain types and constants.
 */

export const PROJECT_SETUP_RUN_STATUSES = [
  "draft",
  "confirmed",
  "running",
  "complete",
  "failed",
  "cancelled",
] as const;
export type ProjectSetupRunStatus = (typeof PROJECT_SETUP_RUN_STATUSES)[number];

export const PROJECT_SETUP_STEP_STATUSES = [
  "pending",
  "running",
  "complete",
  "failed",
  "skipped",
] as const;
export type ProjectSetupStepStatus = (typeof PROJECT_SETUP_STEP_STATUSES)[number];

export const PROJECT_SETUP_STEP_KEYS = [
  "allocate_project_number",
  "append_master_log_row",
  "copy_template_folder",
  "copy_charter_spreadsheet",
  "create_slack_channel",
  "post_kickoff_message",
] as const;
export type ProjectSetupStepKey = (typeof PROJECT_SETUP_STEP_KEYS)[number];

export const PROJECT_NUMBER_RE = /^([A-Z]\d{2})-(\d{5})$/;

export const DEFAULT_STANDING_MEMBER_EMAILS = [
  "ally.moin@actonadu.com",
  "aws.jabir@actonadu.com",
  "bryan.moser@actonadu.com",
  "connor.rainey@actonadu.com",
  "jackson.bridges@actonadu.com",
  "james.parks@actonadu.com",
  "jessee.bayze@actonadu.com",
  "jesse.soares@actonadu.com",
  "kevin.lee@actonadu.com",
  "mark.nichols@actonadu.com",
  "maxx.kimbler@actonadu.com",
  "milan.romic@actonadu.com",
  "rebecca.ralston@actonadu.com",
  "stanley.acton@actonadu.com",
  "tony.radovich@actonadu.com",
  "zac.yeager@actonadu.com",
] as const;

export const DEFAULT_TEST_MEMBER_EMAILS = ["jackson.bridges@actonadu.com"] as const;

export const DEFAULT_TEMPLATE_FOLDER_ID = "1AJ6Czh9rJB04bJhNhChCl8E2AvCSFDIJ";
export const DEFAULT_PROJECTS_PARENT_FOLDER_ID = "150O10sPk_V2guH_Tqrx1AKNJyqsom0dv";
export const DEFAULT_MASTER_CHARTER_SPREADSHEET_ID = "1_REzrzFc7vREVxqceI47soA4HWa3u-H9Y961UeQ6u6k";
export const DEFAULT_MASTER_LOG_TAB_NAME = "Master Project Log";

export type ProjectSetupContactSnapshot = {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
};

export type ProjectSetupSettings = {
  id: 1;
  memberEmails: string[];
  testMode: boolean;
  testMemberEmails: string[];
  templateFolderId: string;
  projectsParentFolderId: string;
  masterCharterSpreadsheetId: string;
  masterLogTabName: string;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
};

export type ProjectSetupRun = {
  id: string;
  status: ProjectSetupRunStatus;
  dryRun: boolean;
  initiatedBy: string | null;
  triggerChannel: "web" | "slack";
  ghlContactId: string | null;
  contactSnapshot: ProjectSetupContactSnapshot;
  salesRep: string | null;
  projectNumber: string | null;
  projectLastName: string | null;
  folderName: string | null;
  charterName: string | null;
  slackChannelName: string | null;
  fpPaidDate: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSetupStep = {
  id: string;
  runId: string;
  stepKey: ProjectSetupStepKey;
  orderIndex: number;
  status: ProjectSetupStepStatus;
  outputJson: Record<string, unknown>;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSetupStepContext = {
  run: ProjectSetupRun;
  settings: ProjectSetupSettings;
  /** Previously completed step outputs keyed by step_key. */
  priorOutputs: Record<string, Record<string, unknown>>;
  /** Current step row id — used to persist mid-step progress for resume. */
  stepId: string;
  /** Existing output_json on this step (partial progress from a prior failed attempt). */
  partialOutput: Record<string, unknown>;
};

export type ProjectSetupStepResult = {
  outputJson: Record<string, unknown>;
};

export type ProjectSetupStepDefinition = {
  key: ProjectSetupStepKey;
  title: string;
  orderIndex: number;
  execute: (ctx: ProjectSetupStepContext) => Promise<ProjectSetupStepResult>;
};
