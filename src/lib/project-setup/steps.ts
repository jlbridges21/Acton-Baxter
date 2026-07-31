import "server-only";

import type { ProjectSetupStepDefinition, ProjectSetupStepResult } from "./types";
import { computeNextProjectNumberFromColumnA, parseProjectNumber } from "./project-number";
import { readSheetColumnA } from "./sheets";
import { isProjectNumberInUse, updateProjectSetupRun } from "./store";
import { resolveInviteMemberEmails } from "./names";
import { googleWritesEnabled, slackProvisioningEnabled } from "./capabilities";

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
  const computed = computeNextProjectNumberFromColumnA(values);
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

async function executeAppendMasterLogRow(
  ctx: Parameters<ProjectSetupStepDefinition["execute"]>[0],
): Promise<ProjectSetupStepResult> {
  const projectNumber =
    (ctx.priorOutputs.allocate_project_number?.projectNumber as string | undefined) ||
    ctx.run.projectNumber;
  const planned = {
    spreadsheetId: ctx.settings.masterCharterSpreadsheetId,
    tabName: ctx.settings.masterLogTabName,
    row: {
      projectNumber,
      customerName: ctx.run.contactSnapshot.name,
      lastName: ctx.run.projectLastName,
      salesRep: ctx.run.salesRep,
      fpPaidDate: ctx.run.fpPaidDate,
      address: ctx.run.contactSnapshot.address,
      city: ctx.run.contactSnapshot.city,
      postalCode: ctx.run.contactSnapshot.postalCode,
    },
  };
  if (!googleWritesEnabled() || ctx.run.dryRun) {
    return dryRunPlan("Append Master Project Log row", planned);
  }
  throw new Error("Google write executor not enabled yet (Prompt 2).");
}

async function executeCopyTemplateFolder(
  ctx: Parameters<ProjectSetupStepDefinition["execute"]>[0],
): Promise<ProjectSetupStepResult> {
  const planned = {
    templateFolderId: ctx.settings.templateFolderId,
    destinationParentId: ctx.settings.projectsParentFolderId,
    folderName: ctx.run.folderName,
  };
  if (!googleWritesEnabled() || ctx.run.dryRun) {
    return dryRunPlan("Copy project template folder", planned);
  }
  throw new Error("Google write executor not enabled yet (Prompt 2).");
}

async function executeCopyCharterSpreadsheet(
  ctx: Parameters<ProjectSetupStepDefinition["execute"]>[0],
): Promise<ProjectSetupStepResult> {
  const planned = {
    sourceSpreadsheetId: ctx.settings.masterCharterSpreadsheetId,
    charterName: ctx.run.charterName,
    destinationParentId: ctx.settings.projectsParentFolderId,
    note: "Charter copy lands in the new project folder once folder creation is live.",
  };
  if (!googleWritesEnabled() || ctx.run.dryRun) {
    return dryRunPlan("Copy project charter spreadsheet", planned);
  }
  throw new Error("Google write executor not enabled yet (Prompt 2).");
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
    return dryRunPlan("Create Slack channel and invite members", planned);
  }
  throw new Error("Slack provisioning executor not enabled yet (Prompt 3).");
}

async function executePostKickoffMessage(
  ctx: Parameters<ProjectSetupStepDefinition["execute"]>[0],
): Promise<ProjectSetupStepResult> {
  const planned = {
    channelName: ctx.run.slackChannelName,
    messagePreview: [
      `New project ${ctx.run.projectNumber} — ${ctx.run.projectLastName}`,
      `Customer: ${ctx.run.contactSnapshot.name ?? "—"}`,
      `Sales rep: ${ctx.run.salesRep ?? "—"}`,
      `FP paid: ${ctx.run.fpPaidDate ?? "—"}`,
      `Folder: ${ctx.run.folderName}`,
      `Charter: ${ctx.run.charterName}`,
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
