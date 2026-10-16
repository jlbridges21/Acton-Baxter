# Site Inspection Checklist — Module Record

Google Drive folder: **Site Inspection Checklist**

This folder is the single source of truth for the Site Inspection Checklist module, one of Baxter's tools. It is written so that the module could be understood, operated, audited, and rebuilt by someone who has never spoken to the developer who wrote it.

## Documents

| #   | Document                                               | Audience                               | Read it when                                                                             |
| --- | ------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | [Executive Brief](./01-executive-brief.md)             | Leadership, non-technical stakeholders | You need to know what this does, what it replaced, and what is unresolved. Five minutes. |
| 2   | [Specification](./02-specification.md)                 | Engineer, reviewer, auditor            | You need the complete behaviour, every rule, every gap. This is the rebuild document.    |
| 3   | [Code Reference](./03-code.md)                         | Engineer                               | You are rebuilding, extending, or reviewing the implementation.                          |
| 4   | [Module Record](./04-module-record.md)                 | Owner, Tech Ops                        | You need ownership, versions, dependencies, and status at a glance.                      |
| 5   | [Architecture Decision Records](./05-adrs.md)          | Engineer                               | You want to know _why_ it was built this way before you change it.                       |
| 6   | [Test Plan and Evaluation](./06-test-plan-and-eval.md) | Engineer, reviewer                     | You changed something and need to prove you did not break it.                            |
| 7   | [Changelog](./07-changelog.md)                         | Everyone                               | You want to know what changed and when.                                                  |
| 8   | [Operations Runbook](./08-runbook.md)                  | Owner, on-call                         | Uploads are stuck, AI is failing, or a video will not play.                              |

## What it is

A field inspector opens Baxter on a phone at a job site, works through a checklist, types notes, and captures photos and video. Uploads continue in the background and survive losing signal. When the inspection is marked complete, every video is transcribed and each checklist item that has video gets a short AI summary grounded only in what was said and written.

It was built to replace Company Cam, which cost roughly **$50 per user per month**.

## Status at a glance

- **Status:** In production field use
- **Risk tier:** High — primary capture tool for field work that cannot be repeated without a second site visit
- **Owner:** **GAP — not yet named.** See [Module Record](./04-module-record.md).
- **Tables:** 9 · **Storage buckets:** 1 · **Migrations:** 10 · **Background job types:** 3
- **Launch-blocking gaps open:** 3 — see [Specification § Gaps](./02-specification.md#gaps-to-resolve)

## The one thing to understand first

**Each inspection freezes its own copy of the checklist.** When an inspection is created, the entire template — sections, items, guide notes, sub-questions, options — is deep-copied into the inspection row with fresh identifiers. Editing a template afterwards never changes an inspection that already exists.

Everything else in this module follows from that decision. See [ADR-001](./05-adrs.md#adr-001).

## Document maintenance

Review cadence: quarterly, and on any change that alters behaviour described here. The [Changelog](./07-changelog.md) is updated in the same commit as the change it describes, not afterwards.
