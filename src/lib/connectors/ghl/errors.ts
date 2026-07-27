import { AppError } from "@/lib/errors";

export type GhlErrorCode =
  | "BAXTER_GHL_NOT_CONFIGURED"
  | "BAXTER_GHL_AUTH_FAILED"
  | "BAXTER_GHL_TOKEN_EXPIRED"
  | "BAXTER_GHL_REAUTH_REQUIRED"
  | "BAXTER_GHL_LOCATION_INVALID"
  | "BAXTER_GHL_SCOPE_MISSING"
  | "BAXTER_GHL_RATE_LIMITED"
  | "BAXTER_GHL_BAD_REQUEST"
  | "BAXTER_GHL_NOT_FOUND"
  | "BAXTER_GHL_API_UNAVAILABLE"
  | "BAXTER_GHL_RESPONSE_INVALID"
  | "BAXTER_GHL_DISABLED";

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

export function classifyGhlApiError(status: number, bodyText: string): GhlErrorCode {
  const lower = bodyText.toLowerCase();

  if (status === 401) {
    if (lower.includes("expired") || lower.includes("token")) {
      return "BAXTER_GHL_TOKEN_EXPIRED";
    }
    return "BAXTER_GHL_AUTH_FAILED";
  }

  if (status === 403) {
    if (lower.includes("scope") || lower.includes("permission")) {
      return "BAXTER_GHL_SCOPE_MISSING";
    }
    return "BAXTER_GHL_AUTH_FAILED";
  }

  if (status === 400) {
    if (lower.includes("location") && (lower.includes("invalid") || lower.includes("not found"))) {
      return "BAXTER_GHL_LOCATION_INVALID";
    }
    return "BAXTER_GHL_BAD_REQUEST";
  }

  if (status === 404) {
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
