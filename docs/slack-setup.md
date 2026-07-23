# Slack setup

## 1. Create a Slack app

1. Open https://api.slack.com/apps
2. Create From Scratch
3. Or paste the manifest below into **App Manifest**

## 2. Manifest (YAML)

```yaml
display_information:
  name: Acton Property Research
  description: Create Acton property research reports from Slack
features:
  bot_user:
    display_name: Acton Property Research
    always_online: false
  slash_commands:
    - command: /property
      url: https://YOUR_VERCEL_DOMAIN/api/slack/commands/property
      description: Research a property address
      usage_hint: "[address]"
      should_escape: false
oauth_config:
  scopes:
    bot:
      - commands
      - chat:write
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

## 3. Install and copy secrets

1. Install to workspace
2. Copy **Signing Secret**
3. Copy **Bot User OAuth Token** (`xoxb-...`)
4. Find Team ID in Slack (workspace settings / API payloads) — starts with `T`

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
SLACK_ALLOWED_TEAM_IDS=T123...
SLACK_REPORT_USER_ID=...
SLACK_COMMAND_NAME=/property
INTERNAL_CRON_SECRET=<long-random>
APP_BASE_URL=https://YOUR_VERCEL_DOMAIN
```

## 6. Local testing

Use a tunnel (Cloudflare Tunnel or ngrok) to your local `/api/slack/commands/property`.

## 7. Production checks

1. `/property 655 13th St, San Jose, CA`
2. Confirm immediate acknowledgment
3. Confirm completion message with report link
4. Confirm opening the link requires Acton login
5. Confirm no PDF is uploaded

## Troubleshooting

| Issue                  | Fix                                                          |
| ---------------------- | ------------------------------------------------------------ |
| invalid_signature      | Signing secret mismatch or raw body altered                  |
| timeout                | Command must acknowledge quickly; research is async via jobs |
| disallowed team        | Add team ID to `SLACK_ALLOWED_TEAM_IDS`                      |
| report never completes | Confirm cron/process-jobs secret and queue rows              |
