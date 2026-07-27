import { AppError } from "@/lib/errors";

export type GhlErrorCode =
  | "BAXTER_GHL_NOT_CONFIGURED"
  | "BAXTER_GHL_AUTH_FAILED"
  | "BAXTER_GHL_TOKEN_EXPIRED"
  | "BAXTER_GHL_REAUTH_REQUIRED"
  | "BAXTER_GHL_LOCATION_INVALID"
  | "BAXTER_GHL_LOCATION_ACCESS_DENIED"
  | "BAXTER_GHL_SCOPE_MISSING"
  | "BAXTER_GHL_RESOURCE_UNAVAILABLE"
  | "BAXTER_GHL_RATE_LIMITED"
  | "BAXTER_GHL_BAD_REQUEST"
  | "BAXTER_GHL_NOT_FOUND"
  | "BAXTER_GHL_API_UNAVAILABLE"
  | "BAXTER_GHL_RESPONSE_INVALID"
  | "BAXTER_GHL_DISABLED"
  | "BAXTER_GHL_PERMISSION_DENIED"
  | "BAXTER_GHL_STALE_STATE"
  | "BAXTER_GHL_ACTION_EXPIRED"
  | "BAXTER_GHL_WRITE_DISABLED";

export class GhlConnectorError extends AppError {
  constructor(
    message: string,
    options?: { code?: GhlErrorCode; statusCode?: number; expose?: boolean; cause?: unknown },
  ) {
    super(message, {
      code: options?.code ?? "BAXTER_GHL_API_UNAVAILABLE",
      statusCode: options?.statusCode ?? 502,
      expose: options?.expose ?? true,
      cause: options?.cause,
    });
    this.name = "GhlConnectorError";
  }
}

export class GhlConfigError extends GhlConnectorError {
  constructor(
    message = "GoHighLevel connector is not configured",
    code: GhlErrorCode = "BAXTER_GHL_NOT_CONFIGURED",
  ) {
    super(message, {
      code,
      statusCode: 503,
      expose: true,
    });
    this.name = "GhlConfigError";
  }
}

export class GhlAuthError extends GhlConnectorError {
  constructor(
    message = "GoHighLevel authentication failed",
    code: GhlErrorCode = "BAXTER_GHL_AUTH_FAILED",
  ) {
    super(message, {
      code,
      statusCode: 401,
      expose: true,
    });
    this.name = "GhlAuthError";
  }
}

export class GhlRateLimitError extends GhlConnectorError {
  readonly retryAfterMs: number | null;

  constructor(message = "GoHighLevel rate limit exceeded", retryAfterMs?: number | null) {
    super(message, {
      code: "BAXTER_GHL_RATE_LIMITED",
      statusCode: 429,
      expose: true,
    });
    this.name = "GhlRateLimitError";
    this.retryAfterMs = retryAfterMs ?? null;
  }
}

/**
 * Classify GHL API errors with proper scope/permission distinction.
 * Key patterns for scope issues:
 * - "not authorized for this scope"
 * - "token is not authorized"
 * - "permission denied"
 * - "insufficient scope"
 *
 * Only true auth failures (invalid/expired/revoked without scope language):
 * - "token expired"
 * - "invalid token"
 * - "unauthorized" (without scope context)
 */
export function classifyGhlApiError(status: number, bodyText: string): GhlErrorCode {
  const lower = bodyText.toLowerCase();

  // Check for scope/permission issues first (these often come as 401 or 403)
  const isScopeIssue =
    lower.includes("not authorized for this scope") ||
    lower.includes("not authorized for scope") ||
    lower.includes("insufficient scope") ||
    (lower.includes("scope") && lower.includes("not authorized")) ||
    lower.includes("permission denied") ||
    (lower.includes("scope") && lower.includes("permission"));

  if (status === 401) {
    // Scope issue masquerading as 401
    if (isScopeIssue) {
      return "BAXTER_GHL_SCOPE_MISSING";
    }
    // Check for location access denied (PIT without locations.readonly)
    if (lower.includes("location") && (lower.includes("access") || lower.includes("authorized"))) {
      return "BAXTER_GHL_LOCATION_ACCESS_DENIED";
    }
    // True token expiration
    if (lower.includes("expired")) {
      return "BAXTER_GHL_TOKEN_EXPIRED";
    }
    // Invalid/revoked token (not just "token" mention which could be scope-related)
    if (
      lower.includes("invalid token") ||
      lower.includes("token invalid") ||
      lower.includes("revoked")
    ) {
      return "BAXTER_GHL_TOKEN_EXPIRED";
    }
    // Generic auth failure
    return "BAXTER_GHL_AUTH_FAILED";
  }

  if (status === 403) {
    if (isScopeIssue) {
      return "BAXTER_GHL_SCOPE_MISSING";
    }
    // Location-specific access denial
    if (lower.includes("location")) {
      return "BAXTER_GHL_LOCATION_ACCESS_DENIED";
    }
    return "BAXTER_GHL_PERMISSION_DENIED";
  }

  if (status === 400) {
    if (lower.includes("location") && (lower.includes("invalid") || lower.includes("not found"))) {
      return "BAXTER_GHL_LOCATION_INVALID";
    }
    return "BAXTER_GHL_BAD_REQUEST";
  }

  if (status === 404) {
    if (lower.includes("location")) {
      return "BAXTER_GHL_LOCATION_INVALID";
    }
    return "BAXTER_GHL_NOT_FOUND";
  }

  if (status === 429) {
    return "BAXTER_GHL_RATE_LIMITED";
  }

  if (status >= 500) {
    return "BAXTER_GHL_API_UNAVAILABLE";
  }

  return "BAXTER_GHL_API_UNAVAILABLE";
}

export function isRetryableGhlError(error: unknown): boolean {
  if (error instanceof GhlRateLimitError) return true;
  if (error instanceof GhlConnectorError) {
    const code = error.code as GhlErrorCode;
    return code === "BAXTER_GHL_RATE_LIMITED" || code === "BAXTER_GHL_API_UNAVAILABLE";
  }
  return false;
}

export function shouldReauthenticate(error: unknown): boolean {
  if (error instanceof GhlConnectorError) {
    const code = error.code as GhlErrorCode;
    return (
      code === "BAXTER_GHL_TOKEN_EXPIRED" ||
      code === "BAXTER_GHL_REAUTH_REQUIRED" ||
      code === "BAXTER_GHL_AUTH_FAILED"
    );
  }
  return false;
}

/**
 * Check if an error is a scope/permission issue (not a token issue).
 * Scope issues can be resolved by updating PIT permissions, not by regenerating tokens.
 */
export function isScopeError(error: unknown): boolean {
  if (error instanceof GhlConnectorError) {
    const code = error.code as GhlErrorCode;
    return (
      code === "BAXTER_GHL_SCOPE_MISSING" ||
      code === "BAXTER_GHL_LOCATION_ACCESS_DENIED" ||
      code === "BAXTER_GHL_PERMISSION_DENIED" ||
      code === "BAXTER_GHL_RESOURCE_UNAVAILABLE"
    );
  }
  return false;
}

/**
 * User-facing error messages with actionable PIT guidance.
 */
const USER_FACING_MESSAGES: Record<GhlErrorCode, (resource?: string) => string> = {
  BAXTER_GHL_NOT_CONFIGURED: () =>
    "GoHighLevel is not configured. Set ENABLE_GHL_INTEGRATION=true and configure token/location.",
  BAXTER_GHL_AUTH_FAILED: () =>
    "GoHighLevel authentication failed. Verify your Private Integration Token is valid and not revoked.",
  BAXTER_GHL_TOKEN_EXPIRED: () =>
    "GoHighLevel token has expired. For OAuth, reconnect in Admin → Connectors. For PIT, regenerate the token in GHL.",
  BAXTER_GHL_REAUTH_REQUIRED: () =>
    "GoHighLevel requires re-authentication. Reconnect in Admin → Connectors → GoHighLevel.",
  BAXTER_GHL_LOCATION_INVALID: () =>
    "GoHighLevel location ID is invalid or not found. Verify GHL_LOCATION_ID matches your GHL location.",
  BAXTER_GHL_LOCATION_ACCESS_DENIED: (resource) =>
    `GoHighLevel location access denied${resource ? ` for ${resource}` : ""}. ` +
    "Your Private Integration Token may lack the 'locations.readonly' scope. " +
    "However, this is optional — Baxter can still access contacts, opportunities, and pipelines if those scopes are granted. " +
    "To fix: Edit your Private Integration in GHL → Settings → Integrations → Private Integrations → Edit scopes.",
  BAXTER_GHL_SCOPE_MISSING: (resource) =>
    `GoHighLevel scope missing${resource ? ` for ${resource}` : ""}. ` +
    "Your Private Integration Token lacks required permissions. " +
    "To fix: Edit your Private Integration in GHL → Settings → Integrations → Private Integrations → Edit scopes. " +
    "No need to regenerate the token — just add the missing scopes and save.",
  BAXTER_GHL_RESOURCE_UNAVAILABLE: (resource) =>
    `GoHighLevel ${resource || "resource"} is unavailable. ` +
    "This may be a missing scope or the feature is not enabled in your GHL account.",
  BAXTER_GHL_RATE_LIMITED: () =>
    "GoHighLevel rate limit exceeded. Please wait a moment and try again.",
  BAXTER_GHL_BAD_REQUEST: () =>
    "GoHighLevel received an invalid request. This may be a configuration issue.",
  BAXTER_GHL_NOT_FOUND: (resource) => `GoHighLevel ${resource || "resource"} not found.`,
  BAXTER_GHL_API_UNAVAILABLE: () =>
    "GoHighLevel API is temporarily unavailable. Please try again in a few minutes.",
  BAXTER_GHL_RESPONSE_INVALID: () => "GoHighLevel returned an unexpected response format.",
  BAXTER_GHL_DISABLED: () =>
    "GoHighLevel integration is disabled. Set ENABLE_GHL_INTEGRATION=true to enable.",
  BAXTER_GHL_PERMISSION_DENIED: (resource) =>
    `Permission denied${resource ? ` for ${resource}` : ""}. ` +
    "Your user role may not have access to this resource, or the PIT lacks required scopes.",
  BAXTER_GHL_STALE_STATE: () =>
    "The resource has been modified since it was last read. Please refresh and try again.",
  BAXTER_GHL_ACTION_EXPIRED: () =>
    "This action has expired. Pending actions must be confirmed within 10 minutes.",
  BAXTER_GHL_WRITE_DISABLED: () =>
    "Write operations are disabled. Contact an administrator to enable GHL writes.",
};

/**
 * Get user-facing error message with actionable guidance.
 */
export function userFacingGhlError(code: GhlErrorCode, resource?: string): string {
  const fn = USER_FACING_MESSAGES[code];
  return fn ? fn(resource) : `GoHighLevel error: ${code}`;
}

/**
 * Extract the best user-facing message from an error.
 */
export function formatGhlErrorForUser(error: unknown, resource?: string): string {
  if (error instanceof GhlConnectorError) {
    return userFacingGhlError(error.code as GhlErrorCode, resource);
  }
  if (error instanceof Error) {
    return `GoHighLevel error: ${error.message}`;
  }
  return "GoHighLevel encountered an unexpected error.";
}
