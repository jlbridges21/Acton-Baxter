# Architecture

Acton Property Research is a Next.js App Router application with:

- Supabase Auth + Postgres + Storage
- Server-only providers for ATTOM, RentCast, ArcGIS, Google Places, AI, Slack
- Shared research orchestration used by the web UI and Slack

## Request flow

1. Authenticated user selects a structured address
2. `POST /api/reports` creates a queued report
3. Processing page calls `POST /api/reports/[id]/run`
4. `runPropertyResearch` chooses mock or live mode
5. Live mode queries ATTOM + RentCast concurrently, then GIS using confirmed coordinates
6. Claims are stored, preferred facts selected, conflicts detected
7. AI or deterministic PEM content is generated
8. Report is marked complete

Slack `/property` creates the same report and enqueues durable jobs for research + completion notification.

## Key modules

- `src/lib/research/` research orchestration and persistence
- `src/lib/providers/` ATTOM, RentCast, AI
- `src/lib/connectors/california/` San Jose and Santa Clara County
- `src/lib/address/` autocomplete and resolve
- `src/lib/branding/` logo and company settings
- `src/lib/slack/` signature verification and messaging
- `src/lib/jobs/` durable queue processing
