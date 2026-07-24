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
      code: options?.code ?? "BAXTER_AI_ERROR",
      statusCode: options?.statusCode ?? 500,
      expose: options?.expose ?? false,
      cause: options?.cause,
    });
    this.name = "BaxterAiError";
  }
}

export class BaxterConfigError extends BaxterAiError {
  constructor(message = "Baxter chat is not configured") {
    super(message, {
      code: "BAXTER_CONFIG_ERROR",
      statusCode: 503,
      expose: true,
    });
    this.name = "BaxterConfigError";
  }
}

export class BaxterProviderError extends BaxterAiError {
  constructor(
    message: string,
    options?: { statusCode?: number; retryable?: boolean; cause?: unknown },
  ) {
    super(message, {
      code: options?.retryable ? "BAXTER_PROVIDER_RETRYABLE" : "BAXTER_PROVIDER_ERROR",
      statusCode: options?.statusCode ?? 502,
      expose: false,
      cause: options?.cause,
    });
    this.name = "BaxterProviderError";
  }
}

export const EMPLOYEE_SAFE_CHAT_ERROR = "Baxter couldn’t answer that right now. Please try again.";
