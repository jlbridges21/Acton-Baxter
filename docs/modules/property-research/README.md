# Property Research Tool — Module Record

Google Drive folder: **Property Research Tool**

This folder is the single source of truth for the Property Research Tool, one of Baxter's tools. It is written so that the module could be understood, operated, audited, and rebuilt by someone who has never spoken to the developer who wrote it.

## Documents

| #   | Document                                               | Audience                               | Read it when                                                                                          |
| --- | ------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | [Executive Brief](./01-executive-brief.md)             | Leadership, non-technical stakeholders | You need to know what this does, what it costs, where it works, and what is unresolved. Five minutes. |
| 2   | [Specification](./02-specification.md)                 | Engineer, reviewer, auditor            | You need the complete behaviour, every rule, every gap. This is the rebuild document.                 |
| 3   | [Code Reference](./03-code.md)                         | Engineer                               | You are rebuilding, extending, or reviewing the implementation.                                       |
| 4   | [Module Record](./04-module-record.md)                 | Owner, Tech Ops                        | Ownership, versions, providers, dependencies, and status at a glance.                                 |
| 5   | [Architecture Decision Records](./05-adrs.md)          | Engineer                               | You want to know _why_ it was built this way before you change it.                                    |
| 6   | [Test Plan and Evaluation](./06-test-plan-and-eval.md) | Engineer, reviewer                     | You changed something and need to prove you did not break it.                                         |
| 7   | [Changelog](./07-changelog.md)                         | Everyone                               | You want to know what changed and when.                                                               |
| 8   | [Operations Runbook](./08-runbook.md)                  | Owner, on-call                         | A data source is down, a report failed, or a number looks wrong.                                      |

## What it is

Enter a property address. The tool queries licensed property data providers, county and city GIS layers, federal and state hazard maps, and fire hydrant datasets; reconciles what they disagree about; and produces a sourced research report used to prepare for a Partnership Evaluation Meeting.

**It is the original Baxter module.** The repository is named after it. Migration `001_initial_schema.sql` creates its tables alongside the user profile table, which is why this module's schema and Baxter's foundations are intertwined.

## The two things to understand first

**1. Every number carries its source.** The report never shows a figure without recording which provider said it, when, how confident the tool is, and what the other providers said instead. Where sources disagree beyond a threshold, the disagreement is surfaced as a conflict with a recommended resolution rather than silently resolved.

**2. Deep coverage is Santa Clara County.** Purpose-built connectors exist for San Jose and Santa Clara County. Everywhere else falls back to a generic connector plus statewide and federal layers. A report for a property in Los Angeles is real but materially thinner than one for San Jose, and the report does not make that distinction as loudly as it could. See [Specification § 4](./02-specification.md#4-jurisdiction-coverage).

## Status at a glance

- **Status:** In production use
- **Risk tier:** High — output informs feasibility conversations with customers
- **Owner:** **GAP — not yet named.** See [Module Record](./04-module-record.md).
- **Report version:** 1.0.0
- **Tables:** 10 · **External data sources:** 10+ · **Jurisdiction connectors:** 3
- **Launch-blocking gaps open:** 4 — see [Specification § Gaps](./02-specification.md#gaps-to-resolve)

## Document maintenance

Review cadence: quarterly, and on any change that alters behaviour described here. **External GIS endpoints should be checked more often than that** — they are third-party URLs outside Acton's control and several have already moved or become token-gated. See the [Runbook](./08-runbook.md).
