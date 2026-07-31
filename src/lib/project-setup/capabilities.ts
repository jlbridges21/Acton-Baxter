/**
 * Capability gates for later prompts — all false/dry-run today.
 */

/** Prompt 2 will flip this when Drive/Sheets write scopes are live. */
export function googleWritesEnabled(): boolean {
  return false;
}

/** Prompt 3 will flip this when Slack channel provisioning scopes are live. */
export function slackProvisioningEnabled(): boolean {
  return false;
}
