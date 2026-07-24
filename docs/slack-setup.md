# Slack setup

Baxter is Acton ADU’s Slack teammate. Property Research remains available via `/property`.

See also: `docs/slack-bot.md` for Events API / conversational Baxter details.

## 1. Create or update the Slack app

1. Open https://api.slack.com/apps
2. Create From Scratch **or** update App Manifest with the YAML below

## 2. Manifest (YAML)

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

Preferred app owner / contact: **baxter@actonadu.com**

## 3. Install and copy secrets

1. Install to workspace
2. Copy **Signing Secret**
3. Copy **Bot User OAuth Token** (`xoxb-...`)
4. Find Team ID (starts with `T`)

## 4. Create Acton integration user

Create a Supabase Auth user for Slack attribution and set:

```bash
SLACK_REPORT_USER_ID=<that-user-uuid>
```

## 5. Environment variables

```bash
ENABLE_SLACK_INTEGRATION=true
SLACK_SIGNING_SECRET=...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=
SLACK_ALLOWED_TEAM_IDS=T123...
SLACK_REPORT_USER_ID=...
SLACK_COMMAND_NAME=/property
INTERNAL_CRON_SECRET=<long-random>
APP_BASE_URL=https://YOUR_VERCEL_DOMAIN
```

## 6. Local testing

Use a tunnel (Cloudflare Tunnel or ngrok) to:

- `/api/slack/events`
- `/api/slack/commands/property`

## 7. Production checks

### Baxter Q&A

1. DM Baxter: `What is our permitting process?`
2. Mention: `@Baxter what happens after feasibility?`
3. Reply in the thread and confirm continuity
4. Confirm Sources include clickable Google links when synced docs were used

### Property Research

1. `/property 655 13th St, San Jose, CA`
2. Confirm immediate acknowledgment
3. Confirm completion message with report link

## Troubleshooting

| Issue             | Fix                                                    |
| ----------------- | ------------------------------------------------------ |
| invalid_signature | Signing secret mismatch or raw body altered            |
| duplicate ignored | Expected for Slack retries                             |
| disallowed team   | Add team ID to `SLACK_ALLOWED_TEAM_IDS`                |
| no answer         | Confirm Events URL, scopes, and `OPENAI_API_KEY`       |
| no Google links   | Sync Google folders first (`/admin/connectors/google`) |
