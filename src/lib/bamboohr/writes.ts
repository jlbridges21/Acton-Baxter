/**
 * BambooHR write operations are DISABLED in this phase. This module is the single gate future
 * approved write features must pass through. Turning writes on is a code change plus a migration
 * of the request below into Sam Operations actions — not a configuration toggle.
 *
 * Every future write must satisfy, in order:
 *   1. An approved, published workflow step (Sam Operations) requested it.
 *   2. The requesting identity is verified (web session or mapped Slack user).
 *   3. The approver is the confirmed CEO or COO.
 *   4. The target employee id exists and is readable.
 *   5. A field-by-field preview (current → proposed) was shown.
 *   6. The approval is bound to the exact payload hash (ops_actions).
 *   7. Server-side permission + field allowlist checks pass (never sensitive fields).
 *   8. Execution is idempotent (ops_actions idempotency key + single claim).
 *   9. The result is verified by reading the fields back.
 *  10. Everything is written to the audit log.
 */

import { BambooError } from "./errors";

export const BAMBOOHR_WRITES_ENABLED = false as const;

/** Write capabilities planned for later, each needing its own approved requirement and scope. */
export const PLANNED_WRITES = [
  {
    key: "contact_update",
    label: "Employee work-contact updates",
    scope: "employee:contact.write (to verify)",
    status: "disabled",
  },
  {
    key: "job_update",
    label: "Job information updates",
    scope: "employee:job.write",
    status: "disabled",
  },
  {
    key: "custom_field_update",
    label: "Custom field updates",
    scope: "employee:custom_fields.write (to verify)",
    status: "disabled",
  },
  {
    key: "file_upload",
    label: "Employee file uploads",
    scope: "employee:file.write (to verify)",
    status: "disabled",
  },
  {
    key: "new_hire_packet",
    label: "New-hire packets",
    scope: "onboarding.write",
    status: "disabled",
  },
  {
    key: "onboarding_experience",
    label: "Onboarding experiences",
    scope: "onboarding.write",
    status: "disabled",
  },
] as const;

export function assertBambooWriteAllowed(operation: string): never {
  throw new BambooError(
    `BambooHR updates are turned off. "${operation}" will be available only after leadership approves the onboarding SOPs and a write workflow is enabled.`,
    "write_disabled",
  );
}
