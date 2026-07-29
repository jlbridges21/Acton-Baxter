# Baxter capability registry

Baxter’s self-knowledge comes from a **machine-readable capability catalog**, not a hardcoded marketing paragraph.

## Source of truth

| Layer           | Path                                       | Role                                                                |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| Dashboard tools | `src/lib/baxter/tools.ts` (`BAXTER_TOOLS`) | Employee tools + routes (`/pem-neats`, `/dashboard`, create routes) |
| Admin nav       | `src/lib/baxter/admin-nav.ts`              | Admin-only routes (Knowledge, Integrations, Users, Rulebook, …)     |
| Catalog         | `src/lib/baxter/capability-registry.ts`    | Unified `BaxterCapability[]` with status, limits, synonyms          |
| Help answers    | `src/lib/baxter/capability-help.ts`        | Deterministic “what can you do / how do I / can you…” answers       |
| Prompt block    | `buildCapabilityPromptBlock()`             | Injected only for identity/capability questions                     |

## Dynamic status

At request time the catalog reflects:

- Google Workspace configured or disconnected
- GoHighLevel configured/enabled
- Active Process Rulebook known
- Process Monitoring UI + runtime flag
- Caller role (employees do not get admin-only links)

## Honest limitations

Examples Baxter should claim accurately:

- **BuilderTrend**: no API connection; PEM custom fields are copy/paste handoff only
- **Google**: only Knowledge Center–connected sources, not every Drive file
- **GHL writes**: confirmation required; role may be read-only

## Chat model

Set `BAXTER_CHAT_MODEL` for web/Slack Baxter Q&A (recommended: `gpt-5.6-terra`).

Fallback order when unset: `BAXTER_OPENAI_MODEL` → `OPENAI_MODEL` → `gpt-4o-mini`.

Do **not** reuse `PEM_NEAT_OPENAI_MODEL` for chat — PEM generation stays on its own model.
