/**
 * Derived project names and Slack channel sanitization.
 */

export function sanitizeLastNameForProject(lastName: string): string {
  return lastName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''`]/g, "")
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Slack channel names: lowercase, digits, hyphens only.
 * Strips other characters; collapses hyphens; truncates to 80 chars.
 */
export function sanitizeSlackChannelSegment(raw: string): string {
  const cleaned = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.slice(0, 80);
}

export function buildDerivedProjectNames(input: { projectNumber: string; lastName: string }): {
  projectLastName: string;
  folderName: string;
  charterName: string;
  slackChannelName: string;
} {
  const projectLastName = sanitizeLastNameForProject(input.lastName) || "Customer";
  const numberPart = input.projectNumber.trim();
  const folderName = `${numberPart} ${projectLastName}`.trim();
  const charterName = `${projectLastName} Project Charter`;
  const slackChannelName = sanitizeSlackChannelSegment(
    `${numberPart.toLowerCase()}-${projectLastName}`,
  );
  return { projectLastName, folderName, charterName, slackChannelName };
}

export function resolveInviteMemberEmails(settings: {
  testMode: boolean;
  memberEmails: string[];
  testMemberEmails: string[];
}): { emails: string[]; testMode: boolean; label: string } {
  if (settings.testMode) {
    const emails = settings.testMemberEmails.length
      ? settings.testMemberEmails
      : ["jackson.bridges@actonadu.com"];
    return {
      emails,
      testMode: true,
      label: `TEST MODE — only ${emails.join(", ")} will be invited`,
    };
  }
  return {
    emails: settings.memberEmails,
    testMode: false,
    label: `${settings.memberEmails.length} standing members will be invited`,
  };
}

export function isActonEmail(email: string): boolean {
  return /^[^\s@]+@actonadu\.com$/i.test(email.trim());
}

export function normalizeEmailList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.map((v) => (typeof v === "string" ? v.trim().toLowerCase() : "")).filter(Boolean),
    ),
  ];
}
