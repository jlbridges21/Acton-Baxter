export class ArcgisError extends Error {
  readonly statusCode: number | null;
  readonly endpoint: string;

  constructor(message: string, options?: { statusCode?: number | null; endpoint?: string }) {
    super(message);
    this.name = "ArcgisError";
    this.statusCode = options?.statusCode ?? null;
    this.endpoint = options?.endpoint ?? "";
  }
}
