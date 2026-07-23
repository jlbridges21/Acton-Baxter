export class RentCastError extends Error {
  readonly statusCode: number | null;
  readonly retryable: boolean;

  constructor(message: string, options?: { statusCode?: number | null; retryable?: boolean }) {
    super(message);
    this.name = "RentCastError";
    this.statusCode = options?.statusCode ?? null;
    this.retryable = options?.retryable ?? false;
  }
}
