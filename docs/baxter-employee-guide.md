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

Use **👍 / 👎** on Baxter’s answers to send lightweight feedback to admins.

---

## Slack

### Direct message (easiest)

Open Baxter’s DM and ask anything. You do **not** need to `@Baxter` in DMs.

Send `/clear` in a DM to start a fresh conversation. Baxter replies: “Conversation cleared. We’re starting fresh.”

### In a channel

Type `@Baxter` followed by your question. Baxter replies in a **thread** under your message.

In a thread, send `/clear` (with `@Baxter` if required by channel rules) to reset that thread’s Baxter conversation only.

**Important:** In channels, Baxter only sees messages that **@mention** it. For follow-ups, **`@Baxter` again** in the thread.

### Property research

```
/property 123 Main St, San Jose, CA
```

Baxter researches the address and sends a link to the full PEM report. Sign in on the web to view and print the PDF. Baxter does **not** post PDFs in Slack.

---

## Sources vs general guidance

| Label                | Meaning                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sources**          | Answer grounded in **approved** Acton knowledge (Google Docs/Sheets synced into Baxter, or admin-approved Knowledge Base entries). Links go to real documents. |
| **General guidance** | Useful context from Baxter’s AI — **not** official Acton policy.                                                                                               |
| **Mixed**            | Official answer not found; Baxter provides labeled general help.                                                                                               |

If Baxter says it could not find an approved Acton source for a company-specific question, do **not** treat any general guidance as company policy. Ask your manager or check the official source. For general questions (for example “What is an ADU?”), Baxter may answer from general knowledge and will say so when appropriate.

---

## Property Research (web)

From the Baxter Dashboard → **Property Research Tool** (or `/reports/new`):

1. Enter a California property address.
2. Baxter researches public and licensed sources.
3. Open the report and use **Download / Print PDF**.

Supported automated jurisdictions today include San Jose and Santa Clara County GIS where available, plus ATTOM/RentCast when configured. Reports are **not** ADU feasibility studies.

---

## Limitations (this version)

Baxter **does not**:

- Search **Buildertrend**, **GoHighLevel**, or **Domo**
- Access live project schedules, CRM records, or internal dashboards
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
