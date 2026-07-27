# GoHighLevel connector

## Purpose

GoHighLevel (GHL) is Acton ADU's CRM platform. The GHL connector provides Baxter with read-only access to contacts, opportunities, pipelines, calendars, conversations, and users.

**Admin UI:** `/admin/connectors/ghl` (labeled **GoHighLevel**)

**Primary production auth:** Private Integration Token (env var)  
**Optional:** OAuth for multi-location or production service workflows

---

## Prompt 1 vs Prompt 2

| Phase    | Status      | Capabilities                                                         |
| -------- | ----------- | -------------------------------------------------------------------- |
| Prompt 1 | **Current** | Read-only CRM data access via Baxter Data helpers (no LLM tools yet) |
| Prompt 2 | Future      | Write tools exposed to LLM (update contacts, create opportunities)   |

**In Prompt 1**, Baxter can read CRM data when staff ask questions, but cannot autonomously update records. Write scopes may be granted now for future Prompt 2, but they are NOT exposed to Baxter conversations.

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

| Code                          | Meaning                               | Fix                                                                         |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| `BAXTER_GHL_DISABLED`         | GHL integration is disabled           | Set `ENABLE_GHL_INTEGRATION=true`                                           |
| `BAXTER_GHL_NOT_CONFIGURED`   | Missing required env vars             | Set `GHL_PRIVATE_INTEGRATION_TOKEN` + `GHL_LOCATION_ID` (PIT) or OAuth vars |
| `BAXTER_GHL_AUTH_FAILED`      | Authentication failed (invalid token) | Verify token is valid and not expired                                       |
| `BAXTER_GHL_LOCATION_INVALID` | Location ID invalid or no access      | Verify `GHL_LOCATION_ID` matches token's location                           |
| `BAXTER_GHL_REAUTH_REQUIRED`  | OAuth token expired or revoked        | Reconnect GoHighLevel in Admin → Connectors                                 |
| `BAXTER_GHL_SCOPE_MISSING`    | Required scope not granted            | Reconnect OAuth with required scopes                                        |
| `BAXTER_GHL_API_UNAVAILABLE`  | GHL API unreachable or rate limited   | Retry later; check GHL API status                                           |

### Diagnostics

Admin → Connectors → GoHighLevel → Advanced tab:

- Health checks (authentication, location, contacts, pipelines, opportunities, calendars, conversations)
- Cache status (last fetched, expired)
- Connection history
- Missing scopes
- Configuration guidance

---

## Read-only Prompt 1 enforcement

- No write tools exposed to LLM in Prompt 1
- Baxter Data helpers (`@/lib/baxter-data/ghl/*`) only export read functions
- Write scopes may be granted for future Prompt 2, but are not used
- Access policy enforces admin vs employee permissions (all GHL data read is admin-gated today)

---

## Prompt 2 roadmap

Future enhancements (not in Prompt 1):

- Expose write tools to LLM (create/update contacts, opportunities)
- Sync CRM data into Knowledge Base for offline retrieval (optional)
- Employee-scoped CRM read access (contacts assigned to employee)
- Automated CRM updates based on Baxter conversations (with human approval)

---

## Migration

Apply `supabase/migrations/022_ghl_connector.sql` (or latest GHL migration) to create:

- `ghl_connections` — OAuth connection rows (encrypted tokens)
- `ghl_oauth_states` — OAuth state CSRF protection
- `ghl_reference_cache` — Cached reference data (pipelines, users, etc.)

---

## Security notes

- Private Integration Tokens are **never** returned to the browser
- OAuth refresh tokens are **encrypted at rest** in `ghl_connections`
- Tokens never appear in admin overview JSON responses
- Admin API routes are protected with `requireAdmin()`
- GHL data access is admin-only in Prompt 1 (no employee access yet)

---

## See also

- [Baxter Evaluations](./baxter-evaluations.md) — GHL connector tests in evaluations suite
- [Production Checklist](./production-checklist.md) — GHL deployment checklist
- [Baxter AI Architecture](./baxter-ai-architecture.md) — Prompt governance and limitations
