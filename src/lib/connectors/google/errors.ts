import { AppError } from "@/lib/errors";

export class GoogleConnectorError extends AppError {
  constructor(
    message: string,
    options?: { code?: string; statusCode?: number; expose?: boolean; cause?: unknown },
  ) {
    super(message, {
      code: options?.code ?? "GOOGLE_CONNECTOR_ERROR",
      statusCode: options?.statusCode ?? 502,
      expose: options?.expose ?? false,
      cause: options?.cause,
    });
    this.name = "GoogleConnectorError";
  }
}

export class GoogleConfigError extends GoogleConnectorError {
  constructor(message = "Google Workspace connector is not configured") {
    super(message, {
      code: "GOOGLE_CONFIG_ERROR",
      statusCode: 503,
      expose: true,
    });
    this.name = "GoogleConfigError";
  }
}
