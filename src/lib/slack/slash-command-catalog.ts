/**
 * Registered Slack slash commands — single source of truth for Home / help surfaces.
 * Keep in sync with docs/slack-app-manifest.yaml and src/app/api/slack/commands/<name>/route.ts.
 * Drift is locked by tests/unit/slack-app-home.test.ts.
 */
export type SlackSlashCommand = {
  command: string;
  description: string;
  usageHint: string;
  /** Folder name under src/app/api/slack/commands/ */
  routeSegment: string;
};

export const BAXTER_SLACK_SLASH_COMMANDS: readonly SlackSlashCommand[] = [
  {
    command: "/property",
    description: "Research a property address with Baxter Property Research",
    usageHint: "[address]",
    routeSegment: "property",
  },
  {
    command: "/clear",
    description: "Clear / reset your Baxter conversation",
    usageHint: "",
    routeSegment: "clear",
  },
  {
    command: "/help",
    description: "Show Baxter capabilities and examples",
    usageHint: "",
    routeSegment: "help",
  },
  {
    command: "/recall",
    description: "Search Slack history with Baxter",
    usageHint: "[query]",
    routeSegment: "recall",
  },
  {
    command: "/pem",
    description: "Open Baxter’s Partnership Evaluation Meeting NEAT tool",
    usageHint: "",
    routeSegment: "pem",
  },
  {
    command: "/new-project",
    description: "Start new-project setup from a GoHighLevel customer",
    usageHint: "[customer name]",
    routeSegment: "new-project",
  },
] as const;
