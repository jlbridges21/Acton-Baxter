# GoHighLevel Actions (Prompt 2)

## Overview

Prompt 2 adds controlled write operations to the GoHighLevel connector. All writes require explicit user confirmation before execution.

**Key principles:**

- One action at a time (no chained writes)
- All changes require confirmation
- Actions expire after 10 minutes
- Stale detection prevents conflicting updates
- Full audit trail of all proposed and executed actions

---

## Supported Actions

| Action Type              | Resource    | Description                           |
| ------------------------ | ----------- | ------------------------------------- |
| `update_contact_fields`  | Contact     | Update allowlisted contact fields     |
| `add_contact_tag`        | Contact     | Add a tag to a contact                |
| `remove_contact_tag`     | Contact     | Remove a tag from a contact           |
| `update_opportunity`     | Opportunity | Update allowlisted opportunity fields |
| `move_opportunity_stage` | Opportunity | Move opportunity to a different stage |

---

## Allowlisted Fields

### Contact Fields

- `firstName`, `lastName`, `name`
- `email`, `phone`
- `address1`, `city`, `state`, `postalCode`, `country`
- `companyName`, `website`
- `source`, `assignedTo`
- `dnd` (Do Not Disturb)

### Opportunity Fields

- `name`
- `monetaryValue`
- `status` (open, won, lost, abandoned)
- `assignedTo`
- `pipelineStageId`
- `source`

**Fields NOT in the allowlist cannot be modified via Baxter.**

---

## Confirmation Flow

### 1. User Request

User asks Baxter to make a CRM change:

> "Update John Smith's phone number to 555-1234"

### 2. Entity Resolution

Baxter resolves "John Smith" to a specific contact. If ambiguous, Baxter asks for clarification.

### 3. Pending Action Created

A pending action is created with:

- `before_state`: Snapshot of current values
- `proposed_changes`: What will be changed
- `expires_at`: 10 minutes from now

### 4. Confirmation Request

Baxter asks the user to confirm:

> "I'll update John Smith's phone from 555-0000 to 555-1234. Reply 'confirm' to proceed or 'cancel' to abort."

### 5. User Confirms/Cancels

- **Confirm:** Action executes, changes applied to GHL
- **Cancel:** Action cancelled, no changes made
- **Timeout:** Action expires after 10 minutes

### 6. Audit Entry

All actions (proposed, executed, cancelled, expired) are logged in `ghl_action_audit`.

---

## Stale Detection

Before executing, Baxter checks if the resource has been modified since the proposal:

1. Compare `dateUpdated` from GHL with `before_state.dateUpdated`
2. If different → action is marked `stale`
3. User must propose the action again with fresh data

This prevents conflicting updates when multiple users or systems modify the same record.

---

## Permissions

| Role        | Can Write | Notes                                       |
| ----------- | --------- | ------------------------------------------- |
| Admin       | Yes       | Always has write access when GHL is enabled |
| Salesperson | Depends   | Requires `ENABLE_GHL_WRITES_FOR_SALES=true` |
| New User    | No        | Read-only access                            |

Configure in `.env`:

```bash
ENABLE_GHL_WRITES_FOR_SALES=true
```

---

## Channels

Actions can be triggered from multiple channels:

| Channel | Description            | Confirmation Flow              |
| ------- | ---------------------- | ------------------------------ |
| `web`   | Baxter web chat        | Inline confirmation in chat    |
| `slack` | Slack @baxter mentions | Reply "confirm" in same thread |
| `api`   | Direct API calls       | Confirm via API endpoint       |

---

## API Endpoints

### List Recent Actions

```http
POST /api/admin/connectors/ghl
{
  "action": "list_recent_actions",
  "limit": 50
}
```

### Refresh Capabilities

```http
POST /api/admin/connectors/ghl
{
  "action": "refresh_capabilities"
}
```

---

## Database Schema

### `ghl_pending_actions`

Stores pending write actions awaiting confirmation.

| Column             | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `id`               | UUID primary key                                                            |
| `user_id`          | Supabase user who initiated                                                 |
| `external_user_id` | Slack user ID or other identifier                                           |
| `conversation_id`  | Baxter conversation ID                                                      |
| `channel`          | web, slack, or api                                                          |
| `action_type`      | Type of action                                                              |
| `resource_type`    | contact or opportunity                                                      |
| `resource_id`      | GHL resource ID                                                             |
| `before_state`     | Snapshot at proposal time                                                   |
| `proposed_changes` | What will be changed                                                        |
| `status`           | pending, confirmed, executing, completed, failed, expired, cancelled, stale |
| `expires_at`       | Confirmation deadline (10 min default)                                      |

### `ghl_action_audit`

Audit trail for all CRM write operations.

---

## Error Handling

| Error Code                     | Meaning                          | Action                  |
| ------------------------------ | -------------------------------- | ----------------------- |
| `BAXTER_GHL_STALE_STATE`       | Resource modified since proposal | Propose action again    |
| `BAXTER_GHL_ACTION_EXPIRED`    | Confirmation window closed       | Propose action again    |
| `BAXTER_GHL_WRITE_DISABLED`    | Writes not enabled for user role | Contact admin           |
| `BAXTER_GHL_PERMISSION_DENIED` | User lacks permission            | Check role and settings |

---

## Security Notes

- All pending actions are service-role only (no client writes)
- Before/after states logged for audit
- Idempotent execution (duplicate confirms are safe)
- No autonomous writes (always requires human confirmation)

---

## See Also

- [GoHighLevel Connector](./gohighlevel-connector.md) — Main connector documentation
- [Baxter AI Architecture](./baxter-ai-architecture.md) — How Baxter processes requests
