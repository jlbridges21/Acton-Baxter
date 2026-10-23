# BambooHR integration

BambooHR is the authoritative source of employee records. Baxter connects to it **read-only**, through the BambooHR developer application named **Baxter** using OAuth 2.0. Sam and the **Sam Operations → Employees (BambooHR)** tab use this connection.

- Every value that comes from BambooHR is labelled with its source and freshness.
- Baxter stores no employee records. It stores only the connection, encrypted tokens, and links between Baxter accounts and BambooHR employees.
- Writes to BambooHR are turned off.

## Connect the developer application

1. In the **BambooHR Developer Portal**, open the **Baxter** app. Register this redirect URI exactly (same scheme, no trailing slash):

   ```
   https://acton-baxter.vercel.app/api/integrations/bamboohr/oauth/callback
   ```

   The app derives it from `APP_BASE_URL`. If you set `BAMBOOHR_REDIRECT_URI` instead, it must match the portal entry exactly. **Sam Operations → Integrations → BambooHR** shows the value the app is using.

2. Allow these scopes on the app:
   - **Always requested:** `openid` `email` `company_id` `offline_access` `company:info` `employee:name` `employee:job` `employee:contact` `employee_directory` `field`
   - **Only if wanted:** `employee:custom_fields`, `employee:file`, `onboarding`
3. In Vercel, set these server-side environment variables, then redeploy:

   | Variable                  | Value                               |
   | ------------------------- | ----------------------------------- |
   | `BAMBOOHR_CLIENT_ID`      | OAuth client ID from the portal     |
   | `BAMBOOHR_CLIENT_SECRET`  | OAuth client secret from the portal |
   | `BAMBOOHR_COMPANY_DOMAIN` | The part before `.bamboohr.com`     |
   | `BAMBOOHR_REDIRECT_URI`   | Optional; see step 1                |

   Tokens are encrypted with the existing `GOOGLE_TOKEN_ENCRYPTION_KEY`, so no new key is needed. The application key and personal API keys are **not** used.

4. Apply migration `072_bamboohr_integration.sql` (with authorization).
5. The **COO** signs in to Baxter and opens **Sam Operations → Integrations → BambooHR**. Tick any optional permissions, select **Connect BambooHR**, and approve in BambooHR.
   - Only the COO can connect, change permissions, refresh, or disconnect, because the COO controls system access.
   - If no COO is confirmed yet, the CEO can do it.
6. Select **Test & diagnose**. Each capability is marked _Working_ only if a safe read request actually succeeds.
7. Under **Identity links**, select **Suggest from work emails**, then confirm each suggestion (or link someone manually by employee id).

## What was verified in BambooHR's documentation

| Purpose                  | Endpoint                                                                                                                  | Scope(s)                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Authorize                | `https://{domain}.bamboohr.com/authorize.php?request=authorize&state&response_type=code&scope=a+b&client_id&redirect_uri` | —                                                       |
| Token, and refresh token | `POST https://{domain}.bamboohr.com/token.php?request=token`                                                              | `offline_access` is required to receive a refresh token |
| Who connected            | `https://{domain}.bamboohr.com/token.php?request=userInfo` (`sub`, `email`, `company_id`)                                 | `openid email company_id`                               |
| Company                  | `GET /api/v1/company_information`                                                                                         | `company:info`                                          |
| Employees (cursor pages) | `GET /api/v1/employees?fields&filter[..]&page[limit\|after]`                                                              | `employee:name`, `employee:job`, …                      |
| One employee             | `GET /api/v1/employees/{id}?fields=…`                                                                                     | `employee:job`, `employee:contact`, …                   |
| Directory                | `GET /api/v1/employees/directory`                                                                                         | `employee_directory`                                    |
| Field list               | `GET /api/v1/meta/fields`                                                                                                 | `field`                                                 |
| File list (metadata)     | `GET /api/v1/employees/{id}/files/view`                                                                                   | `employee:file`                                         |
| Onboarding status        | `GET /api/v1/employees/{id}/onboarding-experiences`                                                                       | `onboarding`                                            |

Behaviour documented by BambooHR that Baxter handles:

- `GET /employees/{id}` silently drops fields that are unknown or unauthorized. Baxter therefore reports "_N_ fields weren't returned (empty or restricted)" and never guesses which.
- A `403` there means the whole record is restricted.
- `list-employees` returns restricted values as `null` and lists them in `_restrictedFields`.
- Access tokens last one hour (`expires_in: 3600`).
- BambooHR documents no token-revocation endpoint. **Disconnect** deletes Baxter's tokens; remove the app in BambooHR as well if you want to revoke it there.
- **Surveys:** no public API exists to create, send, or read surveys or eNPS results. This was checked against the API reference; surveys stay manual.
- **Deep links:** BambooHR documents no deep link to an employee page, so Baxter links to its own employee view instead of guessing a URL.

Pagination, rate limits, and the absence of a revocation endpoint are not fully documented. Baxter retries `429` and `5xx` responses with backoff, honouring `Retry-After`.

## Fields Baxter reads

| Group        | Fields                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Name         | `displayName`, `firstName`, `lastName`, `preferredName`                                                                          |
| Job          | `jobTitle`, `department`, `division`, `location`, `supervisor`, `supervisorEId`, `hireDate`, `status`, `employmentHistoryStatus` |
| Work contact | `workEmail`, `workPhone`, `workPhoneExtension`                                                                                   |
| Custom       | Only fields the COO allow-lists, and never anything that looks sensitive                                                         |

Never read: pay and compensation, SSN, SIN and other IDs, birth date, age, gender and demographics, home or mobile contact details, address, dependents, emergency contacts, medical or vaccination data, and termination details. These fields are never requested. If BambooHR returns one anyway, Baxter drops it. Run **Test & diagnose** after connecting to see which fields your BambooHR permissions actually return.

## Who sees what

| Person                       | BambooHR access through Baxter                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| CEO, COO, HR administrators  | Search employees. Read the fields above for anyone. Read onboarding status and file names (when those scopes are granted) |
| Any other employee           | Their **own** record only, once HR has confirmed their identity link. Standard fields only                                |
| Unlinked or unverified users | Nothing                                                                                                                   |
| Connection management        | COO (or the CEO if no COO is confirmed; an app admin only before leadership is confirmed)                                 |

- Baxter delegation keeps the original employee's identity. Asking through Baxter never grants CEO or COO access.
- Every read is written to the audit log (who, which employee, which sections). The data itself is never logged.

## How Sam uses BambooHR

Sam has six read-only tools:

- `bamboohr_capabilities`
- `bamboohr_find_employee`
- `bamboohr_employee_profile`
- `bamboohr_onboarding_status`
- `bamboohr_documents`
- `bamboohr_fields`

Each tool:

- checks the requester's access on the server;
- asks only for the sections a question needs;
- marks the returned values as untrusted data;
- returns a plain "restricted" or "not linked" message instead of guessing.

Sam's instructions say BambooHR is authoritative, that Sam should ask which employee is meant when several match, and that Sam can't change records. Baxter's delegation guidance and Sam's keywords send employee-record questions to Sam, for example "Who is my manager?" or "What is Jordan's start date?".

## Source attribution

Attribution happens in the data layer, not in model text:

- **Provenance on every value.** Each value from BambooHR is wrapped with: provider, record type, record id, field ids, retrieval time, the connection's last confirmation, `live`/`cached`/`unavailable` status, and an access classification.
- **Attached by the platform, not the model.** When a tool returns BambooHR data, the platform (`finalizeResult`) attaches a BambooHR source to Sam's answer, even if the model didn't cite it. Sources from other systems are never labelled as BambooHR.
- **One badge everywhere.** The shared `SourceBadge` and `SourceFootnote` components (`src/components/sources/`) show "BambooHR · Employee profile · Retrieved live · 2 min ago". They appear:
  - in Sam's chat;
  - in Baxter chat source lists;
  - in task records;
  - on the Employees tab (per section: profile, onboarding, files).
  - Missing sections show as **Currently unavailable** with the reason.

## Ready for approved onboarding later

`src/lib/bamboohr/writes.ts` is the single gate for future writes. It is off (`BAMBOOHR_WRITES_ENABLED = false`) and lists the 10 conditions every write must meet:

1. An approved workflow requested it.
2. The requesting identity is verified.
3. The CEO or COO approved it.
4. The target record is valid.
5. A preview was shown.
6. The approval is bound to the exact payload.
7. A server-side permission check passed.
8. Execution is idempotent.
9. The result was read back and verified.
10. It was audited.

Sam Operations already provides most of this: payload-bound approvals, idempotent single execution, and audit logging.

Until then, an approved "BambooHR update" step in a workflow becomes a **manual task** that carries the exact change.

When the SOPs arrive:

1. Add the needed write scope (for example `employee:job.write`) to `scopes.ts`.
2. Implement the specific operation behind the gate, with read-back verification.
3. Have the COO reconnect so the new scope is granted.

## Tests

`tests/unit/bamboohr.test.ts` (20 tests, synthetic company) covers:

- **OAuth:**
  - the authorize URL;
  - the state check (forged, reused, or started by a different user);
  - token exchange and encryption;
  - refusing the wrong company;
  - missing scopes.
- **Tokens:**
  - refresh on expiry and on a 401;
  - a failed refresh asks the COO to reconnect;
  - keep-alive refresh;
  - disconnect.
- **Failures:** 429 and 5xx retries.
- **Data access:**
  - pagination;
  - requesting only explicit fields;
  - stripping sensitive fields;
  - restricted and missing records;
  - GET-only requests.
- **Identity links:**
  - exact-email suggestions;
  - ambiguous duplicates;
  - confirmation required before access;
  - no double links;
  - unlinking.
- **Access control:**
  - own record only;
  - HR access;
  - unverified users get nothing;
  - COO-only connection control.
- **Diagnostics:** only verified capabilities are reported as working.
- **Sam:**
  - tools enforce the requester's access;
  - an employee asking through Baxter stays restricted;
  - attribution is attached even when the model doesn't cite;
  - other sources aren't mislabelled.
