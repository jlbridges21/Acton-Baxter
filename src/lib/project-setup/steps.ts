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
} from "@/lib/connectors/google/writes";
import { copyTemplateFolderTree } from "./folder-copy";
import { GOOGLE_SHEET_MIME } from "@/lib/connectors/google/types";

async function executeAllocateProjectNumber(
  ctx: Parameters<ProjectSetupStepDefinition["execute"]>[0],
): Promise<ProjectSetupStepResult> {
  const override = ctx.run.projectNumber?.trim();
  if (override) {
    const parsed = parseProjectNumber(override);
    if (!parsed) {
      throw new Error(`Project number "${override}" is not valid. Use the format like L01-26017.`);
    }
    const inUse = await isProjectNumberInUse(parsed.raw, ctx.run.id);
    if (inUse) {
      throw new Error(
        `Project number ${parsed.raw} is already assigned to another active setup run.`,
      );
    }
    await updateProjectSetupRun(ctx.run.id, { projectNumber: parsed.raw });
    return {
      outputJson: {
        projectNumber: parsed.raw,
        source: "user_override",
        dryRun: ctx.run.dryRun,
      },
    };
  }

  const values = await readSheetColumnA({
    spreadsheetId: ctx.settings.masterCharterSpreadsheetId,
    tabName: ctx.settings.masterLogTabName,
  });
  const referenceYear = twoDigitYearFromDate(ctx.run.fpPaidDate);
  const computed = computeNextProjectNumberFromColumnA(values, { referenceYear });
  const inUse = await isProjectNumberInUse(computed.nextNumber, ctx.run.id);
  if (inUse) {
    throw new Error(
      `Computed next project number ${computed.nextNumber} is already in use by another active run. Enter a different number on the confirm screen.`,
    );
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
    },
  };
}

function dryRunPlan(title: string, planned: Record<string, unknown>): ProjectSetupStepResult {
  return {
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
    // Prefer the part before the city when address is a full formatted string.
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

  const planned = {
    templateFolderId: ctx.settings.templateFolderId,
    destinationParentId: ctx.settings.projectsParentFolderId,
    folderName,
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

async function executeCreateSlackChannel(
  ctx: Parameters<ProjectSetupStepDefinition["execute"]>[0],
): Promise<ProjectSetupStepResult> {
  const members = resolveInviteMemberEmails(ctx.settings);
  const planned = {
    channelName: ctx.run.slackChannelName,
    inviteEmails: members.emails,
    testMode: members.testMode,
    memberLabel: members.label,
  };
  if (!slackProvisioningEnabled() || ctx.run.dryRun) {
    // Slack stays dry-run until Prompt 3 (slackProvisioningEnabled is always false today).
    return dryRunPlan("Create Slack channel and invite members", planned);
  }
  throw new Error("Slack provisioning executor not enabled yet (Prompt 3).");
}

async function executePostKickoffMessage(
  ctx: Parameters<ProjectSetupStepDefinition["execute"]>[0],
): Promise<ProjectSetupStepResult> {
  const folderLink =
    (ctx.priorOutputs.copy_template_folder?.webViewLink as string | undefined) ?? null;
  const charterLink =
    (ctx.priorOutputs.copy_charter_spreadsheet?.webViewLink as string | undefined) ?? null;
  const planned = {
    channelName: ctx.run.slackChannelName,
    messagePreview: [
      `New project ${ctx.run.projectNumber} — ${ctx.run.projectLastName}`,
      `Customer: ${ctx.run.contactSnapshot.name ?? "—"}`,
      `Sales rep: ${ctx.run.salesRep ?? "—"}`,
      `FP paid: ${ctx.run.fpPaidDate ?? "—"}`,
      `Folder: ${ctx.run.folderName}${folderLink ? ` (${folderLink})` : ""}`,
      `Charter: ${ctx.run.charterName}${charterLink ? ` (${charterLink})` : ""}`,
      "Setting up BuilderTrend now.",
    ].join("\n"),
  };
  if (!slackProvisioningEnabled() || ctx.run.dryRun) {
    return dryRunPlan("Post Slack kickoff message", planned);
  }
  throw new Error("Slack provisioning executor not enabled yet (Prompt 3).");
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
    key: "create_slack_channel",
    title: "Create Slack channel",
    orderIndex: 4,
    execute: executeCreateSlackChannel,
  },
  {
    key: "post_kickoff_message",
    title: "Post kickoff message",
    orderIndex: 5,
    execute: executePostKickoffMessage,
  },
];

export function getStepDefinition(key: string): ProjectSetupStepDefinition | undefined {
  return PROJECT_SETUP_STEPS.find((s) => s.key === key);
}
