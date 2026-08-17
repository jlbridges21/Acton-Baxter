/**
 * Pure App Home Block Kit builder. Keep this import graph light — no connectors,
 * answer pipeline, or capability-registry (those are loaded later in app-home.ts).
 */

import { BAXTER_SLACK_SLASH_COMMANDS } from "./slash-command-catalog";

export type SlackHomeBlock = Record<string, unknown>;

export type HomeCapabilityGroup = {
  heading: string;
  lines: string[];
};

export type SlackSearchHomeStatus = "connected" | "disconnected";

export type BuildAppHomeViewInput = {
  webAppUrl: string;
  integrationsUrl: string;
  capabilityGroups?: HomeCapabilityGroup[] | null;
  slackSearch?: SlackSearchHomeStatus | null;
  slashCommands?: readonly { command: string; description: string }[];
};

export type AppHomeOpenedLike = {
  type?: string;
  user?: string;
  tab?: string;
  bot_id?: string;
};

/** True when this event should publish (or refresh) the Home tab. */
export function isAppHomeOpenedEvent(event: AppHomeOpenedLike | null | undefined): boolean {
  if (!event || event.type !== "app_home_opened") return false;
  if (event.bot_id) return false;
  // Messages tab of App Home is the DM thread — do not republish Home views.
  if (event.tab === "messages") return false;
  return Boolean(event.user);
}

function section(text: string, accessory?: Record<string, unknown>): SlackHomeBlock {
  const block: SlackHomeBlock = {
    type: "section",
    text: { type: "mrkdwn", text },
  };
  if (accessory) block.accessory = accessory;
  return block;
}

function header(text: string): SlackHomeBlock {
  return {
    type: "header",
    text: { type: "plain_text", text, emoji: true },
  };
}

function divider(): SlackHomeBlock {
  return { type: "divider" };
}

function context(text: string): SlackHomeBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text }],
  };
}

function actionsButton(input: {
  text: string;
  url: string;
  actionId: string;
  style?: "primary" | "danger";
}): SlackHomeBlock {
  return {
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: input.text, emoji: true },
        url: input.url,
        action_id: input.actionId,
        ...(input.style ? { style: input.style } : {}),
      },
    ],
  };
}

function linkButton(input: {
  text: string;
  url: string;
  actionId: string;
  style?: "primary" | "danger";
}): Record<string, unknown> {
  return {
    type: "button",
    text: { type: "plain_text", text: input.text, emoji: true },
    url: input.url,
    action_id: input.actionId,
    ...(input.style ? { style: input.style } : {}),
  };
}

function formatSlashCommands(
  commands: readonly { command: string; description: string }[],
): string {
  return commands
    .map((c) => {
      const desc = c.description.trim();
      return desc ? `• \`${c.command}\` — ${desc}` : `• \`${c.command}\``;
    })
    .join("\n");
}

function formatCapabilityGroups(groups: HomeCapabilityGroup[]): string {
  return groups
    .filter((g) => g.lines.length > 0)
    .map((g) => `*${g.heading}*\n${g.lines.map((line) => `• ${line}`).join("\n")}`)
    .join("\n\n");
}

/**
 * Build the Home tab view payload (`type: home` + blocks).
 * Omitted optional sections stay off the view rather than showing errors.
 */
export function buildAppHomeView(input: BuildAppHomeViewInput): {
  type: "home";
  blocks: SlackHomeBlock[];
} {
  const commands = input.slashCommands ?? BAXTER_SLACK_SLASH_COMMANDS;
  const blocks: SlackHomeBlock[] = [
    header("Baxter"),
    section(
      "*Acton ADU’s internal AI teammate.* Ask about approved company knowledge, PEM NEATs, CRM, property research, project setup, and Slack discussions.",
    ),
    section(
      [
        "*How to use Baxter in Slack*",
        "• *DM* Baxter directly — no @mention needed",
        "• *@mention* Baxter in a channel to start (or continue) a thread",
        "• Slash commands:",
        formatSlashCommands(commands),
      ].join("\n"),
    ),
  ];

  const capabilityGroups = input.capabilityGroups?.filter((g) => g.lines.length > 0) ?? [];
  if (capabilityGroups.length > 0) {
    blocks.push(divider());
    blocks.push(header("What Baxter can currently do"));
    const combined = formatCapabilityGroups(capabilityGroups);
    if (combined.length <= 2900) {
      blocks.push(section(combined));
    } else {
      for (const group of capabilityGroups) {
        blocks.push(section(formatCapabilityGroups([group])));
      }
    }
  }

  if (input.slackSearch === "connected") {
    blocks.push(divider());
    blocks.push(
      section(
        ":white_check_mark: *Slack Search is connected*\nBaxter can include Slack conversations you’re authorized to see when you ask about recent discussions.",
      ),
    );
  } else if (input.slackSearch === "disconnected") {
    blocks.push(divider());
    blocks.push(
      section(
        ":electric_plug: *Connect Slack Search*\nSeveral Baxter answers use Slack history (channel updates, “what did they say,” `/recall`). Connect your account so you get full results instead of a mid-answer prompt to connect.",
        linkButton({
          text: "Connect Slack Search",
          url: input.integrationsUrl,
          actionId: "app_home_connect_slack_search",
          style: "primary",
        }),
      ),
    );
  }

  blocks.push(divider());
  blocks.push(
    section(
      `Open the Baxter web app for PEM NEATs, Property Research, Project Setup, and integrations.`,
    ),
  );
  blocks.push(
    actionsButton({
      text: "Open Baxter",
      url: input.webAppUrl,
      actionId: "app_home_open_webapp",
    }),
  );
  blocks.push(context(`Settings → Integrations: ${input.integrationsUrl}`));

  return { type: "home", blocks };
}
