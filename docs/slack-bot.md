# Baxter Slack bot

## Purpose

Baxter answers Acton employees in Slack using the **same** Knowledge Base retrieval and OpenAI answering service as the web chat.

## Manifest (YAML)

```yaml
display_information:
  name: Baxter
  description: Acton ADU internal AI teammate for approved procedures and property research
features:
  bot_user:
    display_name: Baxter
    always_online: true
  slash_commands:
    - command: /property
      url: https://YOUR_VERCEL_DOMAIN/api/slack/commands/property
      description: Research a property address
      usage_hint: "[address]"
      should_escape: false
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - chat:write
      - commands
      - groups:history
      - im:history
      - im:read
      - im:write
      - mpim:history
settings:
  event_subscriptions:
    request_url: https://YOUR_VERCEL_DOMAIN/api/slack/events
    bot_events:
      - app_mention
      - message.im
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

Identity note: use **baxter@actonadu.com** as the Acton owner contact for the Slack app when possible.

## Setup

1. Create/update the Slack app with the manifest above.
2. Install to the Acton workspace.
3. Copy Signing Secret + Bot Token.
4. Subscribe Events URL to `/api/slack/events` and verify.
5. Create/use a Supabase user UUID for attribution (`SLACK_REPORT_USER_ID`).
6. Set env vars and redeploy.

## Environment

```bash
ENABLE_SLACK_INTEGRATION=true
SLACK_SIGNING_SECRET=...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=   # optional / future socket mode
SLACK_ALLOWED_TEAM_IDS=T...
SLACK_REPORT_USER_ID=<uuid>
SLACK_COMMAND_NAME=/property
```

## Supported behaviors

- DMs to Baxter
- `@Baxter` mentions
- Thread replies (continues conversation via `thread_ts`)
- Clickable Google Doc / Sheet links in Sources
- Insufficient-knowledge responses when KB has no match

## Ignored

- Bot messages / Baxter’s own replies
- Duplicate Slack retries (`slack_processed_events`)
- Disallowed workspaces

## Architecture

`/api/slack/events` → verify signature → dedupe → `answerBaxterQuestion({ channel: "slack" })` → `chat.postMessage`

`/property` slash command remains Property Research only.
