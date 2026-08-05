# Report limitations

This report summarizes licensed and publicly available property information for sales preparation.

It is **not**:

- a zoning determination
- a title report
- a survey
- a site measurement package
- an ADU feasibility conclusion
- an appraisal

Information must be verified during Acton’s feasibility process and with the appropriate public agencies.

## What is automated vs site inspection

- **Foundation type** may appear when ATTOM returns an assessor-derived value. Treat it as incomplete: verify on site during feasibility. When absent, it is listed under Missing information in Property Overview.
- **Utilities** (electric panel capacity, meter locations, service laterals) and **easements / recorded tract maps** are intentionally listed under **Site inspection required** — not as missing data. Use the APN, tract/subdivision identifiers, and assessor / Property Profile links there to start recorder and title review.

Santa Clara County Property Profile access is currently a **generic search** into the public Property Explorer Experience unless a stable direct report endpoint is confirmed later.

Flood/fire hazard values remain manual-review links unless a reliable automated source is connected later.

## Research reliability (web + Slack)

Web-triggered research (`/api/reports/[id]/run`, refresh, and retry) enqueues the same durable `property_research` job type Slack `/property` uses, then processes it via `after()` with queue claim/complete bookkeeping. Cron reclaim is the crash-recovery backup — a mid-run deploy or platform kill no longer leaves a report stuck in “researching” without a recoverable job.

Reports left in **researching** for more than **30 minutes** with no queued/running `property_research` job are flipped to **failed** with a retryable message (status poll and cron sweep). Use Retry research on the processing page.
