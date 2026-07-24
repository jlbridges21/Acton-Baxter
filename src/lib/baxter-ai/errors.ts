import { AppError } from "@/lib/errors";

export class BaxterAiError extends AppError {
  constructor(
    message: string,
    options?: {
      code?: string;
      statusCode?: number;
      expose?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, {
      code: options?.code ?? "BAXTER_UNKNOWN_ERROR",
      statusCode: options?.statusCode ?? 500,
      expose: options?.expose ?? false,
      cause: options?.cause,
    });
    this.name = "BaxterAiError";
  }
}

export class BaxterConfigError extends BaxterAiError {
  constructor(
    message = "Baxter chat is not configured",
    code: string = "BAXTER_OPENAI_KEY_MISSING",
  ) {
    super(message, {
      code,
      statusCode: 503,
      expose: true,
    });
    this.name = "BaxterConfigError";
  }
}

export class BaxterProviderError extends BaxterAiError {
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;
  readonly providerRequestId: string | null;

  constructor(
    message: string,
    options?: {
      code?: string;
      statusCode?: number;
      retryable?: boolean;
      cause?: unknown;
      retryAfterSeconds?: number | null;
      providerRequestId?: string | null;
    },
  ) {
    const code =
      options?.code ??
      (options?.retryable ? "BAXTER_OPENAI_SERVICE_UNAVAILABLE" : "BAXTER_OPENAI_BAD_REQUEST");
    super(message, {
      code,
      statusCode: options?.statusCode ?? 502,
      expose: false,
      cause: options?.cause,
    });
    this.name = "BaxterProviderError";
    this.retryable = Boolean(options?.retryable);
    this.retryAfterSeconds = options?.retryAfterSeconds ?? null;
    this.providerRequestId = options?.providerRequestId ?? null;
  }
}

export const EMPLOYEE_SAFE_CHAT_ERROR = "Baxter couldn’t answer that right now. Please try again.";

export function employeeFacingErrorMessage(code: string): string {
  switch (code) {
    case "BAXTER_OPENAI_RATE_LIMITED":
    case "BAXTER_OPENAI_TOKEN_LIMITED":
      return `Baxter is receiving a lot of requests right now. Please try again shortly. Reference: ${code}`;
    case "BAXTER_OPENAI_QUOTA_EXCEEDED":
    case "BAXTER_OPENAI_BILLING_REQUIRED":
    case "BAXTER_OPENAI_PROJECT_LIMIT_REACHED":
      return `Baxter’s AI service needs administrator attention before it can answer general questions. Reference: ${code}`;
    case "BAXTER_OPENAI_AUTH_FAILED":
    case "BAXTER_OPENAI_KEY_MISSING":
      return `Baxter’s AI service is not configured correctly. An administrator needs to check the OpenAI settings. Reference: ${code}`;
    case "BAXTER_OPENAI_REQUEST_TOO_LARGE":
      return `That question or context was too large for Baxter to process. Try a shorter question. Reference: ${code}`;
    case "BAXTER_OPENAI_TIMEOUT":
    case "BAXTER_OPENAI_SERVICE_UNAVAILABLE":
      return `Baxter couldn’t complete that response right now. Please try again in a few minutes. Reference: ${code}`;
    default:
      return `${EMPLOYEE_SAFE_CHAT_ERROR} Reference: ${code}`;
  }
}

export type OpenAiErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: string;
    param?: string;
  };
};

/**
 * Classify OpenAI HTTP failures using status + safe error body fields.
 * Do not treat every 429 as a temporary rate limit — quota/billing are common.
 */
export function classifyOpenAiHttpError(
  status: number,
  body?: OpenAiErrorBody | null,
  headers?: Headers | null,
): {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
} {
  const retryAfterRaw = headers?.get("retry-after");
  const retryAfterSeconds = retryAfterRaw ? Number(retryAfterRaw) : null;
  const safeRetryAfter =
    retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds)
      ? Math.min(Math.max(retryAfterSeconds, 0), 60)
      : null;

  const errorCode = (body?.error?.code ?? "").toLowerCase();
  const errorType = (body?.error?.type ?? "").toLowerCase();
  const errorMessage = (body?.error?.message ?? "").toLowerCase();
  const combined = `${errorCode} ${errorType} ${errorMessage}`;

  if (status === 401 || status === 403) {
    return {
      code: "BAXTER_OPENAI_AUTH_FAILED",
      message: "OpenAI authorization failed",
      retryable: false,
      retryAfterSeconds: null,
    };
  }

  if (
    status === 413 ||
    combined.includes("context_length") ||
    combined.includes("maximum context")
  ) {
    return {
      code: "BAXTER_OPENAI_REQUEST_TOO_LARGE",
      message: "OpenAI request was too large",
      retryable: false,
      retryAfterSeconds: null,
    };
  }

  if (status === 429) {
    if (combined.includes("billing_not_active") || combined.includes("billing hard limit")) {
      return {
        code: "BAXTER_OPENAI_BILLING_REQUIRED",
        message: "OpenAI billing is required or inactive",
        retryable: false,
        retryAfterSeconds: null,
      };
    }
    if (
      combined.includes("insufficient_quota") ||
      combined.includes("quota") ||
      combined.includes("payment") ||
      errorType.includes("insufficient_quota")
    ) {
      return {
        code: "BAXTER_OPENAI_QUOTA_EXCEEDED",
        message: "OpenAI quota or billing limit exceeded",
        retryable: false,
        retryAfterSeconds: null,
      };
    }
    if (
      combined.includes("project") &&
      (combined.includes("limit") || combined.includes("budget"))
    ) {
      return {
        code: "BAXTER_OPENAI_PROJECT_LIMIT_REACHED",
        message: "OpenAI project usage limit reached",
        retryable: false,
        retryAfterSeconds: null,
      };
    }
    if (
      combined.includes("tokens") ||
      combined.includes("token_limit") ||
      combined.includes("tpm")
    ) {
      return {
        code: "BAXTER_OPENAI_TOKEN_LIMITED",
        message: "OpenAI token rate limit reached",
        retryable: true,
        retryAfterSeconds: safeRetryAfter,
      };
    }
    return {
      code: "BAXTER_OPENAI_RATE_LIMITED",
      message: "OpenAI temporary rate limit",
      retryable: true,
      retryAfterSeconds: safeRetryAfter,
    };
  }

  if (status >= 500) {
    return {
      code: "BAXTER_OPENAI_SERVICE_UNAVAILABLE",
      message: `OpenAI temporary failure (${status})`,
      retryable: true,
      retryAfterSeconds: safeRetryAfter,
    };
  }

  return {
    code: "BAXTER_OPENAI_BAD_REQUEST",
    message: `OpenAI request failed (${status})`,
    retryable: false,
    retryAfterSeconds: null,
  };
}

export function isTemporaryOpenAiCode(code: string): boolean {
  return (
    code === "BAXTER_OPENAI_RATE_LIMITED" ||
    code === "BAXTER_OPENAI_TOKEN_LIMITED" ||
    code === "BAXTER_OPENAI_SERVICE_UNAVAILABLE" ||
    code === "BAXTER_OPENAI_TIMEOUT"
  );
}

export function openaiAdminGuidance(code: string): string[] {
  switch (code) {
    case "BAXTER_OPENAI_QUOTA_EXCEEDED":
    case "BAXTER_OPENAI_BILLING_REQUIRED":
    case "BAXTER_OPENAI_PROJECT_LIMIT_REACHED":
      return [
        "Verify the OpenAI API key belongs to the expected project.",
        "Verify API billing is enabled for the organization.",
        "Verify the OpenAI project has available budget / usage remaining.",
        "Verify organization or project usage limits are not exhausted.",
        "Verify the configured model is allowed for the project.",
        "Verify OPENAI_API_KEY was added to the Vercel Production environment.",
        "Redeploy after changing the key.",
        "Retest from /admin/baxter/diagnostics.",
      ];
    case "BAXTER_OPENAI_AUTH_FAILED":
    case "BAXTER_OPENAI_KEY_MISSING":
      return [
        "Confirm OPENAI_API_KEY is set in Vercel Production (not only Preview).",
        "Confirm the key has not been revoked.",
        "Redeploy after updating the key.",
      ];
    case "BAXTER_OPENAI_RATE_LIMITED":
    case "BAXTER_OPENAI_TOKEN_LIMITED":
      return [
        "Temporary provider throttling. Wait and retry.",
        "Reduce concurrent diagnostics or duplicate chat submissions.",
        "Optionally set BAXTER_OPENAI_FALLBACK_MODEL for temporary model-specific limits.",
      ];
    default:
      return [
        "Review recent Baxter diagnostics and Vercel function logs (without pasting secrets).",
      ];
  }
}

export type BaxterDiagnosticLog = {
  code: string;
  route?: string;
  userId?: string | null;
  conversationId?: string | null;
  provider?: string | null;
  model?: string | null;
  httpStatus?: number | null;
  safeMessage?: string | null;
  latencyMs?: number | null;
  retryCount?: number | null;
  providerRequestId?: string | null;
};

export function logBaxterDiagnostic(context: string, detail: BaxterDiagnosticLog) {
  console.error(`[${context}]`, {
    code: detail.code,
    route: detail.route ?? null,
    userId: detail.userId ?? null,
    conversationId: detail.conversationId ?? null,
    provider: detail.provider ?? null,
    model: detail.model ?? null,
    httpStatus: detail.httpStatus ?? null,
    safeMessage: detail.safeMessage ?? null,
    latencyMs: detail.latencyMs ?? null,
    retryCount: detail.retryCount ?? null,
    providerRequestId: detail.providerRequestId ?? null,
    at: new Date().toISOString(),
  });
}
