export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly expose: boolean;

  constructor(
    message: string,
    options?: {
      code?: string;
      statusCode?: number;
      expose?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = options?.code ?? "APP_ERROR";
    this.statusCode = options?.statusCode ?? 500;
    this.expose = options?.expose ?? true;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "VALIDATION_ERROR", statusCode: 400, expose: true, cause });
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends AppError {
  constructor(
    message = "Authentication required",
    options?: { code?: string; statusCode?: number },
  ) {
    super(message, {
      code: options?.code ?? "AUTHENTICATION_ERROR",
      statusCode: options?.statusCode ?? 401,
      expose: true,
    });
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, { code: "AUTHORIZATION_ERROR", statusCode: 403, expose: true });
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, { code: "NOT_FOUND", statusCode: 404, expose: true });
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests. Please try again shortly.") {
    super(message, { code: "RATE_LIMITED", statusCode: 429, expose: true });
    this.name = "RateLimitError";
  }
}

export class NotImplementedError extends AppError {
  constructor(providerName: string) {
    super(`${providerName} is not implemented yet. Enable mock research or wait for Prompt 2.`, {
      code: "NOT_IMPLEMENTED",
      statusCode: 501,
      expose: true,
    });
    this.name = "NotImplementedError";
  }
}

export function toPublicError(error: unknown): {
  message: string;
  code: string;
  statusCode: number;
} {
  if (error instanceof AppError) {
    return {
      message: error.expose ? error.message : "An unexpected error occurred",
      code: error.code,
      statusCode: error.statusCode,
    };
  }

  return {
    message: "An unexpected error occurred",
    code: "INTERNAL_ERROR",
    statusCode: 500,
  };
}

export function logServerError(context: string, error: unknown) {
  const safe =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) };
  console.error(`[${context}]`, safe);
}
