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
  constructor(
    message: string,
    options?: { code?: string; statusCode?: number; retryable?: boolean; cause?: unknown },
  ) {
    super(message, {
      code:
        options?.code ??
        (options?.retryable ? "BAXTER_OPENAI_RATE_LIMITED" : "BAXTER_OPENAI_BAD_REQUEST"),
      statusCode: options?.statusCode ?? 502,
      expose: false,
      cause: options?.cause,
    });
    this.name = "BaxterProviderError";
  }
}

export const EMPLOYEE_SAFE_CHAT_ERROR = "Baxter couldn’t answer that right now. Please try again.";

export function employeeFacingErrorMessage(code: string): string {
  return `${EMPLOYEE_SAFE_CHAT_ERROR} Reference: ${code}`;
}

export function classifyOpenAiHttpError(status: number): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (status === 401 || status === 403) {
    return {
      code: "BAXTER_OPENAI_AUTH_FAILED",
      message: "OpenAI authorization failed",
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      code: "BAXTER_OPENAI_RATE_LIMITED",
      message: "OpenAI rate limited",
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      code: "BAXTER_OPENAI_TIMEOUT",
      message: `OpenAI temporary failure (${status})`,
      retryable: true,
    };
  }
  return {
    code: "BAXTER_OPENAI_BAD_REQUEST",
    message: `OpenAI request failed (${status})`,
    retryable: false,
  };
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
    at: new Date().toISOString(),
  });
}
