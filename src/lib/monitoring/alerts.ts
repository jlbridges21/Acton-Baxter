import "server-only";

import type { MonitoringFinding } from "./types";

/**
 * Format finding alert text for Slack (Baxter voice).
 */
export function formatFindingAlertText(finding: MonitoringFinding): string {
  const lines: string[] = [];

  lines.push(`*${getSeverityEmoji(finding.severity)} ${finding.title}*`);
  lines.push("");

  if (finding.recommendation) {
    lines.push(`${finding.recommendation}`);
    lines.push("");
  }

  const evidence = finding.evidence_json;
  if (evidence && Object.keys(evidence).length > 0) {
    lines.push("*Details:*");
    for (const [key, value] of Object.entries(evidence)) {
      if (value !== null && value !== undefined) {
        const label = formatLabel(key);
        lines.push(`• ${label}: ${formatValue(value)}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Format finding alert blocks for Slack.
 */
export function formatFindingAlertBlocks(
  finding: MonitoringFinding,
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: formatFindingAlertText(finding),
    },
  });

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Finding ID: \`${finding.id}\` | Severity: ${finding.severity} | Check: ${finding.check_key}`,
      },
    ],
  });

  return blocks;
}

/**
 * Format digest summary text for Slack.
 */
export function formatDigestSummaryText(findings: MonitoringFinding[]): string {
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const infoCount = findings.filter((f) => f.severity === "info").length;

  const lines: string[] = [];
  lines.push("*🔍 Baxter Monitoring Digest*");
  lines.push("");
  lines.push(
    `Found ${findings.length} item${findings.length === 1 ? "" : "s"} requiring attention:`,
  );

  if (criticalCount > 0) {
    lines.push(`• ${criticalCount} critical`);
  }
  if (warningCount > 0) {
    lines.push(`• ${warningCount} warning${warningCount === 1 ? "" : "s"}`);
  }
  if (infoCount > 0) {
    lines.push(`• ${infoCount} info`);
  }

  return lines.join("\n");
}

/**
 * Format escalation message text for Slack.
 */
export function formatEscalationText(finding: MonitoringFinding, accountableName?: string): string {
  const lines: string[] = [];

  lines.push(
    `This finding has been open for ${Math.floor((Date.now() - new Date(finding.alerted_at!).getTime()) / 60000)} minutes without acknowledgment.`,
  );

  if (accountableName) {
    lines.push(`cc: ${accountableName}`);
  }

  return lines.join("\n");
}

function getSeverityEmoji(severity: string): string {
  switch (severity) {
    case "critical":
      return "🔴";
    case "warning":
      return "⚠️";
    case "info":
      return "ℹ️";
    default:
      return "•";
  }
}

function formatLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
