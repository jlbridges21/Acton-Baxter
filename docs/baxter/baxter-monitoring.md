# Baxter Proactive Monitoring

**Status:** GHL-only implementation (no Buildertrend integration)

## Overview

Baxter proactive monitoring is a **deterministic** operational health system that detects CRM issues and configuration gaps **without LLM decision-making**. All findings are rule-based.

### Core Principles

1. **Deterministic Checks Only** — LLM never creates or decides findings
2. **Defaults DISABLED** — Admin must explicitly enable monitoring
3. **GHL Only** — No Buildertrend integration (schema-compatible for future)
4. **Explicit Mappings** — GHL pipeline/stage → Rulebook step (never name-based joins)
5. **Slack Pilot** — Single-channel delivery with reaction-based acknowledgment

## Architecture

### Monitoring Flow

```
Cron (daily) or Manual Trigger
  ↓
baxter_monitor_sweep job
  ↓
Run enabled checks → Findings
  ↓
Upsert findings (by dedupe_key)
Resolve missing findings
  ↓
baxter_alert_delivery job
  ↓
Slack message (immediate or digest)
  ↓
User reaction (✅ acknowledge, ❌ false positive)
  ↓
slack_monitoring_reaction job
  ↓
Update finding status
```

### Database Tables

- `monitoring_settings` — Singleton config (id='default'), defaults disabled
- `monitoring_findings` — Deduplicated findings with lifecycle states
- `monitoring_runs` — Audit log of sweep executions
- `ghl_rulebook_mappings` — Explicit GHL → Rulebook mappings
- `rulebook_admin_audit` — Rulebook admin mutations

### Job Types

- `baxter_monitor_sweep` — Run all enabled checks, upsert findings
- `baxter_alert_delivery` — Deliver open findings via Slack
- `slack_monitoring_reaction` — Process ✅ (acknowledge) or ❌ (false positive)

## Checks

### Operational Checks (Default: DISABLED)

Require explicit admin enablement via `check_configs`.

#### `unowned-opportunity`

**What:** Open opportunities without an assigned owner  
**Scope:** `settings.monitored_pipeline_ids`  
**Severity:** Warning  
**Dedupe Key:** `ghl_unowned_opportunity:{oppId}`  
**Evidence:** opportunityName, contactName, pipelineName, stageName, monetaryValue

#### `stale-opportunity`

**What:** Opportunities not updated within N days  
**Threshold:** `settings.default_stale_days` (default 3) OR `settings.stage_stale_overrides[pipelineId:stageId]`  
**Scope:** Monitored pipelines × enabled mappings  
**Severity:** Warning (< 2× threshold), Critical (≥ 2× threshold)  
**Dedupe Key:** `ghl_stale_opportunity:{oppId}`  
**Evidence:** daysStale, staleDaysThreshold, ownerName, lastUpdated

#### `required-ghl-data`

**What:** Missing required GHL fields per rulebook step  
**Scope:** Opportunities in monitored pipelines × stages with enabled mappings  
**Rulebook:** Uses `process_step_data_requirements` WHERE `source_system='ghl'` AND `required=true`  
**Field Resolution:** `source_field_path` = `{model}.{fieldKey}` (contact.* or opportunity.*)  
**Severity:** Warning  
**Dedupe Key:** `ghl_missing_data:{oppId}:{field1,field2,...}`  
**Evidence:** missingFields array, opportunityName, stageName

**Limitations:**

- Only checks fields with `source_field_path` populated
- If mapping has no `rulebook_step_key`, skips
- If required field path doesn't exist in custom field catalog, silently skips (config check flags this)

### Configuration/Health Checks (Default: ENABLED)

Run automatically when `monitoring.enabled = true` unless explicitly disabled.

#### `feed-health`

**What:** GHL connector health status  
**Checks:**

- GHL configured (OAuth tokens present)
- `evaluateGhlHealth()` returns healthy
- `hasCoreCrmCapabilities()` (contacts, opportunities, pipelines)

**Severity:** Critical (not configured, unhealthy), Warning (missing capabilities)  
**Dedupe Key:** `feed_health:ghl:{reason}`  
**Evidence:** indicators, lastSuccessfulFetch

#### `rulebook-health`

**What:** Process rulebook configuration completeness  
**Checks:**

- Active rulebook exists
- Monitored pipelines have stage mappings
- Count unmapped stages
- Required GHL field paths exist in custom field catalog

**Severity:** Critical (no active rulebook), Warning (missing mappings, invalid paths), Info (unmapped stages)  
**Dedupe Key:** `rulebook_health:{reason}:{context}`  
**Evidence:** pipelineId, unmappedStagesCount, invalidFieldPath, etc.

## Finding Lifecycle

### States

- `open` — New finding, not yet alerted
- `alerted` — Delivered to Slack, awaiting response
- `acknowledged` — User reacted with ✅
- `resolved` — Check no longer detects this issue
- `dismissed_false_positive` — User reacted with ❌
- `expired` — (Reserved for future auto-expiry)

### Deduplication

Findings are upserted by `dedupe_key`:

- If `dedupe_key` exists AND status ∈ {open, alerted, acknowledged}: refresh `last_detected_at`, update severity/title/evidence
- If `dedupe_key` exists AND status ∈ {resolved, dismissed_false_positive, expired}: leave alone
- If new: insert with `status='open'`

### Resolution

After each check run, `resolveMissingFindings(checkKey, seenDedupeKeys)`:

- Find all findings for this check WHERE status ∈ {open, alerted, acknowledged} AND dedupe_key NOT IN seenDedupeKeys
- Mark as `resolved`, set `resolved_at`

## Delivery

### Modes

- **Immediate:** One Slack message per finding
- **Digest:** Single message with all open findings (up to 10 shown, "...and N more")

### Quiet Hours

If `settings.quiet_hours_start` and `settings.quiet_hours_end` are set (HH:MM format):

- Evaluate in `settings.timezone` (default: America/Los_Angeles)
- Skip delivery if current time is in quiet hours
- Findings remain `open`, next delivery attempt waits

### Escalation

Findings with status=`alerted` and `alerted_at < (now - escalation_window_minutes)` AND `escalated_at IS NULL`:

- Post thread reply mentioning accountable (if available)
- Mark `escalated_at`

## Slack Reaction Routing

**Before** enqueueing `slack_baxter_reply`, check:

- If `event.type.startsWith("reaction_")`: look up `monitoring_findings` by `(slack_channel_id, slack_message_ts)`
- If found: enqueue `slack_monitoring_reaction` job; return (do NOT enter Q&A pipeline)
- If not found: ignore reaction (reactions don't enter Q&A)

**Reactions:**

- ✅ (`white_check_mark`) → `acknowledgeFinding()`
- ❌ (`x`) → `dismissFalsePositive()`

## Configuration

### Settings (singleton row)

```typescript
{
  enabled: false,  // DEFAULT: monitoring DISABLED
  pilot_slack_channel_id: string | null,
  pilot_slack_channel_name: string | null,
  timezone: "America/Los_Angeles",
  quiet_hours_start: "22:00" | null,  // HH:MM
  quiet_hours_end: "06:00" | null,
  delivery_mode: "immediate" | "digest",
  escalation_window_minutes: 240,
  default_stale_days: 3,
  monitored_pipeline_ids: string[],
  check_configs: {
    "unowned-opportunity": { enabled: false },
    "stale-opportunity": { enabled: false },
    "required-ghl-data": { enabled: false },
    "feed-health": { enabled: true },
    "rulebook-health": { enabled: true }
  },
  stage_stale_overrides: {
    "pipeline_id:stage_id": 7
  }
}
```

### Admin API

**Endpoint:** `POST /api/admin/baxter/monitoring`

**Actions:**

- `get_settings` → returns current settings
- `update_settings` → patch settings (requires admin session, records `updated_by`)
- `list_findings` → list findings with filters
- `get_finding` → fetch single finding by ID
- `list_runs` → recent sweep runs
- `run_sweep` → manual sweep (with `force: true` to run while disabled)
- `list_mappings` → GHL rulebook mappings
- `update_check_config` → enable/disable individual checks

## Cron Scheduling

**Current Limitation:** Daily cron only (no 30-minute granularity).

When monitoring is enabled, cron job enqueues `baxter_monitor_sweep` once per day. For more frequent sweeps, use manual trigger.

## Capabilities

When `settings.enabled = true` AND `hasActiveRulebook()` AND at least one operational check is enabled AND GHL configured:

- Call `noteMonitoringCapability(true)` (sync cache pattern)
- Claim: "Proactive monitoring: detect unowned opportunities, stale deals, missing required data, and config health issues (GHL only)"

## Metrics

Dashboard summary:

- `openCount`, `alertedCount`, `acknowledgedCount`
- `resolvedTodayCount`
- `falsePositiveRate` (over last 30 days, among alerted findings)
- `lastRun` (status, duration, findings counts)

## No Buildertrend

- Migration schema is compatible (future `buildertrend_rulebook_mappings` table could be added)
- No BT checks implemented
- No BT field resolution
- GHL-only constraints documented

## Testing

See `tests/unit/monitoring.test.ts`:

- Quiet hours logic (same day, overnight wrap, invalid formats)
- Dedupe key formats
- False positive rate formula
- Check enabled gating (operational default disabled, health default enabled)

## Security

- All DB policies: admin-only read, no client insert/update/delete
- Admin API: `requireAdminSession()`
- Slack reactions: any workspace user can acknowledge/dismiss (intentional for team pilot)
