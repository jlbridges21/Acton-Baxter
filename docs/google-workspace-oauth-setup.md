# Google Workspace OAuth setup (Acton ADU / Baxter)

## Why the service account could not access the Shared Drive

Baxter’s Google Cloud service account:

`baxter@baxter-503419.iam.gserviceaccount.com`

is **outside** the Acton ADU Google Workspace organization. When you try to add it to an Acton Shared Drive, Google reports:

> … is outside of Acton ADU. Only people inside Acton ADU can access files in this shared drive.

Token authentication for that service account can still succeed. That does **not** mean Shared Drive membership works.

**Production fix:** connect Baxter with **Google Workspace OAuth** as an internal user, preferably:

`baxter@actonadu.com`

## Service account vs Workspace OAuth

| Mode                            | Who authenticates       | Shared Drive (internal-only)                     | Use when                                                           |
| ------------------------------- | ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `workspace_oauth` (recommended) | Acton Workspace user    | Works if that user is a member                   | Production Acton ADU                                               |
| `service_account`               | Cloud SA email          | Often blocked as external                        | My Drive folders shared with the SA, or orgs that allow SA members |
| `domain_wide_delegation`        | SA impersonating a user | Can work if Workspace admin fully configured DWD | Only when DWD is verified end-to-end                               |

Set:

```bash
GOOGLE_AUTH_MODE=workspace_oauth
```

## Why use baxter@actonadu.com

- Internal to Acton ADU Workspace
- Can be granted Shared Drive access like any employee
- Baxter allowlists this address by default (`GOOGLE_OAUTH_ALLOWED_EMAILS`)
- Keeps a dedicated bot identity separate from a personal inbox

## Google Cloud project ownership

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Select the project that owns Baxter’s OAuth client (same org as Acton when possible).
3. Note **Project ID** (string) vs **Project number** (numeric). API-disabled errors often show the numeric project number — that can differ from the Project ID string in Vercel (`GOOGLE_PROJECT_ID`).

Prefer a project **inside** the Acton Workspace organization so the OAuth consent screen can use **Internal** user type.

## Enable APIs (do not rely on a broken deep link)

1. Open Google Cloud Console.
2. Select the exact project.
3. Go to **APIs & Services → Library**.
4. Search for **Google Drive API**.
5. Select the result published by **Google Enterprise API**.
6. Click **Enable**.
7. Repeat for **Google Docs API** and **Google Sheets API**.

## OAuth consent screen

Preferred:

- User type: **Internal** (only if the Cloud project is in the Acton org)
- App name: Baxter
- Support email: `baxter@actonadu.com` (or an authorized admin)
- Authorized domain: `actonadu.com`
- Scopes: read-only Drive, Docs, Sheets + basic identity (openid/email/profile)

If Internal is unavailable:

- The project may need to be moved/recreated under the Acton Workspace org, **or**
- Use **External** + Testing mode with `baxter@actonadu.com` as a test user (temporary pilot — not ideal production).

## Create Web application credentials

1. APIs & Services → Credentials → Create credentials → OAuth client ID.
2. Application type: **Web application**.
3. Authorized redirect URI (production):

```text
https://acton-baxter.vercel.app/api/admin/connectors/google/oauth/callback
```

4. For local development, also add:

```text
http://localhost:3000/api/admin/connectors/google/oauth/callback
```

5. Copy Client ID and Client Secret into Vercel (never `NEXT_PUBLIC_`).

## Vercel environment variables

```bash
GOOGLE_AUTH_MODE=workspace_oauth
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://acton-baxter.vercel.app/api/admin/connectors/google/oauth/callback
GOOGLE_OAUTH_ALLOWED_DOMAINS=actonadu.com
GOOGLE_OAUTH_ALLOWED_EMAILS=baxter@actonadu.com
GOOGLE_TOKEN_ENCRYPTION_KEY=...   # see below
```

Optional SA fallback (not required for OAuth mode):

```bash
GOOGLE_PROJECT_ID=
GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_DRIVE_ROOT_FOLDER=
GOOGLE_IMPERSONATED_USER=          # only for verified DWD
```

## Generate GOOGLE_TOKEN_ENCRYPTION_KEY

Refresh tokens are encrypted at rest (AES-256-GCM) before storage in Supabase.

```bash
openssl rand -base64 32
```

Paste the output into Vercel as `GOOGLE_TOKEN_ENCRYPTION_KEY`. Rotate by generating a new key and reconnecting Google (old ciphertext will not decrypt).

## Redeploy and connect

1. Redeploy on Vercel after setting variables.
2. Apply migration `013_google_workspace_oauth.sql` in Supabase.
3. Open `/admin/connectors/google`.
4. Click **Connect Google Workspace**.
5. Sign in as `baxter@actonadu.com`.
6. Approve read-only Drive / Docs / Sheets access.
7. Confirm the page shows **Connected as: baxter@actonadu.com**.

## Shared Drives, roots, files, sync

1. Click **Browse Google Drive** / **List Shared Drives**.
2. Open the Acton Shared Drive → **Connect as root** (no manual ID paste required).
3. Browse folders/files → select → preview → sync.
4. Scheduled sync uses the encrypted refresh token server-side (no browser session).

## Reauthorization and disconnect

- If Google returns `invalid_grant`, status becomes **Reauthorization required**. Click **Reconnect**.
- **Disconnect** revokes the token when possible, deletes the encrypted refresh token, keeps Knowledge entries unless you choose archive.
- Google files are never deleted by Baxter.

## Troubleshooting

| Symptom                  | Likely cause                    | Fix                                                       |
| ------------------------ | ------------------------------- | --------------------------------------------------------- |
| `redirect_uri_mismatch`  | Redirect URI not exact          | Match Vercel URI character-for-character in Cloud Console |
| `access_denied`          | User cancelled or not test user | Approve consent; add test user if External testing        |
| API disabled             | Drive/Docs/Sheets API off       | Enable via Library search (see above)                     |
| Missing refresh token    | Google omitted `refresh_token`  | Reconnect with consent (`prompt=consent`)                 |
| Shared Drive not visible | Wrong account / no membership   | Connect as Workspace member who can see the drive         |
| `invalid_grant`          | Revoked/expired refresh         | Reconnect Google Workspace                                |
| Personal Gmail rejected  | Allowlist                       | Use `baxter@actonadu.com`                                 |

## Scopes (read-only)

- `openid` / `email` / `profile` — identify and display the connected account
- `https://www.googleapis.com/auth/drive.readonly` — browse and export/download
- `https://www.googleapis.com/auth/documents.readonly` — Docs export
- `https://www.googleapis.com/auth/spreadsheets.readonly` — Sheets values

Baxter does **not** request Drive write, sharing changes, Gmail, Calendar, or Workspace admin scopes.
