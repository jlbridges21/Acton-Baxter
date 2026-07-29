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
  readonly details: {
    api?: string | null;
    model?: string | null;
    openaiCode?: string | null;
    openaiParam?: string | null;
  } | null;

  constructor(
    message: string,
    options?: {
      code?: string;
      statusCode?: number;
      retryable?: boolean;
      cause?: unknown;
      retryAfterSeconds?: number | null;
      providerRequestId?: string | null;
      details?: {
        api?: string | null;
        model?: string | null;
        openaiCode?: string | null;
        openaiParam?: string | null;
      } | null;
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
    this.details = options?.details ?? null;
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
    case "BAXTER_OPENAI_BAD_REQUEST":
      return `Baxter couldn’t complete that response right now. Please try again in a few minutes. Reference: ${code}`;
    case "BAXTER_OPENAI_MODEL_NOT_AVAILABLE":
      return `Baxter’s AI model isn’t available right now. An administrator needs to check the model settings. Reference: ${code}`;
    case "BAXTER_OPENAI_OUTPUT_TRUNCATED":
      return `Baxter’s answer was cut off before it finished. Please try again. Reference: ${code}`;
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
    status === 404 ||
    combined.includes("model_not_found") ||
    combined.includes("does not exist") ||
    combined.includes("model_not_available")
  ) {
    return {
      code: "BAXTER_OPENAI_MODEL_NOT_AVAILABLE",
      message: "Configured OpenAI model is not available",
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

  if (status === 400) {
    const param = body?.error?.param ? ` param=${body.error.param}` : "";
    const codeHint = body?.error?.code ? ` openai_code=${body.error.code}` : "";
    return {
      code: "BAXTER_OPENAI_BAD_REQUEST",
      message: `OpenAI rejected the request (400)${codeHint}${param}`,
      retryable: false,
      retryAfterSeconds: null,
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
    case "BAXTER_OPENAI_BAD_REQUEST":
      return [
        "OpenAI rejected the request shape (HTTP 400).",
        "Check Vercel logs for api/model/openaiCode/openaiParam (no secrets).",
        "GPT-5.x models must use the Responses API with max_output_tokens (not Chat Completions max_tokens).",
        "Confirm BAXTER_CHAT_MODEL / BAXTER_OPENAI_MODEL matches a model allowed for the project.",
        "Retest with Diagnostics → Test primary reasoning / Test Baxter answer provider.",
      ];
    case "BAXTER_OPENAI_MODEL_NOT_AVAILABLE":
      return [
        "Configured chat model is not available to this OpenAI project.",
        "Verify BAXTER_CHAT_MODEL (or BAXTER_OPENAI_MODEL) exists and is enabled for the API key’s project.",
      ];
    case "BAXTER_OPENAI_OUTPUT_TRUNCATED":
      return [
        "Model hit max_output_tokens before finishing. Retry; consider raising output budget if recurrent.",
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
