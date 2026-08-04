/**
 * After GHL resolves a contact for a project-flavored question, optionally append
 * recent Slack activity from the linked Project Setup channel.
 *
 * Never searches Slack unless the requester has connected Slack Search.
 * Failures never erase the GHL answer.
 */

import "server-only";

import {
  listProjectSetupRunsForGhlContact,
  pickPreferredCompleteRunWithSlackChannel,
  type ProjectSetupForContactDeps,
} from "@/lib/dossier/project-setup-for-contact";
import { getSlackSearchConnectionMetadata } from "@/lib/baxter-data/slack/connections";
import { retrieveSlackEvidence } from "@/lib/baxter-data/slack/evidence";
import { formatSlackEvidenceExcerpt } from "@/lib/baxter-data/slack/format";
import { isSlackSearchEnabled } from "@/lib/baxter-data/slack/config";
import { SLACK_SEARCH_ERROR_CODES } from "@/lib/baxter-data/slack/errors";
import { defaultLimitForIntent, defaultSortForIntent } from "@/lib/baxter-data/slack/intent";
import type {
  ResolvedSlackChannel,
  SlackQueryPlan,
  SlackRequester,
  SlackSearchDeps,
} from "@/lib/baxter-data/slack/types";
import { isBroadGhlEntityInfoQuestion } from "@/lib/connectors/ghl/address";
import { isProjectInformationQuestion } from "@/lib/baxter-data/slack/project-status";

const SLACK_ENRICH_TIMEOUT_MS = 5_000;
const CONNECT_NOTE =
  "Connect Slack Search in Settings → Integrations to see recent channel activity here too.";

export function isProjectFlavoredGhlQuestion(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (/\bprojects?\b/i.test(q)) return true;
  if (isProjectInformationQuestion(q)) return true;
  // Broad info asks that also name opportunity/deal (same customer-info class).
  return isBroadGhlEntityInfoQuestion(q) && /\b(opportunity|deal)\b/i.test(q);
}

function channelLabel(name: string | null | undefined, id: string | null | undefined): string {
  const n = name?.replace(/^#/, "").trim();
  if (n) return `#${n}`;
  if (id?.trim()) return `#${id.trim()}`;
  return "the project Slack channel";
}

function buildChannelScopedPlan(input: {
  channelId: string | null;
  channelName: string | null;
  teamId: string;
  question: string;
}): SlackQueryPlan {
  const name = (input.channelName ?? "").replace(/^#/, "").trim() || "project-channel";
  const id = (input.channelId ?? "").trim() || name;
  const channel: ResolvedSlackChannel = {
    id,
    name,
    displayLabel: `#${name}`,
    teamId: input.teamId,
    kind: "public_channel",
    isPrivate: false,
    isMember: true,
    isArchived: false,
  };
  const intent = "latest_update";
  return {
    intent,
    people: [],
    channels: [channel],
    keywords: [],
    phrases: [],
    decisionLanguage: [],
    timeRange: null,
    sort: defaultSortForIntent(intent),
    limit: defaultLimitForIntent(intent),
    includeThreads: true,
    includeNearbyContext: true,
    naturalQuery: input.question,
  };
}

function formatRecentActivitySection(
  channelDisplay: string,
  excerpts: Array<{ author: string; excerpt: string; timestamp: string }>,
): string {
  const lines = ["", `Recent activity in ${channelDisplay}:`];
  if (excerpts.length === 0) {
    lines.push("• No recent messages found in that channel.");
    return lines.join("\n");
  }
  for (const row of excerpts.slice(0, 4)) {
    const when = row.timestamp ? ` (${row.timestamp.slice(0, 10)})` : "";
    lines.push(`• ${row.author}${when}: ${row.excerpt}`);
  }
  return lines.join("\n");
}

export type AppendProjectSlackActivityDeps = ProjectSetupForContactDeps & {
  getSlackConnection?: typeof getSlackSearchConnectionMetadata;
  retrieveSlack?: typeof retrieveSlackEvidence;
  slackSearchEnabled?: () => boolean;
  slackDeps?: SlackSearchDeps;
  now?: () => Date;
};

/**
 * Returns the GHL answer unchanged, or with a Slack connect note / recent activity block.
 */
export async function appendProjectSlackActivityToGhlAnswer(input: {
  ghlAnswer: string;
  question: string;
  ghlContactId: string;
  requester: SlackRequester;
  deps?: AppendProjectSlackActivityDeps;
}): Promise<string> {
  const base = input.ghlAnswer.trim();
  if (!base || !input.ghlContactId.trim()) return input.ghlAnswer;
  if (!isProjectFlavoredGhlQuestion(input.question)) return input.ghlAnswer;

  try {
    const enrichPromise = (async (): Promise<string> => {
      const runs = await listProjectSetupRunsForGhlContact(input.ghlContactId, input.deps);
      const preferred = pickPreferredCompleteRunWithSlackChannel(runs);
      if (!preferred) return input.ghlAnswer;

      const channelDisplay = channelLabel(preferred.slackChannelName, preferred.slackChannelId);
      const slackEnabled = (input.deps?.slackSearchEnabled ?? isSlackSearchEnabled)();
      const getConnection = input.deps?.getSlackConnection ?? getSlackSearchConnectionMetadata;

      const baxterUserId = input.requester.baxterUserId?.trim() || null;
      if (!slackEnabled || !baxterUserId) {
        return `${base}\n\n• ${CONNECT_NOTE}`;
      }

      const connection = await getConnection(baxterUserId).catch(() => null);
      if (!connection?.linked) {
        return `${base}\n\n• ${CONNECT_NOTE}`;
      }

      const requester: SlackRequester = {
        ...input.requester,
        baxterUserId,
        slackUserId: input.requester.slackUserId ?? connection.slackUserId,
        slackTeamId: input.requester.slackTeamId ?? connection.slackTeamId,
      };

      const teamId = requester.slackTeamId?.trim() || connection.slackTeamId || "";
      const scopedQuestion = `What is the latest update in ${channelDisplay}?`;
      const plan = buildChannelScopedPlan({
        channelId: preferred.slackChannelId,
        channelName: preferred.slackChannelName,
        teamId,
        question: scopedQuestion,
      });

      const retrieve = input.deps?.retrieveSlack ?? retrieveSlackEvidence;
      const result = await retrieve({
        requester,
        question: scopedQuestion,
        plan,
        deps: input.deps?.slackDeps,
      });

      if (result.incomplete?.code) {
        const code = result.incomplete.code;
        if (
          code === SLACK_SEARCH_ERROR_CODES.AUTH_REQUIRED ||
          code === SLACK_SEARCH_ERROR_CODES.USER_NOT_LINKED ||
          code === SLACK_SEARCH_ERROR_CODES.SCOPE_MISSING ||
          /not.?connect|authoriz|oauth|Settings → Integrations/i.test(result.incomplete.message)
        ) {
          return `${base}\n\n• ${CONNECT_NOTE}`;
        }
        return input.ghlAnswer;
      }

      const sorted = [...result.results].sort((a, b) =>
        String(b.timestamp ?? b.messageTs).localeCompare(String(a.timestamp ?? a.messageTs)),
      );
      const excerpts = sorted.slice(0, 4).map((m) => {
        const formatted = formatSlackEvidenceExcerpt(m, 140);
        return {
          author: formatted.author,
          excerpt: formatted.excerpt,
          timestamp: formatted.timestamp,
        };
      });

      return `${base}${formatRecentActivitySection(channelDisplay, excerpts)}`;
    })();

    const raced = await Promise.race([
      enrichPromise,
      new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), SLACK_ENRICH_TIMEOUT_MS);
      }),
    ]);
    return raced === "timeout" ? input.ghlAnswer : raced;
  } catch {
    return input.ghlAnswer;
  }
}

export const PROJECT_SLACK_CONNECT_NOTE = CONNECT_NOTE;
