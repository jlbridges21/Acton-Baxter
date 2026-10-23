import { AppError } from "@/lib/errors";

/** BambooHR integration errors with plain-English messages that never include secrets or record data. */
export type BambooErrorCode =
  | "not_configured"
  | "not_connected"
  | "reauthorize"
  | "state_invalid"
  | "wrong_company"
  | "missing_scope"
  | "forbidden_employee"
  | "not_found"
  | "not_mapped"
  | "ambiguous_mapping"
  | "not_authorized"
  | "rate_limited"
  | "temporary"
  | "unsupported"
  | "invalid_field"
  | "write_disabled";

export class BambooError extends AppError {
  readonly reason: BambooErrorCode;
  readonly retryable: boolean;
  constructor(message: string, reason: BambooErrorCode, retryable = false) {
    super(message, {
      code: `BAMBOOHR_${reason.toUpperCase()}`,
      statusCode: bambooErrorStatus(reason),
      expose: true,
    });
    this.name = "BambooError";
    this.reason = reason;
    this.retryable = retryable;
  }
}

/** HTTP status for API routes. */
export function bambooErrorStatus(reason: BambooErrorCode): number {
  switch (reason) {
    case "not_authorized":
    case "forbidden_employee":
    case "write_disabled":
      return 403;
    case "not_found":
    case "not_mapped":
      return 404;
    case "rate_limited":
      return 429;
    case "temporary":
      return 503;
    default:
      return 409;
  }
}
