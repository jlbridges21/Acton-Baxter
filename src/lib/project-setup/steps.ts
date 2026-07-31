import "server-only";

import type { ProjectSetupStepDefinition, ProjectSetupStepResult } from "./types";
import {
  columnAContainsProjectNumber,
  computeNextProjectNumberFromColumnA,
  formatFpPaidDateForSheet,
  parseProjectNumber,
  twoDigitYearFromDate,
} from "./project-number";
import { readSheetColumnA } from "./sheets";
import { isProjectNumberInUse, updateProjectSetupRun, updateProjectSetupStep } from "./store";
import { resolveInviteMemberEmails } from "./names";
import { googleWritesEnabled, slackProvisioningEnabled } from "./capabilities";
import {
  appendSheetRow,
  copyFile,
  findChildByName,
  getDriveFileMeta,
  readSheetColumn,
  readSheetValues,
} from "@/lib/connectors/google/writes";
import { copyTemplateFolderTree } from "./folder-copy";
import { GOOGLE_SHEET_MIME } from "@/lib/connectors/google/types";
import { buildCharterListRowValues, charterListAlreadyHasCharter } from "./charter-list";
import { postSlackMessage } from "@/lib/slack/client";
import {
  createPublicSlackChannel,
  inviteUsersToSlackChannel,
  lookupSlackUserByEmail,
  type SlackInviteResult,
} from "@/lib/slack/provisioning";

async function executeAllocateProjectNumber(
  ctx: Parameters<ProjectSetupStepDefinition["execute"]>[0],
): Promise<ProjectSetupStepResult> {
  const override = ctx.run.projectNumber?.trim();
  if (override) {
    const parsed = parseProjectNumber(override);
    if (!parsed) {
      throw new Error(`Project number "${override}" is not valid. Use the format like L01-26017.`);
    }
    // Dry runs never reserve — uniqueness only against live runs.
    if (!ctx.run.dryRun) {
      const inUse = await isProjectNumberInUse(parsed.raw, ctx.run.id);
      if (inUse) {
        throw new Error(
          `Project number ${parsed.raw} is already assigned to another active setup run.`,
        );
      }
    }
    await updateProjectSetupRun(ctx.run.id, { projectNumber: parsed.raw });
    return {
      outputJson: {
        projectNumber: parsed.raw,
        source: "user_override",
        dryRun: ctx.run.dryRun,
        reservesNumber: !ctx.run.dryRun,
      },
    };
  }

  const values = await readSheetColumnA({
    spreadsheetId: ctx.settings.masterCharterSpreadsheetId,
    tabName: ctx.settings.masterLogTabName,
  });
  const referenceYear = twoDigitYearFromDate(ctx.run.fpPaidDate);
  const computed = computeNextProjectNumberFromColumnA(values, { referenceYear });
  if (!ctx.run.dryRun) {
    const inUse = await isProjectNumberInUse(computed.nextNumber, ctx.run.id);
    if (inUse) {
      throw new Error(
        `Computed next project number ${computed.nextNumber} is already in use by another active run. Enter a different number on the confirm screen.`,
      );
    }
  }

  await updateProjectSetupRun(ctx.run.id, { projectNumber: computed.nextNumber });

  return {
    outputJson: {
      projectNumber: computed.nextNumber,
      source: "master_project_log",
      sourceValue: computed.sourceValue,
      sourceRowIndex: computed.sourceRowIndex,
      rolledOver: computed.rolledOver,
      referenceYear,
      spreadsheetId: ctx.settings.masterCharterSpreadsheetId,
      tabName: ctx.settings.masterLogTabName,
      dryRun: ctx.run.dryRun,
      reservesNumber: !ctx.run.dryRun,
    },
  };
}

function dryRunPlan(title: string, planned: Record<string, unknown>): ProjectSetupStepResult {
  return {
    status: "planned",
    outputJson: {
      mode: "dry_run",
      title,
      planned,
      executed: false,
      note: "No external systems were modified.",
    },
  };
}

function streetAddressFromSnapshot(snapshot: {
  address: string | null;
  city: string | null;
}): string {
  const address = snapshot.address?.trim() ?? "";
  if (!address) return "";
  const city = snapshot.city?.trim();
  if (city && address.toLowerCase().includes(city.toLowerCase())) {
    const idx = address.toLowerCase().indexOf(city.toLowerCase());
    if (idx > 0) {
      return address
        .slice(0, idx)
        .replace(/[,\s]+$/, "")
        .trim();
    }
  }
  return address;
}

async function executeAppendMasterLogRow(
  ctx: Parameters<ProjectSetupStepDefinition["execute"]>[0],
): Promise<ProjectSetupStepResult> {
  const projectNumber =
    (ctx.priorOutputs.allocate_project_number?.projectNumber as string | undefined) ||
    ctx.run.projectNumber;
  if (!projectNumber) {
    throw new Error("Project number is missing — allocate it before appending the Master Log row.");
  }

  const row = {
    projectNumber,
    lastName: ctx.run.projectLastName ?? "",
    salesRep: ctx.run.salesRep ?? "",
    fpPaidDate: formatFpPaidDateForSheet(ctx.run.fpPaidDate),
    customerName: ctx.run.contactSnapshot.name ?? "",
    street: streetAddressFromSnapshot(ctx.run.contactSnapshot),
    city: ctx.run.contactSnapshot.city ?? "",
    postalCode: ctx.run.contactSnapshot.postalCode ?? "",
    jurisdiction: ctx.run.contactSnapshot.city ?? "",
  };

  const planned = {
    spreadsheetId: ctx.settings.masterCharterSpreadsheetId,
    tabName: ctx.settings.masterLogTabName,
    columns: "A–I",
    row,
  };

  if (!(await googleWritesEnabled()) || ctx.run.dryRun) {
    return dryRunPlan("Append Master Project Log row", planned);
  }

  const columnA = await readSheetColumn({
    spreadsheetId: ctx.settings.masterCharterSpreadsheetId,
    tabName: ctx.settings.masterLogTabName,
    column: "A",
  });
  if (columnAContainsProjectNumber(columnA, projectNumber)) {
    return {
      outputJson: {
        mode: "live",
        alreadyPresent: true,
        projectNumber,
        spreadsheetId: ctx.settings.masterCharterSpreadsheetId,
        tabName: ctx.settings.masterLogTabName,
        executed: true,
        note: "Project number already present in column A — skipped append (idempotent resume).",
      },
    };
  }

  const values = [
    row.projectNumber,
    row.lastName,
    row.salesRep,
    row.fpPaidDate,
    row.customerName,
    row.street,
    row.city,
    row.postalCode,
    row.jurisdiction,
  ];

  const appended = await appendSheetRow({
    spreadsheetId: ctx.settings.masterCharterSpreadsheetId,
    tabName: ctx.settings.masterLogTabName,
    values,
  });

  return {
    outputJson: {
      mode: "live",
      alreadyPresent: false,
      projectNumber,
      spreadsheetId: ctx.settings.masterCharterSpreadsheetId,
      tabName: ctx.settings.masterLogTabName,
      updatedRange: appended.updatedRange,
      updatedRows: appended.updatedRows,
      values,
      executed: true,
    },
  };
}

async function executeCopyTemplateFolder(
  ctx: Parameters<ProjectSetupStepDefinition["execute"]>[0],
): Promise<ProjectSetupStepResult> {
  const folderName = ctx.run.folderName;
  if (!folderName) {
    throw new Error("Folder name is missing on this run.");
  }

  const excludeFileIds = [ctx.settings.masterCharterSpreadsheetId].filter(Boolean);

  const planned = {
    templateFolderId: ctx.settings.templateFolderId,
    destinationParentId: ctx.settings.projectsParentFolderId,
    folderName,
    excludeFileIds,
    note: "Project Charter Master spreadsheet is excluded from the folder copy.",
  };

  if (!(await googleWritesEnabled()) || ctx.run.dryRun) {
    return dryRunPlan("Copy project template folder", planned);
  }

  const priorId =
    typeof ctx.partialOutput.destinationFolderId === "string"
      ? ctx.partialOutput.destinationFolderId
      : null;

  const result = await copyTemplateFolderTree({
    templateFolderId: ctx.settings.templateFolderId,
    projectsParentFolderId: ctx.settings.projectsParentFolderId,
    folderName,
    priorDestinationFolderId: priorId,
    excludeFileIds,
    onProgress: async (progress) => {
      await updateProjectSetupStep(ctx.stepId, {
        outputJson: {
          mode: "live",
          ...progress,
          inProgress: true,
        },
      });
    },
  });

  return {
    outputJson: {
      mode: "live",
      executed: true,
      destinationFolderId: result.destinationFolderId,
      webViewLink: result.destinationFolderLink,
      copiedFiles: result.copiedFiles,
      createdFolders: result.createdFolders,
      skipped: result.skipped,
      excluded: result.excluded,
      verification: result.verification,
    },
  };
}

async function executeCopyCharterSpreadsheet(
  ctx: Parameters<ProjectSetupStepDefinition["execute"]>[0],
): Promise<ProjectSetupStepResult> {
  const charterName = ctx.run.charterName;
  if (!charterName) {
    throw new Error("Charter name is missing on this run.");
  }

  const destinationFolderId =
    (ctx.priorOutputs.copy_template_folder?.destinationFolderId as string | undefined) ||
    (typeof ctx.partialOutput.destinationFolderId === "string"
      ? ctx.partialOutput.destinationFolderId
      : null);

  const planned = {
    sourceSpreadsheetId: ctx.settings.masterCharterSpreadsheetId,
    charterName,
    destinationFolderId,
    note: "All tabs retained, including Master Project Log.",
  };

  if (!(await googleWritesEnabled()) || ctx.run.dryRun) {
    return dryRunPlan("Copy project charter spreadsheet", {
      ...planned,
      destinationParentId: ctx.settings.projectsParentFolderId,
    });
  }

  if (!destinationFolderId) {
    throw new Error(
      "Project folder id is missing — complete the template folder copy before copying the charter.",
    );
  }

  const existing = await findChildByName(destinationFolderId, charterName);
  if (existing) {
    const meta =
      existing.mimeType === GOOGLE_SHEET_MIME
        ? existing
        : await getDriveFileMeta(existing.id).catch(() => existing);
    return {
      outputJson: {
        mode: "live",
        alreadyPresent: true,
        executed: true,
        fileId: meta.id,
        webViewLink: meta.webViewLink ?? null,
        charterName,
        destinationFolderId,
        note: "Charter already present in the project folder — skipped copy (idempotent resume).",
      },
    };
  }

  const copied = await copyFile({
    fileId: ctx.settings.masterCharterSpreadsheetId,
    name: charterName,
    parentId: destinationFolderId,
  });

  return {
    outputJson: {
      mode: "live",
      alreadyPresent: false,
      executed: true,
      fileId: copied.id,
      webViewLink: copied.webViewLink ?? null,
      charterName,
      destinationFolderId,
      note: "All tabs retained, including Master Project Log.",
    },
  };
}

async function executeAppendCharterListRow(
  ctx: Parameters<ProjectSetupStepDefinition["execute"]>[0],
): Promise<ProjectSetupStepResult> {
  const charterName = ctx.run.charterName ?? "";
  const charterOut = ctx.priorOutputs.copy_charter_spreadsheet ?? {};
  const fileId = (charterOut.fileId as string | undefined) ?? null;
  const webViewLink = (charterOut.webViewLink as string | undefined) ?? null;

  const planned = {
    spreadsheetId: ctx.settings.masterCharterSpreadsheetId,
    tabName: ctx.settings.charterListTabName,
    charterName,
    fileId,
    webViewLink,
    values: webViewLink
      ? buildCharterListRowValues({ charterName, webViewLink })
      : ["(charter link pending)"],
  };

  if (!(await googleWritesEnabled()) || ctx.run.dryRun) {
    return dryRunPlan("Append Project Charter List row", planned);
  }

  if (!webViewLink) {
    throw new Error(
      "Charter webViewLink is missing — complete the charter copy before appending the Project Charter List row.",
    );
  }

  const existingRows = await readSheetValues({
    spreadsheetId: ctx.settings.masterCharterSpreadsheetId,
    tabName: ctx.settings.charterListTabName,
    rangeA1: "A:Z",
    valueRenderOption: "FORMULA",
  });
  if (charterListAlreadyHasCharter(existingRows, { fileId, webViewLink })) {
    return {
      outputJson: {
        mode: "live",
        alreadyPresent: true,
        executed: true,
        spreadsheetId: ctx.settings.masterCharterSpreadsheetId,
        tabName: ctx.settings.charterListTabName,
        fileId,
        webViewLink,
        note: "Charter already listed — skipped append (idempotent resume).",
      },
    };
  }

  const values = buildCharterListRowValues({ charterName, webViewLink });
  const appended = await appendSheetRow({
    spreadsheetId: ctx.settings.masterCharterSpreadsheetId,
    tabName: ctx.settings.charterListTabName,
    values,
    rangeHint: `'${ctx.settings.charterListTabName.replace(/'/g, "''")}'!A:A`,
  });

  return {
    outputJson: {
      mode: "live",
      alreadyPresent: false,
      executed: true,
      spreadsheetId: ctx.settings.masterCharterSpreadsheetId,
      tabName: ctx.settings.charterListTabName,
      updatedRange: appended.updatedRange,
      values,
      fileId,
      webViewLink,
    },
  };
}

export function buildKickoffMessageText(input: {
  projectNumber: string | null;
  projectLastName: string | null;
  folderName: string | null;
  charterName: string | null;
  folderLink: string | null;
  charterLink: string | null;
}): string {
  const number = input.projectNumber ?? "—";
  const lastName = input.projectLastName ?? "—";
  const folderLabel = input.folderName ?? `${number} ${lastName}`;
  const charterLabel = input.charterName ?? `${lastName} Project Charter`;
  const folderLine = input.folderLink
    ? `• G-Drive: <${input.folderLink}|${folderLabel}>`
    : `• G-Drive: ${folderLabel}`;
  const charterLine = input.charterLink
    ? `• Project Charter: <${input.charterLink}|${charterLabel}>`
    : `• Project Charter: ${charterLabel}`;
  return [
    `New project ${number} — ${lastName}`,
    folderLine,
    charterLine,
    "• Setting up BuilderTrend now.",
  ].join("\n");
}

async function executeCreateSlackChannel(
  ctx: Parameters<ProjectSetupStepDefinition["execute"]>[0],
): Promise<ProjectSetupStepResult> {
  const members = resolveInviteMemberEmails(ctx.settings);
  const channelName = ctx.run.slackChannelName;
  if (!channelName) {
    throw new Error("Slack channel name is missing on this run.");
  }

  const planned = {
    channelName,
    inviteEmails: members.emails,
    testMode: members.testMode,
    memberLabel: members.label,
    isPrivate: false,
  };

  if (!slackProvisioningEnabled() || ctx.run.dryRun) {
    return dryRunPlan("Create Slack channel and invite members", planned);
  }

  // Idempotent resume: reuse channel created earlier in this run.
  const priorChannelId =
    typeof ctx.partialOutput.channelId === "string" ? ctx.partialOutput.channelId : null;

  let channelId = priorChannelId;
  if (!channelId) {
    const created = await createPublicSlackChannel(channelName);
    if (created.alreadyExistsError) {
      throw new Error(
        `Slack channel #${channelName} already exists (name_taken). This can also happen if an archived channel still holds that name. Rename or archive/delete the existing channel, then retry — Baxter will not post into a channel this run did not create.`,
      );
    }
    channelId = created.channelId;
    await updateProjectSetupStep(ctx.stepId, {
      outputJson: {
        mode: "live",
        channelId,
        channelName,
        inProgress: true,
      },
    });
  }

  const inviteResults: SlackInviteResult[] = [];
  const userIds: string[] = [];
  const emailsByUserId: Record<string, string> = {};

  for (const email of members.emails) {
    const looked = await lookupSlackUserByEmail(email);
    if ("notFound" in looked) {
      inviteResults.push({
        email,
        status: "not_found",
        warning: `${email} was not found in the Slack workspace`,
      });
      continue;
    }
    if ("error" in looked) {
      inviteResults.push({
        email,
        status: "failed",
        warning: `${email}: ${looked.error}`,
      });
      continue;
    }
    userIds.push(looked.userId);
    emailsByUserId[looked.userId] = email;
  }

  const invite = await inviteUsersToSlackChannel({
    channelId,
    userIds,
    emailsByUserId,
  });
  inviteResults.push(...invite.results);

  if (invite.successCount === 0 && members.emails.length > 0) {
    throw new Error(
      `Created #${channelName} but could not invite any members (${members.emails.join(", ")}). Check that those emails exist in Slack, then retry — the existing channel will be reused.`,
    );
  }

  return {
    outputJson: {
      mode: "live",
      executed: true,
      channelId,
      channelName,
      testMode: members.testMode,
      inviteEmails: members.emails,
      inviteResults,
      inviteSuccessCount: invite.successCount,
    },
  };
}

async function executePostKickoffMessage(
  ctx: Parameters<ProjectSetupStepDefinition["execute"]>[0],
): Promise<ProjectSetupStepResult> {
  const folderLink =
    (ctx.priorOutputs.copy_template_folder?.webViewLink as string | undefined) ?? null;
  const charterLink =
    (ctx.priorOutputs.copy_charter_spreadsheet?.webViewLink as string | undefined) ?? null;
  const channelId =
    (ctx.priorOutputs.create_slack_channel?.channelId as string | undefined) ?? null;

  const text = buildKickoffMessageText({
    projectNumber: ctx.run.projectNumber,
    projectLastName: ctx.run.projectLastName,
    folderName: ctx.run.folderName,
    charterName: ctx.run.charterName,
    folderLink,
    charterLink,
  });

  const planned = {
    channelName: ctx.run.slackChannelName,
    channelId,
    messagePreview: text,
  };

  if (!slackProvisioningEnabled() || ctx.run.dryRun) {
    return dryRunPlan("Post Slack kickoff message", planned);
  }

  const priorTs =
    typeof ctx.partialOutput.messageTs === "string" ? ctx.partialOutput.messageTs : null;
  if (priorTs) {
    return {
      outputJson: {
        mode: "live",
        executed: true,
        alreadyPresent: true,
        channelId,
        messageTs: priorTs,
        text,
        note: "Kickoff message already posted — skipped repost (idempotent resume).",
      },
    };
  }

  if (!channelId) {
    throw new Error(
      "Slack channel id is missing — complete channel creation before posting the kickoff message.",
    );
  }

  const posted = await postSlackMessage({ channel: channelId, text });
  return {
    outputJson: {
      mode: "live",
      executed: true,
      alreadyPresent: false,
      channelId,
      messageTs: posted.ts ?? null,
      text,
    },
  };
}

export const PROJECT_SETUP_STEPS: ProjectSetupStepDefinition[] = [
  {
    key: "allocate_project_number",
    title: "Allocate project number",
    orderIndex: 0,
    execute: executeAllocateProjectNumber,
  },
  {
    key: "append_master_log_row",
    title: "Append Master Project Log row",
    orderIndex: 1,
    execute: executeAppendMasterLogRow,
  },
  {
    key: "copy_template_folder",
    title: "Copy project template folder",
    orderIndex: 2,
    execute: executeCopyTemplateFolder,
  },
  {
    key: "copy_charter_spreadsheet",
    title: "Copy project charter spreadsheet",
    orderIndex: 3,
    execute: executeCopyCharterSpreadsheet,
  },
  {
    key: "append_charter_list_row",
    title: "Append Project Charter List row",
    orderIndex: 4,
    execute: executeAppendCharterListRow,
  },
  {
    key: "create_slack_channel",
    title: "Create Slack channel",
    orderIndex: 5,
    execute: executeCreateSlackChannel,
  },
  {
    key: "post_kickoff_message",
    title: "Post kickoff message",
    orderIndex: 6,
    execute: executePostKickoffMessage,
  },
];

export function getStepDefinition(key: string): ProjectSetupStepDefinition | undefined {
  return PROJECT_SETUP_STEPS.find((s) => s.key === key);
}
