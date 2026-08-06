# Baxter — employee guide

Baxter is Acton ADU’s internal AI teammate. It helps employees with company procedures, approved documentation, and general questions — in Acton’s voice and operating standards. Baxter is **not** a substitute for legal, engineering, or feasibility determinations.

**Web app:** https://acton-baxter.vercel.app

---

## Web chat

1. Sign in at the Baxter Dashboard.
2. Click **Ask Baxter** (bottom-right on the home page).
3. Ask your question in plain language.

**Start fresh:** click **New chat** in the chat header, or send `/clear`. Baxter replies “Conversation cleared.” and stops using prior context.

**Help:** send `/help` for a short command list.

**Examples:**

- “Who is Baxter?”
- “What is our process for X?” (when documented in approved sources)
- “What is an ADU?” (general knowledge)
- “How much have we sold this year?” (from approved Sales Performance Report)
- “What stage is Jane Doe in?” (live GoHighLevel, when connected)
- “What happens next for Jane?” (live CRM stage + approved process docs)
- “Move Jane Doe to Project Findings Complete.” (authorized users only — Baxter previews, then requires **confirm**)

Use **👍 / 👎** on Baxter’s answers (web chat buttons, or emoji reactions in Slack) to send lightweight feedback to admins. On Slack, 👎 may ask a short follow-up about what went wrong.

### GoHighLevel (when connected)

Baxter can look up **live** contacts and opportunities. CRM answers cite **GoHighLevel** as a source and use answer type **Live Acton data** (not Knowledge Base / Approved Acton knowledge).

Examples Baxter can answer when the record exists in GHL:

- Contact address, phone, email, city
- Owner / assignee (resolved to employee name)
- Tags and custom fields (human-readable names)
- Opportunity pipeline, stage, and value
- Recent conversation / last message timing (bounded live retrieval)

Authorized users can ask Baxter to prepare CRM updates; Baxter never writes until you reply **confirm** (or cancel). Reply **cancel** to discard a pending update. Confirmations expire in about 10 minutes.

Admins can also browse Acton CRM at **Integrations → GoHighLevel** (`/admin/connectors/ghl`): Contacts, Opportunities, Conversations, and Actions. Edits there use the same confirmation flow as Baxter chat.

---

## Slack

### Direct message (easiest)

Open Baxter’s DM and ask anything. You do **not** need to `@Baxter` in DMs.

Send `/clear` in a DM to start a fresh conversation. Baxter replies: “Conversation cleared. We’re starting fresh.”

### In a channel

Type `@Baxter` followed by your question. Baxter replies in a **thread** under your message.

In a thread, send `/clear` (with `@Baxter` if required by channel rules) to reset that thread’s Baxter conversation only.

**Important:** In channels, Baxter only sees messages that **@mention** it. For follow-ups, **`@Baxter` again** in the thread.

### Slack Search (organizational recall)

Baxter can search Slack **live** when you ask — it does not copy Slack into Knowledge. It only searches conversations your Slack account is allowed to access.

**Connect once:** Settings → **Integrations** → Connect Slack Search (needed for private channels and DMs).

**Try asking:**

- “What did Kevin say about Gwen?”
- “What is the latest on the RACI matrix?”
- “What happened in #sales yesterday?”
- “When did we decide to change the PEM process?”
- “Who mentioned BuilderTrend this week?”
- “What was Maxx’s last message in #project-management?”

Then follow up naturally: “Did Kevin respond?” / “What did he say?”

### Property research

```
/property 123 Main St, San Jose, CA
```

Baxter researches the address and sends a link to the full PEM report. Sign in on the web to view and print the PDF. Baxter does **not** post PDFs in Slack.

---

## Sources vs general guidance

| Label                | Meaning                                                                                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sources**          | Answer grounded in **approved** Acton knowledge (Google Docs/Sheets synced into Baxter, or admin-approved Knowledge Base entries), plus live sources such as **GoHighLevel** or **Slack** when cited. Slack links open the original message. |
| **Answer type**      | Code-owned label from actual sources: **Approved Acton knowledge**, **Live Acton data** (GHL), **Slack conversational update**, **PEM sales intelligence**, **General knowledge**, or a combined/mixed label when multiple apply.            |
| **General guidance** | Useful context from Baxter’s AI — **not** official Acton policy.                                                                                                                                                                             |
| **Mixed**            | Official answer not found; Baxter provides labeled general help.                                                                                                                                                                             |

If Baxter says it could not find an approved Acton source for a company-specific question, do **not** treat any general guidance as company policy. Ask your manager or check the official source. For general questions (for example “What is an ADU?”), Baxter may answer from general knowledge and will say so when appropriate.

---

## Property Research (web)

From the Baxter Dashboard → **Property Research Tool** (or `/reports/new`):

1. Enter a California property address.
2. Baxter researches public and licensed sources.
3. Open the report. Use the **at-a-glance chips** or the sticky section nav to jump to flood zone, lot lines, fire access, ADU setbacks, and the on-site checklist; use **Download / Print PDF** for the meeting (under six pages, no screen chrome).

Supported automated jurisdictions today include San Jose and Santa Clara County GIS where available, plus ATTOM/RentCast when configured. Reports are **not** ADU feasibility studies.

---

## Limitations (this version)

Baxter **does not**:

- Search **Buildertrend** or **Domo**
- Autonomously monitor CRM or run multi-step write workflows (coming later)
- Send GHL messages, book calendars, or edit Voice AI / contracts through chat
- Perform site surveys, title research, or zoning determinations
- Guarantee completeness of every Acton document (only **approved** synced/entered knowledge is used)

When in doubt, verify with the official document or your team lead.

---

## Feedback

| Channel      | How                                                                                    |
| ------------ | -------------------------------------------------------------------------------------- |
| **Web chat** | 👍 / 👎 on Baxter’s message                                                            |
| **Slack**    | Tell your admin or pilot contact if an answer is wrong, incomplete, or missing sources |

Admins review feedback at `/admin/baxter/feedback` (admin only). Slack usage for admins is organized under `/admin/slack` (Activity by person and channel).

---

## Getting help

If Baxter shows an error with a **Reference: BAXTER\_...** code, retry once. If it persists, share the reference code with an admin (not your password or API keys).

**Pilot / Baxter owner:** _[Add contact name — e.g. Jackson]_

**Admin setup docs:** `docs/slack-setup.md`, `docs/production-checklist.md`
