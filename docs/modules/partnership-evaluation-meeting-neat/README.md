# Partnership Evaluation Meeting NEAT — Module Record

Google Drive folder: **Partnership Evaluation Meeting NEAT**

This folder is the single source of truth for the PEM NEAT module, one of Baxter's tools. It is written so that the module could be understood, operated, audited, and rebuilt by someone who has never spoken to the developer who wrote it.

## Documents

| #   | Document                                               | Audience                               | Read it when                                                                          |
| --- | ------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | [Executive Brief](./01-executive-brief.md)             | Leadership, non-technical stakeholders | You need to know what this does, what it costs, and what is unresolved. Five minutes. |
| 2   | [Specification](./02-specification.md)                 | Engineer, reviewer, auditor            | You need the complete behaviour, every rule, every gap. This is the rebuild document. |
| 3   | [Code Reference](./03-code.md)                         | Engineer                               | You are rebuilding, extending, or reviewing the implementation.                       |
| 4   | [Module Record](./04-module-record.md)                 | Owner, Tech Ops                        | You need ownership, versions, prompts, status, and dependency facts at a glance.      |
| 5   | [Architecture Decision Records](./05-adrs.md)          | Engineer                               | You want to know _why_ it was built this way before you change it.                    |
| 6   | [Test Plan and Evaluation](./06-test-plan-and-eval.md) | Engineer, reviewer                     | You changed something and need to prove you did not break it.                         |
| 7   | [Changelog](./07-changelog.md)                         | Everyone                               | You want to know what changed and when.                                               |
| 8   | [Operations Runbook](./08-runbook.md)                  | Owner, on-call                         | Something is broken, slow, expensive, or stuck.                                       |

## What NEAT stands for

**N**otes · **E**mail · **A**ssessment · **T**ranscript

Those four letters are the module's outputs and its organising idea. A Partnership Evaluation Meeting happens, and the module turns the recording of it into exactly those four artifacts. See the [Executive Brief](./01-executive-brief.md) for how each one is produced.

## Status at a glance

- **Status:** In production use
- **Risk tier:** High — processes customer PII, produces employee performance assessments
- **Owner:** **GAP — not yet named.** See [Module Record](./04-module-record.md).
- **Standard version:** 1.0.0
- **Launch-blocking gaps open:** 4 — see [Specification § Gaps](./02-specification.md#gaps-to-resolve)

## Document maintenance

Review cadence: quarterly, and on any change that alters behaviour described here. The [Changelog](./07-changelog.md) is updated in the same commit as the change it describes, not afterwards.
