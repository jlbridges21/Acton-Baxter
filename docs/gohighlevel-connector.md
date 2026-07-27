# GoHighLevel connector

## Purpose

GoHighLevel (GHL) is Acton ADU's CRM platform. The GHL connector provides Baxter with read access to contacts, opportunities, pipelines, calendars, conversations, and users. With Prompt 2, Baxter can also perform controlled write operations with user confirmation.

**Admin UI:** `/admin/connectors/ghl` (labeled **GoHighLevel**)

**Primary production auth:** Private Integration Token (env var)  
**Optional:** OAuth for multi-location or production service workflows

---

## Prompt 1 vs Prompt 2

| Phase    | Status      | Capabilities                                                              |
| -------- | ----------- | ------------------------------------------------------------------------- |
| Prompt 1 | Complete    | Read-only CRM data access via Baxter Data helpers                         |
| Prompt 2 | **Current** | Read + controlled writes (update contact fields, tags, opportunity stage) |

**In Prompt 2**, Baxter can read CRM data and propose write operations. All writes require user confirmation before execution. See [GoHighLevel Actions](./gohighlevel-actions.md) for details.

---

## Customer data scope

**GoHighLevel contacts and opportunities are customer data and are NOT synced into the Knowledge Base.**

When Baxter needs CRM context, it reads data on-demand using the connector library. This ensures:

- No customer PII in the knowledge_entries table
- No duplicate storage of rapidly-changing CRM records
- Real-time CRM data in Baxter answers

---

## Auth modes

| Mode                            | Description                                                       |
| ------------------------------- | ----------------------------------------------------------------- |
| `private_integration` (default) | Single Private Integration Token for Acton ADU location (env var) |
| `oauth`                         | OAuth app flow with encrypted refresh tokens in database          |

**Recommended for production:** `private_integration` when Acton uses a single GHL location.

---

## Setup (Private Integration — recommended)

1. In GoHighLevel, navigate to **Settings → Integrations → Private Integrations**.
2. Create a new Private Integration with required scopes (see **Scopes** below).
3. Copy the Private Integration Token.
4. Apply Supabase migration `supabase/migrations/022_ghl_connector.sql` (or latest GHL migration).
5. Set Vercel environment variables:
   ```bash
   ENABLE_GHL_INTEGRATION=true
   GHL_AUTH_MODE=private_integration
   GHL_PRIVATE_INTEGRATION_TOKEN=pit-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   GHL_LOCATION_ID=qNX7FpOJSulgRgBJC5cE
   ```
6. Redeploy.
7. Verify: Admin → Connectors → GoHighLevel → **Test Connection**.

---

## Setup (OAuth — optional)

1. In GoHighLevel, create an OAuth app with required scopes.
2. Note Client ID, Client Secret, and Redirect URI.
3. Apply Supabase migration `supabase/migrations/022_ghl_connector.sql`.
4. Set Vercel environment variables:
   ```bash
   ENABLE_GHL_INTEGRATION=true
   GHL_AUTH_MODE=oauth
   GHL_CLIENT_ID=your-client-id
   GHL_CLIENT_SECRET=your-client-secret
   GHL_REDIRECT_URI=https://acton-baxter.vercel.app/api/admin/connectors/ghl/oauth/callback
   GHL_TOKEN_ENCRYPTION_KEY=your-32-byte-base64-key
   GHL_LOCATION_ID=qNX7FpOJSulgRgBJC5cE
   ```
5. Redeploy.
6. Admin → Connectors → GoHighLevel → **Connect GoHighLevel**.
7. Authorize the OAuth app in GoHighLevel.
8. Verify: Test Connection.

---

## Scopes

### Required scopes (Prompt 1 read operations)

- `contacts.readonly`
- `opportunities.readonly`
- `pipelines.readonly`
- `users.readonly`

### Optional scopes (enhanced Prompt 1 features)

- `businesses.readonly` — Company/location profiles
- `calendars.readonly`, `calendars/events.readonly`, `calendars/groups.readonly` — Calendar access
- `conversations.readonly`, `conversations/message.readonly` — Conversation history
- `locations/customFields.readonly`, `locations/tags.readonly` — Custom field and tag mapping
- `phonenumbers.read` — Location phone numbers
- `documents_contracts/list.readonly` — Documents/contracts metadata
- `voice-ai-dashboard.readonly`, `voice-ai-agents.readonly` — Voice AI context
- `knowledge-bases.readonly` — HighLevel knowledge-base assets (separate from Baxter KB)

### Write scopes (Prompt 2 future — not exposed in Prompt 1)

- `contacts.write` — Create/update contacts
- `opportunities.write` — Create/update opportunities
- `locations/customFields.write` — Manage custom fields

**Important:** Write scopes can be granted now but are NOT exposed to Baxter conversations in Prompt 1.

---

## API version and base URL

| Variable           | Default                                | Notes                       |
| ------------------ | -------------------------------------- | --------------------------- |
| `GHL_API_BASE_URL` | `https://services.leadconnectorhq.com` | GoHighLevel API v2 base URL |

All GHL API requests include `Version: 2021-07-28` header.

---

## Environment variables

### Core configuration

| Variable                 | Required | Default                                | Description                                 |
| ------------------------ | -------- | -------------------------------------- | ------------------------------------------- |
| `ENABLE_GHL_INTEGRATION` | Yes      | `false`                                | Enable GoHighLevel connector                |
| `GHL_AUTH_MODE`          | No       | `private_integration`                  | Auth mode: `private_integration` or `oauth` |
| `GHL_LOCATION_ID`        | Yes      | —                                      | Acton ADU GHL location ID                   |
| `GHL_API_BASE_URL`       | No       | `https://services.leadconnectorhq.com` | GHL API base URL                            |

### Private Integration auth

| Variable                        | Required (PIT) | Description               |
| ------------------------------- | -------------- | ------------------------- |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | Yes            | Private Integration Token |

### OAuth auth

| Variable                   | Required (OAuth) | Description                                                                     |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| `GHL_CLIENT_ID`            | Yes              | OAuth app client ID                                                             |
| `GHL_CLIENT_SECRET`        | Yes              | OAuth app client secret                                                         |
| `GHL_REDIRECT_URI`         | Yes              | OAuth callback URL                                                              |
| `GHL_TOKEN_ENCRYPTION_KEY` | Yes*             | 32-byte encryption key for tokens (falls back to `GOOGLE_TOKEN_ENCRYPTION_KEY`) |

### Optional

| Variable              | Default | Description                    |
| --------------------- | ------- | ------------------------------ |
| `GHL_EXPECTED_SCOPES` | (auto)  | Comma-separated scope override |

---

## Connection process

### Private Integration

1. Admin → Connectors → GoHighLevel
2. If configured: status shows "Private Integration configured: Yes"
3. Click **Test Connection** to verify
4. Private Integration connections are marked as connected automatically when token is valid

### OAuth

1. Admin → Connectors → GoHighLevel → **Connect GoHighLevel**
2. Authorize the OAuth app in GoHighLevel
3. Tokens are encrypted and stored in `ghl_connections` table
4. Refresh tokens are used to keep access alive
5. **Reconnect** or **Disconnect** as needed

---

## Reference cache

GHL API responses for relatively static resources (pipelines, custom fields, tags, users, calendars, phone numbers) are cached in `ghl_reference_cache` to reduce API calls.

Default TTLs:

- Pipelines: 6 hours
- Custom fields: 6 hours
- Tags: 3 hours
- Users: 1 hour
- Calendars: 3 hours
- Phone numbers: 6 hours

Admin can **Clear All Cache** or clear individual resource types at `/admin/connectors/ghl` → Advanced tab.

---

## Troubleshooting

### Common errors

| Code                                | Meaning                               | Fix                                                                         |
| ----------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| `BAXTER_GHL_DISABLED`               | GHL integration is disabled           | Set `ENABLE_GHL_INTEGRATION=true`                                           |
| `BAXTER_GHL_NOT_CONFIGURED`         | Missing required env vars             | Set `GHL_PRIVATE_INTEGRATION_TOKEN` + `GHL_LOCATION_ID` (PIT) or OAuth vars |
| `BAXTER_GHL_AUTH_FAILED`            | Authentication failed (invalid token) | Verify token is valid and not expired                                       |
| `BAXTER_GHL_TOKEN_EXPIRED`          | Token has expired                     | For OAuth: reconnect. For PIT: regenerate token in GHL                      |
| `BAXTER_GHL_LOCATION_INVALID`       | Location ID invalid or not found      | Verify `GHL_LOCATION_ID` matches token's location                           |
| `BAXTER_GHL_LOCATION_ACCESS_DENIED` | Missing `locations.readonly` scope    | Optional for PIT. Add scope or ignore (contacts/opportunities still work)   |
| `BAXTER_GHL_SCOPE_MISSING`          | Required scope not granted            | Edit PIT in GHL → Add missing scopes. No need to regenerate token           |
| `BAXTER_GHL_REAUTH_REQUIRED`        | OAuth token expired or revoked        | Reconnect GoHighLevel in Admin → Connectors                                 |
| `BAXTER_GHL_PERMISSION_DENIED`      | Permission denied for resource        | Check PIT scopes or user role                                               |
| `BAXTER_GHL_API_UNAVAILABLE`        | GHL API unreachable or rate limited   | Retry later; check GHL API status                                           |
| `BAXTER_GHL_STALE_STATE`            | Resource changed since proposal       | Refresh and propose the action again                                        |
| `BAXTER_GHL_ACTION_EXPIRED`         | Pending action confirmation expired   | Actions expire after 10 minutes; propose again                              |
| `BAXTER_GHL_WRITE_DISABLED`         | Write operations are disabled         | Contact admin to enable GHL writes                                          |

### PIT Scope Issues (Prompt 2)

If you see `BAXTER_GHL_SCOPE_MISSING` or `BAXTER_GHL_LOCATION_ACCESS_DENIED`:

1. **Do NOT regenerate the token** unless it's truly invalid
2. Go to GHL → Settings → Integrations → Private Integrations
3. Edit your Private Integration and add the missing scopes
4. Save — the existing token will gain the new permissions
5. Test connection in Admin → Connectors → GoHighLevel

**Note:** `locations.readonly` is optional for PIT mode. Baxter can access contacts, opportunities, and pipelines without it. Location name enrichment will be skipped.

### Diagnostics

Admin → Connectors → GoHighLevel → Advanced tab:

- Health checks (authentication, location, contacts, pipelines, opportunities, calendars, conversations)
- Cache status (last fetched, expired)
- Connection history
- Missing scopes
- Configuration guidance

---

## Prompt 2 — live CRM + controlled writes

Prompt 2 keeps GHL **out of** permanent Knowledge Base embeddings. Live CRM answers use on-demand retrieval.

| Capability | Behavior |
| ---------- | -------- |
| Live reads | Contacts, opportunities, pipelines/stages, owners, custom fields, tags, calendars, conversations when scopes allow |
| Hybrid answers | GHL current state + approved Knowledge process (e.g. “what happens next for Lori?”) |
| Writes | Contacts + opportunities only, after explicit confirmation (see `docs/gohighlevel-actions.md`) |
| Capability matrix | Core CRM success → Connected; optional missing scopes → Connected with limited capabilities |

**Do not sync** customer messages / contact / opportunity state into `knowledge_units`.

---

## Prompt 3 (deferred)

- Autonomous monitoring / proactive workflows
- Multi-step write chains
- Message sending / calendar booking / Voice AI mutation

---

## Migration

Apply in order:

1. `supabase/migrations/020_ghl_connector.sql` — connections, OAuth state, reference cache, `ghl_action_audit`
2. `supabase/migrations/021_ghl_pending_actions.sql` — pending write confirmations + audit extensions

---

## Security notes

- Private Integration Tokens are **never** returned to the browser
- OAuth refresh tokens are **encrypted at rest** in `ghl_connections`
- Tokens never appear in admin overview JSON responses
- Admin API routes are protected with `requireAdmin()`
- API scopes ≠ Baxter user write permission ≠ confirmation — all three must pass for writes

---

## See also

- [GoHighLevel Actions](./gohighlevel-actions.md) — confirmation, allowlists, audit
- [Baxter Evaluations](./baxter-evaluations.md) — GHL connector tests in evaluations suite
- [Production Checklist](./production-checklist.md) — GHL deployment checklist
- [Baxter AI Architecture](./baxter-ai-architecture.md) — Prompt governance and limitations
