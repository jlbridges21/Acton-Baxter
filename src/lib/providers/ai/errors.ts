import { AppError } from "@/lib/errors";

export class AiProviderError extends AppError {
  readonly provider: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options?: {
      provider?: string;
      statusCode?: number;
      retryable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, {
      code: "AI_PROVIDER_ERROR",
      statusCode: options?.statusCode ?? 502,
      expose: false,
      cause: options?.cause,
    });
    this.name = "AiProviderError";
    this.provider = options?.provider ?? "ai";
    this.retryable = options?.retryable ?? false;
  }
}

export function sanitizeAiErrorMessage(message: string): string {
  return message
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/x-api-key[:\s]+[^\s]+/gi, "x-api-key: [redacted]")
    .slice(0, 400);
}
