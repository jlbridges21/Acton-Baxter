import "server-only";

/**
 * Placeholder for future Drive push notifications / webhooks.
 * Prompt 4 uses on-demand and job-based sync instead of live watch channels.
 */
export function googleWatchNotConfigured(): {
  enabled: boolean;
  reason: string;
} {
  return {
    enabled: false,
    reason: "Drive watch channels are not enabled yet. Use manual or cron sync.",
  };
}
