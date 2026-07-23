export class AttomError extends Error {
  readonly statusCode: number | null;
  readonly packageName: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options?: {
      statusCode?: number | null;
      packageName?: string;
      retryable?: boolean;
    },
  ) {
    super(message);
    this.name = "AttomError";
    this.statusCode = options?.statusCode ?? null;
    this.packageName = options?.packageName ?? "";
    this.retryable = options?.retryable ?? false;
  }
}
