/**
 * Client-safe friendly summaries for Project Setup step outputs.
 * Raw JSON is never the default employee view — use `raw` only in admin technical details.
 */

export type ProjectSetupStepLink = {
  label: string;
  href: string;
};

export type ProjectSetupStepSummary = {
  headline: string;
  links: ProjectSetupStepLink[];
  notes: string[];
  /** Full output for admin technical details only. */
  raw: Record<string, unknown>;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asHttpLink(value: unknown): string | null {
  const s = asString(value);
  return s && s.startsWith("http") ? s : null;
}

function sheetUrl(spreadsheetId: unknown): string | null {
  const id = asString(spreadsheetId);
  return id ? `https://docs.google.com/spreadsheets/d/${id}` : null;
}

function slackChannelHint(channelName: unknown, channelId: unknown): string | null {
  const name = asString(channelName);
  if (name) return `#${name.replace(/^#/, "")}`;
  const id = asString(channelId);
  return id ? `channel ${id}` : null;
}

function verificationNote(output: Record<string, unknown>): string | null {
  const verification = output.verification as
    | {
        destination?: { folders?: number; files?: number };
        expectedDestination?: { folders?: number; files?: number };
      }
    | undefined;
  if (!verification?.destination) return null;
  const dest = verification.destination;
  const expected = verification.expectedDestination;
  let note = `Verified ${dest.folders ?? 0} folders / ${dest.files ?? 0} files`;
  if (expected) {
    note += ` (expected ${expected.files ?? 0} files after exclusions)`;
  }
  return note;
}

function dryRunSummary(output: Record<string, unknown>): ProjectSetupStepSummary {
  const title = asString(output.title) ?? "Planned step";
  const planned = (output.planned as Record<string, unknown> | undefined) ?? {};
  const links: ProjectSetupStepLink[] = [];
  const folder = asHttpLink(planned.webViewLink);
  if (folder) links.push({ label: "Open folder", href: folder });
  const sheet = sheetUrl(planned.spreadsheetId);
  if (sheet) links.push({ label: "Open spreadsheet", href: sheet });

  return {
    headline: `${title} (dry-run — not executed)`,
    links,
    notes: [asString(output.note) ?? "No external systems were modified."].filter(Boolean),
    raw: output,
  };
}

export function summarizeProjectSetupStepOutput(
  stepKey: string,
  outputJson: Record<string, unknown> | null | undefined,
): ProjectSetupStepSummary {
  const output = outputJson ?? {};
  if (output.mode === "dry_run") {
    return dryRunSummary(output);
  }

  const links: ProjectSetupStepLink[] = [];
  const notes: string[] = [];

  switch (stepKey) {
    case "allocate_project_number": {
      const num = asString(output.projectNumber) ?? "—";
      const source = asString(output.source);
      return {
        headline: `Allocated project number ${num}`,
        links: sheetUrl(output.spreadsheetId)
          ? [{ label: "Open Master Project Log", href: sheetUrl(output.spreadsheetId)! }]
          : [],
        notes: [
          source === "user_override" ? "Number entered on confirm screen." : null,
          output.reservesNumber === false ? "Dry-run — number not reserved." : null,
        ].filter(Boolean) as string[],
        raw: output,
      };
    }
    case "append_master_log_row": {
      const sheet = sheetUrl(output.spreadsheetId);
      if (sheet) links.push({ label: "Open Master Project Log", href: sheet });
      if (output.alreadyPresent) {
        notes.push("Project number was already in the log — append skipped.");
      }
      return {
        headline: output.alreadyPresent
          ? "Master Project Log already had this project number"
          : "Added row to Master Project Log",
        links,
        notes,
        raw: output,
      };
    }
    case "copy_template_folder": {
      const href = asHttpLink(output.webViewLink);
      if (href) links.push({ label: "Open project folder", href });
      const files = typeof output.copiedFiles === "number" ? output.copiedFiles : null;
      const folders = typeof output.createdFolders === "number" ? output.createdFolders : null;
      const countBits =
        files !== null || folders !== null ? ` (${folders ?? 0} folders, ${files ?? 0} files)` : "";
      const vNote = verificationNote(output);
      if (vNote) notes.push(vNote);
      return {
        headline: `Copied project folder${countBits}`,
        links,
        notes,
        raw: output,
      };
    }
    case "copy_charter_spreadsheet": {
      const href = asHttpLink(output.webViewLink);
      if (href) links.push({ label: "Open project charter", href });
      if (output.alreadyPresent) {
        notes.push("Charter was already in the project folder — copy skipped.");
      }
      return {
        headline: output.alreadyPresent
          ? "Project charter already present"
          : "Copied project charter",
        links,
        notes,
        raw: output,
      };
    }
    case "append_charter_list_row": {
      const sheet = sheetUrl(output.spreadsheetId);
      if (sheet) links.push({ label: "Open Project Charter List", href: sheet });
      const charter = asHttpLink(output.webViewLink);
      if (charter) links.push({ label: "Open charter", href: charter });
      if (output.alreadyPresent) {
        notes.push("Charter was already listed — append skipped.");
      }
      return {
        headline: output.alreadyPresent
          ? "Project Charter List already had this charter"
          : "Added row to Project Charter List",
        links,
        notes,
        raw: output,
      };
    }
    case "create_slack_channel": {
      const channel = slackChannelHint(output.channelName, output.channelId);
      const inviteOk =
        typeof output.inviteSuccessCount === "number" ? output.inviteSuccessCount : null;
      if (inviteOk !== null) {
        notes.push(`Invited ${inviteOk} member${inviteOk === 1 ? "" : "s"}.`);
      }
      if (output.testMode) notes.push("Test-mode invite list was used.");
      return {
        headline: channel ? `Created Slack channel ${channel}` : "Created Slack channel",
        links: [],
        notes,
        raw: output,
      };
    }
    case "post_kickoff_message": {
      const channel = slackChannelHint(
        (output as { channelName?: unknown }).channelName,
        output.channelId,
      );
      if (output.alreadyPresent) {
        notes.push("Kickoff message was already posted — skipped repost.");
      }
      return {
        headline: channel ? `Posted kickoff message in ${channel}` : "Posted kickoff message",
        links: [],
        notes,
        raw: output,
      };
    }
    default: {
      const title = asString(output.title);
      return {
        headline: title ?? "Step finished",
        links: asHttpLink(output.webViewLink)
          ? [{ label: "Open link", href: asHttpLink(output.webViewLink)! }]
          : [],
        notes: asString(output.note) ? [asString(output.note)!] : [],
        raw: output,
      };
    }
  }
}
